import type { IdentityService } from './identity';
import { one, type Database, type SQL } from '../../../packages/database/index';
import { audit, check, id } from '../../../packages/domain/core';
import type { Actor } from './auth';
import { lockChannels } from './channel-core';
import { requireSeat } from '../../../packages/domain/saas';

export class OrganizationService {
  constructor(
    private db: Database,
    private identity?: IdentityService,
  ) {}
  private async owner(tx: SQL, actor: Actor, org: string) {
    await lockChannels(tx);
    // Serialize administration and acceptance with membership changes.
    const organization = await one(tx, 'SELECT * FROM organizations WHERE id=$1 FOR UPDATE', [org]);
    const membership = await one(
      tx,
      'SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2',
      [org, actor.id],
    );
    check(
      organization && organization.kind !== 'personal' && membership?.role === 'owner',
      'FORBIDDEN',
      'Only an organization owner can administer this workspace.',
      403,
    );
  }
  async invitations(actor: Actor) {
    return (
      await this.db.query(
        `SELECT i.id,i.org_id,i.role,i.expires_at,o.name AS organization_name
      FROM organization_invitations i JOIN organizations o ON o.id=i.org_id
      WHERE i.email=$1 AND i.status='pending' AND i.expires_at>now() ORDER BY i.created_at`,
        [actor.email],
      )
    ).rows;
  }
  async members(actor: Actor, org: string) {
    return this.db.transaction(async (tx) => {
      await this.owner(tx, actor, org);
      return {
        members: (
          await tx.query(
            'SELECT m.user_id,m.role,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 ORDER BY u.name',
            [org],
          )
        ).rows,
        invitations: (
          await tx.query(
            'SELECT id,email,role,status,expires_at FROM organization_invitations WHERE org_id=$1 ORDER BY created_at DESC',
            [org],
          )
        ).rows,
      };
    });
  }
  async invite(actor: Actor, org: string, email: string, role: string) {
    return this.db.transaction(async (tx) => {
      await this.owner(tx, actor, org);
      check(
        ['publisher', 'viewer'].includes(role),
        'INVALID_ROLE',
        'Choose publisher or viewer.',
        400,
      );
      const normalized = email.trim().toLowerCase();
      await requireSeat(tx, org);
      check(
        !(await one(
          tx,
          'SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND u.email=$2',
          [org, normalized],
        )),
        'ALREADY_MEMBER',
        'This account already belongs to the workspace.',
      );
      await tx.query(
        "UPDATE organization_invitations SET status='revoked' WHERE org_id=$1 AND email=$2 AND status='pending' AND expires_at<=now()",
        [org, normalized],
      );
      const invitation = await one(
        tx,
        `INSERT INTO organization_invitations(id,org_id,email,role,invited_by)
        VALUES ($1,$2,$3,$4,$5) RETURNING id,expires_at`,
        [id(), org, normalized, role, actor.id],
      );
      if (this.identity?.options.mail)
        await this.identity.enqueue(tx, 'invite', normalized, null, invitation!.id);
      await audit(tx, actor.id, 'organization.invited', org, {
        invitation_id: invitation!.id,
        role,
      });
      return invitation;
    });
  }
  async accept(actor: Actor, invitationId: string) {
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const reference = await one(tx, 'SELECT org_id FROM organization_invitations WHERE id=$1', [
        invitationId,
      ]);
      check(reference, 'NOT_FOUND', 'Invitation not found.', 404);
      await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [reference.org_id]);
      const invitation = await one(
        tx,
        'SELECT *,expires_at>now() AS valid FROM organization_invitations WHERE id=$1 FOR UPDATE',
        [invitationId],
      );
      check(invitation?.email === actor.email, 'NOT_FOUND', 'Invitation not found.', 404);
      check(
        invitation.status === 'pending' && invitation.valid,
        'INVITATION_UNAVAILABLE',
        'This invitation has expired or is no longer pending.',
      );
      if (this.identity?.options.mail || this.identity?.options.requireVerifiedInvitations)
        check(
          await one(
            tx,
            "SELECT u.id FROM users u WHERE u.id=$1 AND u.email_verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM identity_challenges c WHERE c.kind='invite' AND c.resource_id=$2 AND c.email=u.email AND c.used_at IS NOT NULL)",
            [actor.id, invitationId],
          ),
          'INVITATION_VERIFICATION_REQUIRED',
          'Verify the addressed email invitation before accepting.',
          403,
        );
      if (
        !(await one(tx, 'SELECT user_id FROM memberships WHERE org_id=$1 AND user_id=$2', [
          invitation.org_id,
          actor.id,
        ]))
      )
        await requireSeat(tx, invitation.org_id, false);
      await tx.query(
        'INSERT INTO memberships(user_id,org_id,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [actor.id, invitation.org_id, invitation.role],
      );
      await tx.query("UPDATE organization_invitations SET status='accepted' WHERE id=$1", [
        invitationId,
      ]);
      await audit(tx, actor.id, 'organization.invitation_accepted', invitation.org_id, {
        invitation_id: invitationId,
      });
      return { org_id: invitation.org_id };
    });
  }
  async resendInvitation(actor: Actor, org: string, invitation: string) {
    check(this.identity?.options.mail, 'MAIL_DISABLED', 'Configure email delivery first.', 503);
    await this.identity!.limit('invite-resend:' + invitation);
    return this.db.transaction(async (tx) => {
      await this.owner(tx, actor, org);
      const i = await one(
        tx,
        "SELECT * FROM organization_invitations WHERE id=$1 AND org_id=$2 AND status='pending' AND expires_at>now()",
        [invitation, org],
      );
      check(i, 'INVITATION_UNAVAILABLE', 'The original invitation is no longer pending.');
      await this.identity!.enqueue(tx, 'invite', i.email, null, i.id);
      await audit(tx, actor.id, 'organization.invitation_resent', org, { invitation_id: i.id });
      return { ok: true };
    });
  }
  async revokeInvitation(actor: Actor, org: string, invitation: string) {
    return this.db.transaction(async (tx) => {
      await this.owner(tx, actor, org);
      const updated = await one(
        tx,
        "UPDATE organization_invitations SET status='revoked' WHERE id=$1 AND org_id=$2 AND status='pending' RETURNING id",
        [invitation, org],
      );
      check(updated, 'INVITATION_UNAVAILABLE', 'Pending invitation not found.', 404);
      await audit(tx, actor.id, 'organization.invitation_revoked', org, {
        invitation_id: invitation,
      });
      return { ok: true };
    });
  }
  async revokeMember(actor: Actor, org: string, user: string) {
    return this.db.transaction(async (tx) => {
      await this.owner(tx, actor, org);
      const membership = await one(
        tx,
        'SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE',
        [org, user],
      );
      check(
        membership && membership.role !== 'owner',
        'OWNER_PROTECTED',
        'Owner access cannot be removed through this action.',
      );
      await tx.query('DELETE FROM memberships WHERE org_id=$1 AND user_id=$2', [org, user]);
      // End every existing session, including stale tabs and other devices.
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [user]);
      await audit(tx, actor.id, 'organization.member_revoked', org, { user_id: user });
      return { ok: true };
    });
  }
}
