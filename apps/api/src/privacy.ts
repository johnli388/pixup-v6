import { withDatabaseActor } from '../../../packages/database/context';
import { exportCommunity } from './community';
import { randomBytes } from 'node:crypto';
import { one, type Database } from '../../../packages/database/index';
import { audit, check, id } from '../../../packages/domain/core';
import { privacyPolicy, requireEligibility } from '../../../packages/domain/privacy';
import { passwordHash } from '../../../packages/domain/security';
import { requireStaff, type Actor } from './auth';
import { lockChannels } from './channel-core';
export class PrivacyService {
  constructor(private db: Database) {}
  async profile(actor: Actor) {
    let eligible = true;
    try {
      await requireEligibility(this.db, actor.id);
    } catch {
      eligible = false;
    }
    return {
      policy: privacyPolicy(),
      eligible,
      profile:
        (await one(this.db, 'SELECT * FROM privacy_profiles WHERE user_id=$1', [actor.id])) || null,
      requests: (
        await this.db.query(
          'SELECT id,kind,status,note,decision_note,due_at,created_at FROM privacy_requests WHERE user_id=$1 ORDER BY created_at DESC',
          [actor.id],
        )
      ).rows,
    };
  }
  async consent(
    actor: Actor,
    d: {
      adult: boolean;
      terms_version: string;
      privacy_version: string;
      marketing_opt_in: boolean;
    },
  ) {
    const policy = privacyPolicy();
    check(
      d.terms_version === policy.terms_version && d.privacy_version === policy.privacy_version,
      'POLICY_CHANGED',
      'Review the current notice before agreeing.',
    );
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      check(
        await one(tx, 'SELECT id FROM users WHERE id=$1 AND closed_at IS NULL', [actor.id]),
        'ACCOUNT_RESTRICTED',
        'This account is closed.',
        403,
      );
      const existing = await one(tx, 'SELECT restriction FROM privacy_profiles WHERE user_id=$1', [
        actor.id,
      ]);
      check(
        !existing?.restriction,
        'ACCOUNT_RESTRICTED',
        'Support must review a restricted account before a new declaration.',
        403,
      );
      await tx.query(
        `INSERT INTO privacy_profiles(user_id,terms_version,privacy_version,minimum_age,age_attested_at,marketing_opt_in,restriction)
    VALUES ($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END,$6,CASE WHEN $5 THEN NULL ELSE 'age' END)
    ON CONFLICT(user_id) DO UPDATE SET terms_version=$2,privacy_version=$3,minimum_age=$4,age_attested_at=CASE WHEN $5 THEN now() ELSE NULL END,marketing_opt_in=$6,restriction=CASE WHEN $5 THEN NULL ELSE 'age' END,updated_at=now()`,
        [
          actor.id,
          policy.terms_version,
          policy.privacy_version,
          policy.minimum_age,
          d.adult,
          d.marketing_opt_in && d.adult,
        ],
      );
      await tx.query(
        "INSERT INTO privacy_consents(id,user_id,terms_version,privacy_version,minimum_age,adult,marketing_opt_in,source) VALUES ($1,$2,$3,$4,$5,$6,$7,'user')",
        [
          id(),
          actor.id,
          policy.terms_version,
          policy.privacy_version,
          policy.minimum_age,
          d.adult,
          d.marketing_opt_in && d.adult,
        ],
      );
      await audit(tx, actor.id, 'privacy.consent', actor.id, {
        adult: d.adult,
        policy: policy.privacy_version,
        minimum_age: policy.minimum_age,
      });
      return { ok: true, eligible: d.adult };
    });
  }
  async preferences(actor: Actor, marketing: boolean) {
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      check(
        await one(tx, 'SELECT id FROM users WHERE id=$1 AND closed_at IS NULL', [actor.id]),
        'ACCOUNT_RESTRICTED',
        'This account is closed.',
        403,
      );
      if (marketing) await requireEligibility(tx, actor.id);
      await tx.query(
        'INSERT INTO privacy_profiles(user_id,marketing_opt_in) VALUES ($1,$2) ON CONFLICT(user_id) DO UPDATE SET marketing_opt_in=$2,updated_at=now()',
        [actor.id, marketing],
      );
      await audit(tx, actor.id, 'privacy.preferences', actor.id, { marketing_opt_in: marketing });
    });
    return { ok: true };
  }
  async request(actor: Actor, kind: string, note: string) {
    check(
      ['restrict', 'delete', 'age_review'].includes(kind),
      'REQUEST_KIND',
      'Unknown privacy request.',
      400,
    );
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
      const old = await one(
        tx,
        "SELECT id FROM privacy_requests WHERE user_id=$1 AND kind=$2 AND status='open'",
        [actor.id, kind],
      );
      if (old) return { id: old.id };
      const rid = id();
      await tx.query('INSERT INTO privacy_requests(id,user_id,kind,note) VALUES ($1,$2,$3,$4)', [
        rid,
        actor.id,
        kind,
        note,
      ]);
      if (kind !== 'age_review') {
        await tx.query(
          "INSERT INTO privacy_profiles(user_id,restriction,marketing_opt_in) VALUES ($1,'privacy',false) ON CONFLICT(user_id) DO UPDATE SET restriction=COALESCE(privacy_profiles.restriction,'privacy'),marketing_opt_in=false,updated_at=now()",
          [actor.id],
        );
        await tx.query(
          'UPDATE tool_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE created_by=$1',
          [actor.id],
        );
        await tx.query(
          "UPDATE listings SET status='withdrawn' WHERE seller_id=$1 AND status='active' AND NOT EXISTS(SELECT 1 FROM channel_allocations ca WHERE ca.listing_id=listings.id AND ca.state<>'closed')",
          [actor.id],
        );
      }
      await audit(tx, actor.id, 'privacy.requested', rid, { kind });
      return { id: rid };
    });
  }
  async export(actor: Actor) {
    return this.db.transaction(async (tx) => {
      const user = await one(
        tx,
        'SELECT id,name,email,created_at,closed_at FROM users WHERE id=$1',
        [actor.id],
      );
      const orders = (
        await tx.query(
          `SELECT id,asset_id,status,total_cents,credit_units,created_at,channel,CASE WHEN buyer_id=$1 THEN 'buyer' ELSE 'seller' END AS role,
    CASE WHEN buyer_id=$1 THEN shipping_address ELSE NULL END AS shipping_address FROM orders WHERE buyer_id=$1 OR seller_id=$1`,
          [actor.id],
        )
      ).rows;
      const consents = (
        await tx.query(
          'SELECT terms_version,privacy_version,minimum_age,adult,marketing_opt_in,source,created_at FROM privacy_consents WHERE user_id=$1',
          [actor.id],
        )
      ).rows;
      const assets = (
        await tx.query(
          'SELECT id,title,serial,certification,custody,created_at FROM assets WHERE owner_id=$1',
          [actor.id],
        )
      ).rows;
      const credits = (
        await tx.query(
          'SELECT issued,available,held,origin,created_at FROM credit_lots WHERE user_id=$1',
          [actor.id],
        )
      ).rows;
      const requests = (
        await tx.query(
          'SELECT id,kind,status,note,decision_note,created_at FROM privacy_requests WHERE user_id=$1',
          [actor.id],
        )
      ).rows;
      await audit(tx, actor.id, 'privacy.exported', actor.id);
      const evidence = (
        await tx.query(
          'SELECT id,purpose,asset_id,collection_id,mime,size,hash,state,retain_until,legal_hold,created_at FROM stored_files WHERE owner_id=$1',
          [actor.id],
        )
      ).rows;
      return {
        generated_at: new Date().toISOString(),
        scope:
          'Account profile, consent history, owned stock, orders, credits, privacy requests, own community data and own evidence metadata. Original files require scoped download or support-assisted export and third-party redaction.',
        user,
        orders,
        consents,
        assets,
        credits,
        requests,
        evidence,
        community: await exportCommunity(tx, actor.id),
        identities: (
          await tx.query('SELECT issuer,created_at FROM managed_identities WHERE user_id=$1', [
            actor.id,
          ])
        ).rows,
        security: {
          email_verified: !!(
            await one(tx, 'SELECT email_verified_at FROM users WHERE id=$1', [actor.id])
          )?.email_verified_at,
          mfa_enrolled: !!(
            await one(tx, 'SELECT enabled_at FROM authenticators WHERE user_id=$1', [actor.id])
          )?.enabled_at,
        },
      };
    });
  }
  async queue(actor: Actor) {
    requireStaff(actor, 'support');
    return (
      await this.db.query(
        "SELECT id,user_id,kind,status,note,decision_note,due_at,created_at FROM privacy_requests WHERE status='open' ORDER BY due_at LIMIT 100",
      )
    ).rows;
  }
  async decide(
    actor: Actor,
    rid: string,
    action: 'complete' | 'reject' | 'restore_access',
    note: string,
  ) {
    requireStaff(actor, 'support');
    const erasedPassword = await passwordHash(randomBytes(32).toString('hex'));
    return withDatabaseActor(actor.id, () =>
      this.db.transaction(async (tx) => {
        await lockChannels(tx);
        const r = await one(tx, 'SELECT * FROM privacy_requests WHERE id=$1 FOR UPDATE', [rid]);
        check(r?.status === 'open', 'INVALID_STATE', 'Request no longer awaits review.');
        check(
          r.user_id !== actor.id,
          'SELF_REVIEW',
          'Another support reviewer must decide this request.',
          403,
        );
        if (action === 'restore_access') {
          check(
            r.kind === 'age_review' || r.kind === 'restrict',
            'REQUEST_KIND',
            'Use a review request to restore access.',
          );
          await tx.query(
            'UPDATE privacy_profiles SET restriction=NULL,age_attested_at=NULL,updated_at=now() WHERE user_id=$1',
            [r.user_id],
          );
        } else if (action === 'complete' && r.kind === 'delete') {
          const retained = await one(
            tx,
            `SELECT
     EXISTS(SELECT 1 FROM orders WHERE buyer_id=$1 OR seller_id=$1) OR EXISTS(SELECT 1 FROM assets WHERE owner_id=$1) OR
     EXISTS(SELECT 1 FROM intakes WHERE user_id=$1) OR EXISTS(SELECT 1 FROM support_cases WHERE user_id=$1) OR
     EXISTS(SELECT 1 FROM stored_files WHERE owner_id=$1 AND state<>'purged') OR
     EXISTS(SELECT 1 FROM connect_recipients WHERE user_id=$1) OR
     EXISTS(SELECT 1 FROM staff_permissions WHERE user_id=$1 AND permission='identity_admin') OR
     EXISTS(SELECT 1 FROM credit_lots WHERE user_id=$1 AND (available>0 OR held>0)) OR
     EXISTS(SELECT 1 FROM memberships m JOIN collections c ON c.org_id=m.org_id WHERE m.user_id=$1) OR
     EXISTS(SELECT 1 FROM subscriptions s JOIN billing_accounts b ON b.id=s.account_id JOIN memberships m ON m.org_id=b.org_id WHERE m.user_id=$1 AND m.role='owner') OR
     EXISTS(SELECT 1 FROM memberships own JOIN memberships other ON other.org_id=own.org_id AND other.user_id<>own.user_id WHERE own.user_id=$1 AND own.role='owner') AS retained`,
            [r.user_id],
          );
          check(
            !retained?.retained,
            'RETENTION_REVIEW_REQUIRED',
            'Business, custody, support or shared-organization records require a retention review. Keep the request open; do not erase financial or provenance history.',
          );
          const u = await one(tx, 'SELECT email FROM users WHERE id=$1', [r.user_id]);
          await tx.query(
            "UPDATE organization_invitations SET email=$2,status=CASE WHEN status='pending' THEN 'revoked' ELSE status END WHERE email=$1",
            [u!.email, `closed-${r.user_id}@deleted.invalid`],
          );
          await tx.query(
            "UPDATE organizations SET name='Closed personal workspace' WHERE kind='personal' AND id IN (SELECT org_id FROM memberships WHERE user_id=$1)",
            [r.user_id],
          );
          await tx.query(
            "UPDATE users SET email=$2,name='Closed account',password_hash=$3,closed_at=now() WHERE id=$1",
            [r.user_id, `closed-${r.user_id}@deleted.invalid`, erasedPassword],
          );
          await tx.query(
            'UPDATE identity_challenges SET used_at=COALESCE(used_at,now()),secret=NULL WHERE user_id=$1 OR email=$2',
            [r.user_id, u!.email],
          );
          await tx.query(
            "UPDATE identity_mail SET payload='',state=CASE WHEN state='pending' THEN 'expired' ELSE state END WHERE token_hash IN (SELECT token_hash FROM identity_challenges WHERE user_id=$1 OR email=$2)",
            [r.user_id, u!.email],
          );
          try {
            await tx.query('SELECT community_close($1)', [r.user_id]);
          } catch (error) {
            if (error instanceof Error && error.message.includes('Resolve community reports'))
              check(
                false,
                'RETENTION_REVIEW_REQUIRED',
                'Resolve open community reports and appeals before closing this account.',
              );
            throw error;
          }
          for (const table of [
            'sessions',
            'saved_items',
            'activity',
            'authenticators',
            'mfa_recovery_codes',
          ])
            await tx.query(`DELETE FROM ${table} WHERE user_id=$1`, [r.user_id]);
          await tx.query('DELETE FROM media WHERE owner_id=$1', [r.user_id]);
          await tx.query('DELETE FROM memberships WHERE user_id=$1', [r.user_id]);
          await tx.query(
            'UPDATE tool_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE created_by=$1',
            [r.user_id],
          );
        } else
          check(
            !(action === 'complete' && r.kind === 'age_review'),
            'REVIEW_ACTION',
            'Restore access after review or reject the request.',
          );
        await tx.query(
          'UPDATE privacy_requests SET status=$2,decision_note=$3,assigned_to=$4,resolved_at=now() WHERE id=$1',
          [rid, action === 'reject' ? 'rejected' : 'completed', note, actor.id],
        );
        await audit(tx, actor.id, 'privacy.decided', rid, { action, note });
        return { ok: true };
      }),
    );
  }
}
