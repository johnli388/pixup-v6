import { one, type Database, type SQL } from '../../../packages/database/index';
import { check, id, audit } from '../../../packages/domain/core';
import { canonical } from '../../../packages/domain/trust';
import { staffPermissions, type StaffPermission } from '../../../packages/domain/contracts';
import { requireStaff, type Actor } from './auth';
import { IdentityService } from './identity';
import { lockChannels } from './channel-core';
export class AccessAdministration {
  constructor(
    private db: Database,
    private identity: IdentityService,
  ) {}
  private async administrator(tx: SQL, actor: Actor) {
    this.identity.recent(actor, true);
    requireStaff(actor, 'identity_admin');
    check(
      await one(
        tx,
        "SELECT u.id FROM users u JOIN staff_permissions p ON p.user_id=u.id JOIN authenticators a ON a.user_id=u.id WHERE u.id=$1 AND u.is_staff AND u.closed_at IS NULL AND p.permission='identity_admin' AND a.enabled_at IS NOT NULL",
        [actor.id],
      ),
      'FORBIDDEN',
      'Current identity administration authority and MFA are required.',
      403,
    );
  }
  async transfers(actor: Actor) {
    return (
      await this.db.query(
        "SELECT t.*,o.name AS organization_name FROM owner_transfers t JOIN organizations o ON o.id=t.org_id WHERE (t.from_user=$1 OR t.to_user=$1) AND t.state='pending' ORDER BY t.created_at",
        [actor.id],
      )
    ).rows;
  }
  async transfer(actor: Actor, org: string, to: string) {
    this.identity.recent(actor);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const o = await one(tx, 'SELECT * FROM organizations WHERE id=$1 FOR UPDATE', [org]);
      check(
        o && ['creator', 'merchant'].includes(o.kind),
        'OWNER_TRANSFER_UNAVAILABLE',
        'Only creator and merchant workspaces support ownership transfer.',
      );
      const owners = (
        await tx.query("SELECT user_id FROM memberships WHERE org_id=$1 AND role='owner'", [org])
      ).rows;
      check(
        owners.length === 1 && owners[0].user_id === actor.id && to !== actor.id,
        'FORBIDDEN',
        'The sole current owner must nominate another member.',
        403,
      );
      check(
        await one(
          tx,
          'SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.org_id=$1 AND u.id=$2 AND u.closed_at IS NULL AND u.email_verified_at IS NOT NULL',
          [org, to],
        ),
        'RECIPIENT_UNVERIFIED',
        'Choose an active, verified existing member.',
      );
      check(
        await one(tx, 'SELECT id FROM users WHERE id=$1 AND email_verified_at IS NOT NULL', [
          actor.id,
        ]),
        'EMAIL_UNVERIFIED',
        'Verify your email first.',
      );
      await tx.query(
        "UPDATE owner_transfers SET state='canceled',decided_at=now() WHERE org_id=$1 AND state='pending' AND expires_at<=now()",
        [org],
      );
      check(
        !(await one(tx, "SELECT id FROM owner_transfers WHERE org_id=$1 AND state='pending'", [
          org,
        ])),
        'TRANSFER_PENDING',
        'Cancel the pending ownership transfer first.',
      );
      const tid = id();
      await tx.query(
        'INSERT INTO owner_transfers(id,org_id,from_user,to_user) VALUES ($1,$2,$3,$4)',
        [tid, org, actor.id, to],
      );
      await audit(tx, actor.id, 'organization.owner_transfer_requested', org, {
        transfer_id: tid,
        to_user: to,
      });
      return { id: tid };
    });
  }
  async decideTransfer(actor: Actor, tid: string, accept: boolean) {
    this.identity.recent(actor);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const t = await one(
        tx,
        "SELECT *,expires_at>now() AS valid FROM owner_transfers WHERE id=$1 AND state='pending' FOR UPDATE",
        [tid],
      );
      check(
        t && [t.from_user, t.to_user].includes(actor.id),
        'NOT_FOUND',
        'Transfer not found.',
        404,
      );
      if (accept) {
        check(
          t.to_user === actor.id && t.valid,
          'TRANSFER_UNAVAILABLE',
          'Only the nominated recipient may accept an unexpired transfer.',
        );
        const owners = (
          await tx.query("SELECT user_id FROM memberships WHERE org_id=$1 AND role='owner'", [
            t.org_id,
          ])
        ).rows;
        check(
          owners.length === 1 && owners[0].user_id === t.from_user,
          'TRANSFER_STALE',
          'Workspace ownership changed.',
        );
        check(
          await one(
            tx,
            'SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND u.email_verified_at IS NOT NULL AND u.closed_at IS NULL',
            [t.org_id, actor.id],
          ),
          'TRANSFER_STALE',
          'The recipient is no longer an active verified member.',
        );
        await tx.query(
          "UPDATE memberships SET role=CASE WHEN user_id=$2 THEN 'owner' ELSE 'publisher' END WHERE org_id=$1 AND user_id IN ($2,$3)",
          [t.org_id, t.to_user, t.from_user],
        );
        await tx.query('DELETE FROM sessions WHERE user_id IN ($1,$2)', [t.from_user, t.to_user]);
      }
      await tx.query('UPDATE owner_transfers SET state=$2,decided_at=now() WHERE id=$1', [
        tid,
        accept ? 'accepted' : 'canceled',
      ]);
      await audit(
        tx,
        actor.id,
        accept ? 'organization.owner_transferred' : 'organization.owner_transfer_canceled',
        t.org_id,
        { transfer_id: tid },
      );
      return { ok: true, sign_in_again: accept };
    });
  }
  async dashboard(actor: Actor) {
    await this.administrator(this.db, actor);
    return {
      permissions: staffPermissions,
      users: (
        await this.db.query(
          "SELECT u.id,u.email,u.name,u.is_staff,u.email_verified_at,a.enabled_at AS mfa_enrolled,COALESCE((SELECT jsonb_agg(p.permission ORDER BY p.permission) FROM staff_permissions p WHERE p.user_id=u.id),'[]') AS permissions FROM users u LEFT JOIN authenticators a ON a.user_id=u.id WHERE u.closed_at IS NULL ORDER BY u.email LIMIT 200",
        )
      ).rows,
      reviews: (
        await this.db.query('SELECT * FROM staff_access_reviews ORDER BY created_at DESC LIMIT 100')
      ).rows,
    };
  }
  async request(actor: Actor, target: string, permissions: StaffPermission[], reason: string) {
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await this.administrator(tx, actor);
      check(
        target !== actor.id,
        'SELF_REVIEW',
        'Another administrator must request changes to your access.',
      );
      const u = await one(tx, 'SELECT * FROM users WHERE id=$1 AND closed_at IS NULL', [target]);
      check(u, 'NOT_FOUND', 'Account not found.', 404);
      const next = [...new Set(permissions)].sort();
      check(
        !next.length ||
          (u.email_verified_at &&
            (await one(
              tx,
              'SELECT user_id FROM authenticators WHERE user_id=$1 AND enabled_at IS NOT NULL',
              [target],
            ))),
        'STAFF_NOT_READY',
        'Verify the recipient email and enroll MFA before granting staff access.',
      );
      const current = (
        await tx.query(
          'SELECT permission FROM staff_permissions WHERE user_id=$1 ORDER BY permission',
          [target],
        )
      ).rows.map((r) => r.permission);
      await tx.query(
        "UPDATE staff_access_reviews SET state='rejected',decision_note='Expired without approval',decided_at=now() WHERE user_id=$1 AND state='pending' AND expires_at<=now()",
        [target],
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM staff_access_reviews WHERE user_id=$1 AND state='pending'",
          [target],
        )),
        'REVIEW_PENDING',
        'Resolve the pending access review first.',
      );
      const aid = id();
      await tx.query(
        'INSERT INTO staff_access_reviews(id,user_id,requested_by,permissions,previous_permissions,reason) VALUES ($1,$2,$3,$4,$5,$6)',
        [aid, target, actor.id, JSON.stringify(next), JSON.stringify(current), reason],
      );
      await audit(tx, actor.id, 'identity.staff_access_requested', target, {
        review_id: aid,
        permissions: next,
      });
      return { id: aid };
    });
  }
  async decide(actor: Actor, aid: string, approve: boolean, note: string) {
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await this.administrator(tx, actor);
      const a = await one(
        tx,
        "SELECT *,expires_at>now() AS valid FROM staff_access_reviews WHERE id=$1 AND state='pending' FOR UPDATE",
        [aid],
      );
      check(a && a.valid, 'REVIEW_UNAVAILABLE', 'Review expired or already decided.');
      check(
        actor.id !== a.requested_by && actor.id !== a.user_id,
        'SELF_REVIEW',
        'An independent administrator must decide this change.',
        403,
      );
      if (approve) {
        check(
          await one(
            tx,
            "SELECT u.id FROM users u JOIN staff_permissions p ON p.user_id=u.id WHERE u.id=$1 AND u.closed_at IS NULL AND u.is_staff AND p.permission='identity_admin'",
            [a.requested_by],
          ),
          'REVIEW_STALE',
          'Requester no longer has authority.',
        );
        const u = await one(tx, 'SELECT * FROM users WHERE id=$1 AND closed_at IS NULL', [
          a.user_id,
        ]);
        check(
          u &&
            (!a.permissions.length ||
              (u.email_verified_at &&
                (await one(
                  tx,
                  'SELECT user_id FROM authenticators WHERE user_id=$1 AND enabled_at IS NOT NULL',
                  [a.user_id],
                )))),
          'REVIEW_STALE',
          'Recipient eligibility changed.',
        );
        const current = (
          await tx.query(
            'SELECT permission FROM staff_permissions WHERE user_id=$1 ORDER BY permission',
            [a.user_id],
          )
        ).rows.map((r) => r.permission);
        check(
          canonical(current) === canonical(a.previous_permissions),
          'REVIEW_STALE',
          'Recipient permissions changed.',
        );
        if (current.includes('identity_admin') && !a.permissions.includes('identity_admin'))
          check(
            (await one(
              tx,
              "SELECT count(*)::int AS n FROM staff_permissions p JOIN users u ON u.id=p.user_id JOIN authenticators f ON f.user_id=u.id WHERE p.permission='identity_admin' AND u.is_staff AND u.closed_at IS NULL AND f.enabled_at IS NOT NULL AND u.id<>$1",
              [a.user_id],
            ))!.n >= 2,
            'ADMIN_QUORUM',
            'Retain at least two active identity administrators.',
          );
        await tx.query('DELETE FROM staff_permissions WHERE user_id=$1', [a.user_id]);
        for (const permission of a.permissions)
          await tx.query('INSERT INTO staff_permissions(user_id,permission) VALUES ($1,$2)', [
            a.user_id,
            permission,
          ]);
        await tx.query('UPDATE users SET is_staff=$2 WHERE id=$1', [
          a.user_id,
          !!a.permissions.length,
        ]);
        await tx.query('DELETE FROM sessions WHERE user_id=$1', [a.user_id]);
      }
      await tx.query(
        'UPDATE staff_access_reviews SET state=$2,decided_by=$3,decision_note=$4,decided_at=now() WHERE id=$1',
        [aid, approve ? 'approved' : 'rejected', actor.id, note],
      );
      await audit(tx, actor.id, 'identity.staff_access_decided', a.user_id, {
        review_id: aid,
        approved: approve,
      });
      return { ok: true };
    });
  }
}
