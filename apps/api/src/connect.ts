import { one, type Database, type SQL } from '../../../packages/database/index';
import { audit, check, id, journal, DomainError } from '../../../packages/domain/core';
import { consumeApproval } from '../../../packages/domain/finance-approval';
import { requireEligibility } from '../../../packages/domain/privacy';
import { noPaymentException, noPendingAdjustment } from '../../../packages/domain/payment-control';
import { canonical } from '../../../packages/domain/trust';
import { requireStaff, type Actor } from './auth';
import { lockChannels } from './channel-core';
import { noPhysicalIncident } from './logistics';
import { PaymentControls } from './payment-controls';

export class ConnectService {
  constructor(
    private db: Database,
    private controls: PaymentControls,
  ) {}
  private options() {
    return this.controls.payments.options;
  }
  async status(actor: Actor) {
    const r = await one(
      this.db,
      'SELECT id,country,state,transfers_active,payouts_enabled,details_submitted,requirements_count,error_code FROM connect_recipients WHERE user_id=$1',
      [actor.id],
    );
    return {
      enabled: !!this.options().connectCountries?.length,
      countries: this.options().connectCountries || [],
      recipient: r || null,
      bank_payouts_tracked: false,
    };
  }
  async onboard(actor: Actor, country: string) {
    check(
      this.options().connectCountries?.includes(country),
      'CONNECT_DISABLED',
      'This test onboarding country has not been enabled.',
    );
    await requireEligibility(this.db, actor.id);
    const account = await this.controls.provider().identity();
    const r = await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await requireEligibility(tx, actor.id);
      const old = await one(tx, 'SELECT * FROM connect_recipients WHERE user_id=$1', [actor.id]);
      if (old) {
        check(
          old.country === country && old.platform_account === account,
          'CONNECT_SCOPE',
          'Resume the original country and platform account.',
        );
        return old;
      }
      const rid = id(),
        payload = {
          type: 'express',
          country,
          'capabilities[transfers][requested]': 'true',
          'metadata[pixup_user_id]': actor.id,
          'metadata[pixup_recipient_id]': rid,
        };
      await tx.query(
        'INSERT INTO connect_recipients(id,user_id,platform_account,country,payload) VALUES ($1,$2,$3,$4,$5)',
        [rid, actor.id, account, country, JSON.stringify(payload)],
      );
      await audit(tx, actor.id, 'connect.test_onboarding_requested', rid, { country });
      return { id: rid };
    });
    await this.sync(r.id);
    return this.link(actor);
  }
  async link(actor: Actor) {
    const r = await one(this.db, 'SELECT * FROM connect_recipients WHERE user_id=$1', [actor.id]);
    check(
      r?.provider_account,
      'CONNECT_PENDING',
      'Reconcile the original recipient before creating an onboarding link.',
    );
    check(
      r.platform_account === (await this.controls.provider().identity()),
      'CONNECT_SCOPE',
      'Restore the original platform account.',
    );
    const link = await this.controls
      .provider()
      .accountLink(r.provider_account, this.options().origin || 'http://127.0.0.1:3000');
    check(
      new URL(link.url).origin === 'https://connect.stripe.com' &&
        link.expires_at * 1000 > Date.now(),
      'CONNECT_URL',
      'Unexpected or expired onboarding destination.',
      502,
    );
    return link;
  }
  async sync(rid: string, original?: string) {
    const provider = this.controls.provider(),
      account = await provider.identity();
    const r = await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      return one(
        tx,
        'UPDATE connect_recipients SET sync_version=sync_version+1,checked_at=now() WHERE id=$1 RETURNING *',
        [rid],
      );
    });
    check(
      r && r.platform_account === account,
      'CONNECT_SCOPE',
      'Restore the original recipient platform account.',
    );
    try {
      const reference = r.provider_account || original;
      check(
        reference || Date.parse(r.created_at) > Date.now() - 23 * 3600000,
        'CONNECT_REVIEW_REQUIRED',
        'Recover the original connected account after an ambiguous old create.',
      );
      const remote = reference
        ? await provider.recipient(reference)
        : await provider.createRecipient(r.payload, `pixup-recipient-${rid}`);
      check(
        remote.country === r.country &&
          remote.metadata.pixup_user_id === r.user_id &&
          remote.metadata.pixup_recipient_id === rid &&
          (!r.provider_account || r.provider_account === remote.id),
        'CONNECT_IDENTITY',
        'Recipient identity does not match its original owner and request.',
      );
      await this.db.query(
        'UPDATE connect_recipients SET provider_account=$3,state=$4,details_submitted=$5,transfers_active=$6,payouts_enabled=$7,requirements_count=$8,error_code=NULL WHERE id=$1 AND sync_version=$2',
        [
          rid,
          r.sync_version,
          remote.id,
          remote.capabilities.transfers === 'active' && remote.payouts_enabled
            ? 'ready'
            : 'onboarding',
          remote.details_submitted,
          remote.capabilities.transfers === 'active',
          remote.payouts_enabled,
          remote.requirements.currently_due.length,
        ],
      );
    } catch (e) {
      await this.db.query(
        'UPDATE connect_recipients SET error_code=$3 WHERE id=$1 AND sync_version=$2',
        [rid, r.sync_version, e instanceof DomainError ? e.code : 'PROVIDER_UNAVAILABLE'],
      );
      throw e;
    }
  }
  async refresh(actor: Actor) {
    const r = await one(this.db, 'SELECT id FROM connect_recipients WHERE user_id=$1', [actor.id]);
    check(r, 'NOT_FOUND', 'Recipient not found.', 404);
    await this.sync(r.id);
    return this.status(actor);
  }
  async recover(actor: Actor, rid: string, original: string, note: string) {
    requireStaff(actor, 'finance');
    await this.sync(rid, original);
    await audit(this.db, actor.id, 'connect.original_account_recovered', rid, { note });
    return { ok: true };
  }
  private async terms(tx: SQL, sid: string, source: string) {
    check(
      this.options().connectTransfers,
      'CONNECT_TRANSFER_DISABLED',
      'Test Connect transfers are not enabled.',
    );
    const s = await one(
      tx,
      'SELECT s.*,o.asset_id,o.status AS order_status,o.payment_provider,o.credit_units,o.fulfillment,p.account_id FROM settlements s JOIN orders o ON o.id=s.order_id JOIN payment_attempts p ON p.order_id=o.id WHERE s.id=$1 FOR UPDATE OF s,o',
      [sid],
    );
    check(
      s &&
        s.payment_provider === 'stripe_test' &&
        s.status === 'held' &&
        s.order_status === 'fulfilled' &&
        s.amount_cents > 0 &&
        s.credit_units === 0 &&
        s.seller_id !== 'platform',
      'TRANSFER_INELIGIBLE',
      'Only fulfilled, held third-party cash settlements can use test transfers.',
    );
    await noPaymentException(tx, s.order_id);
    await noPendingAdjustment(tx, s.order_id);
    await noPhysicalIncident(tx, s.asset_id);
    await requireEligibility(tx, s.seller_id);
    check(
      !(await one(
        tx,
        "SELECT id FROM payment_refunds WHERE order_id=$1 AND status NOT IN ('failed','canceled') UNION ALL SELECT id FROM support_cases WHERE order_id=$1 AND status='open' UNION ALL SELECT id FROM shipments WHERE order_id=$1 AND state<>'delivered'",
        [s.order_id],
      )),
      'TRANSFER_HOLD',
      'Resolve refunds, support and shipment exceptions before transferring.',
    );
    check(
      s.fulfillment === 'vault' ||
        (await one(tx, "SELECT id FROM shipments WHERE order_id=$1 AND state='delivered'", [
          s.order_id,
        ])),
      'DELIVERY_REQUIRED',
      'A tracked delivery is required for shipped transfers.',
    );
    const r = await one(tx, 'SELECT * FROM connect_recipients WHERE user_id=$1', [s.seller_id]);
    check(
      r &&
        r.platform_account === s.account_id &&
        r.transfers_active &&
        r.payouts_enabled &&
        r.details_submitted &&
        r.provider_account,
      'RECIPIENT_NOT_READY',
      'Provider-confirmed recipient readiness is required.',
    );
    return {
      settlement_id: s.id,
      order_id: s.order_id,
      account_id: s.account_id,
      destination: r.provider_account,
      amount_cents: s.amount_cents,
      source_transaction: source,
    };
  }
  private async refreshInputs(actor: Actor, sid: string) {
    const s = await one(this.db, 'SELECT * FROM settlements WHERE id=$1', [sid]);
    check(s, 'NOT_FOUND', 'Settlement not found.', 404);
    check(
      (await this.controls.reconcile(actor, s.order_id)).state === 'matched',
      'PAYMENT_HOLD',
      'Resolve external reconciliation first.',
    );
    const r = await one(this.db, 'SELECT id FROM connect_recipients WHERE user_id=$1', [
      s.seller_id,
    ]);
    check(r, 'RECIPIENT_NOT_READY', 'Seller onboarding is required.');
    await this.sync(r.id);
    const p = await one(
      this.db,
      'SELECT payment_intent_id FROM payment_attempts WHERE order_id=$1',
      [s.order_id],
    );
    const remote = await this.controls.provider().payment(p!.payment_intent_id);
    check(
      remote.latest_charge.balance_transaction?.status === 'available' &&
        !remote.latest_charge.disputed,
      'FUNDS_UNAVAILABLE',
      'Provider funds must be available and undisputed.',
    );
    return remote.latest_charge.id;
  }
  async request(actor: Actor, sid: string, reason: string) {
    requireStaff(actor, 'finance');
    const source = await this.refreshInputs(actor, sid);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      return this.controls.approval(
        tx,
        actor,
        'connect_transfer',
        sid,
        await this.terms(tx, sid, source),
        reason,
      );
    });
  }
  async execute(actor: Actor, aid: string) {
    requireStaff(actor, 'finance');
    const a = await one(
      this.db,
      "SELECT * FROM finance_approvals WHERE id=$1 AND kind='connect_transfer'",
      [aid],
    );
    check(a, 'NOT_FOUND', 'Transfer approval not found.', 404);
    const source = await this.refreshInputs(actor, a.resource_id);
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const terms = await this.terms(tx, a.resource_id, source);
      check(
        canonical(terms) === canonical(a.payload),
        'APPROVAL_STALE',
        'Transfer inputs changed.',
      );
      await consumeApproval(tx, actor.id, aid, a.kind, a.resource_id, terms);
      const payload = {
        amount: String(terms.amount_cents),
        currency: 'usd',
        destination: terms.destination,
        source_transaction: source,
        transfer_group: `pixup-${terms.order_id}`,
        'metadata[pixup_transfer_id]': aid,
        'metadata[order_id]': terms.order_id,
      };
      await tx.query(
        'INSERT INTO settlement_transfers(id,settlement_id,order_id,account_id,destination,amount_cents,payload,requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          aid,
          terms.settlement_id,
          terms.order_id,
          terms.account_id,
          terms.destination,
          terms.amount_cents,
          JSON.stringify(payload),
          a.requested_by,
        ],
      );
    });
    await this.syncTransfer(aid);
    return { ok: true };
  }
  async syncTransfer(tid: string, original?: string) {
    const t = await one(this.db, 'SELECT * FROM settlement_transfers WHERE id=$1', [tid]);
    check(t, 'NOT_FOUND', 'Transfer not found.', 404);
    check(
      t.account_id === (await this.controls.provider().identity()),
      'CONNECT_SCOPE',
      'Restore the original platform account.',
    );
    await this.db.query('UPDATE settlement_transfers SET checked_at=now() WHERE id=$1', [tid]);
    try {
      const ref = t.provider_transfer_id || original;
      check(
        ref || Date.parse(t.created_at) > Date.now() - 23 * 3600000,
        'TRANSFER_REVIEW_REQUIRED',
        'Recover the original transfer; do not replay an old ambiguous create.',
      );
      if (!ref) {
        check(
          this.options().connectTransfers,
          'CONNECT_TRANSFER_DISABLED',
          'Restore the transfer gate or reconcile the original provider transfer.',
        );
        await this.db.transaction(async (tx) => {
          await lockChannels(tx);
          await noPaymentException(tx, t.order_id);
          const s = await one(
            tx,
            'SELECT status,amount_cents,seller_id FROM settlements WHERE id=$1',
            [t.settlement_id],
          );
          check(
            s?.status === 'held' && s.amount_cents === t.amount_cents,
            'TRANSFER_HOLD',
            'Settlement changed during transfer recovery.',
          );
          const o = await one(tx, 'SELECT asset_id FROM orders WHERE id=$1', [t.order_id]);
          await requireEligibility(tx, s!.seller_id);
          await noPhysicalIncident(tx, o!.asset_id);
          check(
            !(await one(
              tx,
              "SELECT id FROM payment_refunds WHERE order_id=$1 AND status NOT IN ('failed','canceled') UNION ALL SELECT id FROM payment_adjustments WHERE order_id=$1 AND state NOT IN ('succeeded','failed','canceled') UNION ALL SELECT id FROM support_cases WHERE order_id=$1 AND status='open' UNION ALL SELECT id FROM shipments WHERE order_id=$1 AND state<>'delivered'",
              [t.order_id],
            )),
            'TRANSFER_HOLD',
            'Refund recovery is pending.',
          );
        });
      }
      const remote = ref
        ? await this.controls.provider().transfer(ref)
        : await this.controls.provider().createTransfer(t.payload, `pixup-transfer-${tid}`);
      check(
        (!ref || remote.id === ref) &&
          remote.amount === t.amount_cents &&
          remote.currency === 'usd' &&
          remote.destination === t.destination &&
          remote.source_transaction === t.payload.source_transaction &&
          remote.metadata.pixup_transfer_id === tid &&
          remote.metadata.order_id === t.order_id,
        'TRANSFER_MISMATCH',
        'Provider transfer does not match the approved original transfer.',
      );
      if (t.state === 'succeeded' && (remote.reversed || remote.amount_reversed > 0)) {
        await this.db.transaction(async (tx) => {
          await lockChannels(tx);
          await tx.query(
            "INSERT INTO payment_exceptions(order_id,code,state) VALUES ($1,'TRANSFER_REVERSED','open') ON CONFLICT(order_id,code) DO UPDATE SET state='open',updated_at=now()",
            [t.order_id],
          );
          await tx.query(
            "UPDATE settlement_transfers SET error_code='TRANSFER_REVERSED' WHERE id=$1",
            [tid],
          );
          await audit(tx, t.requested_by, 'connect.external_transfer_reversal_observed', tid, {
            amount_reversed: remote.amount_reversed,
            source: 'provider_reconciliation',
          });
        });
        throw new DomainError(
          409,
          'TRANSFER_REVERSED',
          'An external transfer reversal needs finance accounting review. No automatic refund or second transfer was created.',
        );
      }
      check(
        !remote.reversed && remote.amount_reversed === 0,
        'TRANSFER_REVERSED',
        'Reversed provider transfers require finance accounting review.',
      );
      await this.db.transaction(async (tx) => {
        await lockChannels(tx);
        const current = await one(tx, 'SELECT * FROM settlement_transfers WHERE id=$1 FOR UPDATE', [
          tid,
        ]);
        if (current!.state === 'succeeded') {
          await tx.query('UPDATE settlement_transfers SET error_code=NULL WHERE id=$1', [tid]);
          return;
        }
        check(
          !current!.provider_transfer_id || current!.provider_transfer_id === remote.id,
          'TRANSFER_MISMATCH',
          'Another provider transfer is recorded.',
        );
        const s = (await one(tx, 'SELECT * FROM settlements WHERE id=$1 FOR UPDATE', [
          t.settlement_id,
        ]))!;
        await journal(
          tx,
          `connect-transfer:${tid}`,
          'USD',
          'Stripe test transfer to connected balance; not bank payout',
          [
            [`seller_payable:${s.seller_id}`, t.amount_cents],
            ['stripe_test_clearing', -t.amount_cents],
          ],
        );
        await tx.query(
          "UPDATE settlement_transfers SET provider_transfer_id=$2,state='succeeded',error_code=NULL WHERE id=$1",
          [tid, remote.id],
        );
        await tx.query("UPDATE settlements SET status='released' WHERE id=$1", [s.id]);
        await audit(tx, t.requested_by, 'connect.test_transfer_recorded', tid, {
          provider_transfer_id: remote.id,
          bank_payout_confirmed: false,
        });
      });
    } catch (e) {
      await this.db.query(
        "UPDATE settlement_transfers SET error_code=$2,state=CASE WHEN state='succeeded' THEN state ELSE 'requires_review' END WHERE id=$1",
        [tid, e instanceof DomainError ? e.code : 'PROVIDER_UNAVAILABLE'],
      );
      throw e;
    }
  }
  async recoverTransfer(actor: Actor, tid: string, original: string | undefined, note: string) {
    requireStaff(actor, 'finance');
    await this.syncTransfer(tid, original);
    await audit(this.db, actor.id, 'connect.transfer_reconciled', tid, { note });
    return { ok: true };
  }
  async dashboard(actor: Actor) {
    requireStaff(actor, 'finance');
    return {
      enabled: !!this.options().connectTransfers,
      recipients: (
        await this.db.query(
          'SELECT id,user_id,country,provider_account,state,transfers_active,payouts_enabled,requirements_count,error_code FROM connect_recipients ORDER BY created_at DESC LIMIT 100',
        )
      ).rows,
      transfers: (
        await this.db.query(
          'SELECT id,order_id,settlement_id,destination,amount_cents,state,provider_transfer_id,error_code FROM settlement_transfers ORDER BY created_at DESC LIMIT 100',
        )
      ).rows,
      settlements: (
        await this.db.query(
          "SELECT s.id,s.order_id,s.seller_id,s.amount_cents FROM settlements s JOIN orders o ON o.id=s.order_id WHERE o.payment_provider='stripe_test' AND s.status='held' ORDER BY s.created_at LIMIT 100",
        )
      ).rows,
    };
  }
  async worker() {
    if (!this.options().provider?.identity) return;
    const account = await this.controls.provider().identity();
    for (const r of (
      await this.db.query(
        "SELECT id FROM connect_recipients WHERE platform_account=$1 AND (checked_at IS NULL OR checked_at<now()-interval '5 minutes') ORDER BY checked_at NULLS FIRST LIMIT 3",
        [account],
      )
    ).rows)
      await this.sync(r.id).catch(() => {});
    for (const t of (
      await this.db.query(
        "SELECT id FROM settlement_transfers WHERE account_id=$1 AND state IN ('created','succeeded') AND (checked_at IS NULL OR checked_at<now()-interval '5 minutes') ORDER BY checked_at NULLS FIRST LIMIT 3",
        [account],
      )
    ).rows)
      await this.syncTransfer(t.id).catch(() => {});
  }
}
