import { one, type Database, type SQL } from '../../../packages/database/index';
import { audit, check, id } from '../../../packages/domain/core';
import {
  commercialOwners,
  commercialPolicy,
  commercialProposal,
  commercialReview,
} from '../../../packages/domain/commercial-policy';
import { privacyPolicy } from '../../../packages/domain/privacy';
import { requireStaff, type Actor } from './auth';

export class CommercialService {
  constructor(private db: Database) {}
  private async authority(tx: SQL, actor: Actor) {
    requireStaff(actor, 'finance');
    check(
      await one(
        tx,
        `SELECT u.id FROM users u JOIN staff_permissions p ON p.user_id=u.id
      WHERE u.id=$1 AND u.is_staff AND u.closed_at IS NULL AND p.permission='finance' FOR SHARE OF u,p`,
        [actor.id],
      ),
      'FORBIDDEN',
      'Current finance authority is required.',
      403,
    );
  }
  async dashboard(actor: Actor) {
    await this.authority(this.db, actor);
    return {
      policy: await commercialPolicy(this.db),
      minimum_age: privacyPolicy().minimum_age,
      owners: commercialOwners,
      decisions: (
        await this.db.query(
          'SELECT * FROM commercial_decisions ORDER BY created_at DESC,id DESC LIMIT 200',
        )
      ).rows,
      versions: (
        await this.db.query(
          'SELECT * FROM commercial_policy_versions ORDER BY version DESC LIMIT 100',
        )
      ).rows,
    };
  }
  async propose(actor: Actor, input: unknown) {
    const d = commercialProposal.parse(input);
    return this.db.transaction(async (tx) => {
      await this.authority(tx, actor);
      const policy = await commercialPolicy(tx, true);
      check(
        policy.version === d.base_version,
        'POLICY_STALE',
        'Policy changed. Review the current version before proposing.',
      );
      const did = id();
      await tx.query(
        `INSERT INTO commercial_decisions(id,topic,action,base_version,statement,evidence,requested_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [did, d.topic, d.action, d.base_version, d.statement, d.evidence, actor.id],
      );
      await audit(tx, actor.id, 'commercial.proposed', did, {
        topic: d.topic,
        action: d.action,
        base_version: d.base_version,
      });
      return { id: did };
    });
  }
  async review(actor: Actor, did: string, input: unknown) {
    const inputReview = commercialReview.parse(input);
    return this.db.transaction(async (tx) => {
      // Shared ordering for all approvals prevents concurrent lost updates.
      const current = await one(
        tx,
        'SELECT version FROM commercial_policy_current WHERE singleton=true FOR UPDATE',
      );
      await this.authority(tx, actor);
      const d = await one(tx, 'SELECT * FROM commercial_decisions WHERE id=$1 FOR UPDATE', [did]);
      check(d, 'NOT_FOUND', 'Decision not found.', 404);
      check(
        d.requested_by !== actor.id,
        'INDEPENDENT_REVIEW_REQUIRED',
        'A different finance reviewer must decide this proposal.',
        403,
      );
      check(d.state === 'pending', 'DECISION_CLOSED', 'This proposal has already been reviewed.');
      let resulting: number | null = null;
      if (inputReview.decision === 'approve') {
        check(
          Date.parse(d.expires_at) > Date.now(),
          'DECISION_EXPIRED',
          'Submit a new proposal with current evidence.',
        );
        check(
          d.base_version === current?.version,
          'POLICY_STALE',
          'Another policy review was approved. Submit a new proposal against the current version.',
        );
        check(
          await one(
            tx,
            `SELECT u.id FROM users u JOIN staff_permissions p ON p.user_id=u.id
          WHERE u.id=$1 AND u.is_staff AND u.closed_at IS NULL AND p.permission='finance' FOR SHARE OF u,p`,
            [d.requested_by],
          ),
          'APPROVAL_STALE',
          'The requester no longer has finance authority.',
        );
        const previous = await commercialPolicy(tx);
        const { version, ...snapshot } = previous;
        if (d.action === 'disable_credits') snapshot.credit_scope = 'disabled';
        if (d.action === 'restore_pilot_credits') snapshot.credit_scope = 'pixup_owned';
        if (d.action === 'pause_sales') snapshot.new_sales_enabled = false;
        if (d.action === 'resume_pilot_sales') snapshot.new_sales_enabled = true;
        snapshot.reviewed_decisions = { ...snapshot.reviewed_decisions, [d.topic]: d.id };
        resulting = version + 1;
        await tx.query('INSERT INTO commercial_policy_versions(version,snapshot) VALUES ($1,$2)', [
          resulting,
          JSON.stringify(snapshot),
        ]);
        await tx.query('UPDATE commercial_policy_current SET version=$1 WHERE singleton=true', [
          resulting,
        ]);
      }
      await tx.query(
        `UPDATE commercial_decisions SET state=$2,decided_by=$3,decided_at=now(),review_note=$4,resulting_version=$5 WHERE id=$1`,
        [
          did,
          inputReview.decision === 'approve' ? 'approved' : 'rejected',
          actor.id,
          inputReview.note,
          resulting,
        ],
      );
      await audit(tx, actor.id, `commercial.${inputReview.decision}`, did, {
        resulting_version: resulting,
        note: inputReview.note,
      });
      return { ok: true, version: resulting };
    });
  }
}
