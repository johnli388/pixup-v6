import { z } from 'zod';
import { one, type Database, type SQL } from '../../../packages/database/index';
import { check, id, audit, journal, DomainError } from '../../../packages/domain/core';
import { hash } from '../../../packages/domain/security';
import { canonical } from '../../../packages/domain/trust';
import { consumeApproval } from '../../../packages/domain/finance-approval';
import {
  adjustments,
  noPaymentException,
  noPendingAdjustment,
} from '../../../packages/domain/payment-control';
import { requireStaff, type Actor } from './auth';
import { lockChannels } from './channel-core';
import { noPhysicalIncident } from './logistics';
import { PaymentService } from './payments';
import { CommerceService } from './commerce';
import type { PaymentOperationsProvider } from './stripe-control-contracts';
import { verifyStripeSignature } from './stripe';

export const partialInput = z
  .object({
    seller_cents: z.number().int().min(0).max(10000000),
    fee_cents: z.number().int().min(0).max(10000000),
    shipping_cents: z.number().int().min(0).max(10000000),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export class PaymentControls {
  constructor(
    public db: Database,
    public payments: PaymentService,
    private commerce: CommerceService,
  ) {}
  provider() {
    const p = this.payments.options.provider as PaymentOperationsProvider | undefined;
    check(
      p?.identity && p.payment,
      'PAYMENT_OPERATIONS_UNAVAILABLE',
      'Configure a scoped Stripe test provider.',
      503,
    );
    return p;
  }
  async claim(account: string, object: string) {
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      return (await one(
        tx,
        'INSERT INTO payment_control_claims(account_id,object_id) VALUES ($1,$2) ON CONFLICT(account_id,object_id) DO UPDATE SET version=payment_control_claims.version+1 RETURNING version',
        [account, object],
      ))!.version as number;
    });
  }
  async current(tx: SQL, account: string, object: string, version: number) {
    return (
      (
        await one(
          tx,
          'SELECT version FROM payment_control_claims WHERE account_id=$1 AND object_id=$2',
          [account, object],
        )
      )?.version === version
    );
  }
  async approval(
    tx: SQL,
    actor: Actor,
    kind: string,
    resource: string,
    payload: any,
    reason: string,
  ) {
    const aid = id();
    check(
      !(await one(
        tx,
        "SELECT id FROM finance_approvals WHERE kind=$1 AND resource_id=$2 AND state IN ('pending','approved')",
        [kind, resource],
      )),
      'APPROVAL_PENDING',
      'Resolve the outstanding approval first.',
    );
    await tx.query(
      'INSERT INTO finance_approvals(id,kind,resource_id,payload,requested_by,reason) VALUES ($1,$2,$3,$4,$5,$6)',
      [aid, kind, resource, JSON.stringify(payload), actor.id, reason],
    );
    await audit(tx, actor.id, 'finance.approval_requested', aid, { kind, resource });
    return { id: aid };
  }
  async partialTerms(tx: SQL, oid: string, d: z.infer<typeof partialInput>) {
    const o = await one(
      tx,
      "SELECT o.*,p.account_id,p.payment_intent_id FROM orders o JOIN payment_attempts p ON p.order_id=o.id WHERE o.id=$1 AND o.payment_provider='stripe_test' FOR UPDATE OF o",
      [oid],
    );
    check(
      o && o.account_id && o.payment_intent_id && ['paid', 'fulfilled'].includes(o.status),
      'PARTIAL_INELIGIBLE',
      'A scoped, paid cash order is required.',
    );
    await noPaymentException(tx, oid);
    await noPendingAdjustment(tx, oid);
    await noPhysicalIncident(tx, o.asset_id);
    check(
      !(await one(tx, 'SELECT id FROM payment_refunds WHERE order_id=$1', [oid])),
      'REFUND_PENDING',
      'A full-refund history exists; recover that workflow before changing the sale amount.',
    );
    const a = await one(tx, 'SELECT owner_id FROM assets WHERE id=$1 FOR UPDATE', [o.asset_id]);
    check(
      a?.owner_id === o.buyer_id,
      'OWNER_CHANGED',
      'Partial price adjustments require the original buyer to retain title.',
    );
    const settlement = await one(tx, 'SELECT * FROM settlements WHERE order_id=$1 FOR UPDATE', [
      oid,
    ]);
    check(
      settlement?.status === 'held',
      'SETTLEMENT_RELEASED',
      'Partial refunds require held seller funds.',
    );
    const used = await adjustments(tx, oid),
      amount = d.seller_cents + d.fee_cents + d.shipping_cents;
    check(
      amount > 0 &&
        amount < o.total_cents - used.cash &&
        d.seller_cents <= o.seller_cents - used.seller &&
        d.fee_cents <= o.fee_cents - used.fee &&
        d.shipping_cents <= o.shipping_cents - used.shipping,
      'REFUND_ALLOCATION',
      'Choose explicit allocations within the remaining cash and original seller/fee/shipping amounts. Use a full refund to reverse the sale.',
    );
    return {
      order_id: oid,
      account_id: o.account_id,
      payment_intent_id: o.payment_intent_id,
      amount_cents: amount,
      seller_cents: d.seller_cents,
      fee_cents: d.fee_cents,
      shipping_cents: d.shipping_cents,
      prior_cash: used.cash,
    };
  }
  async requestPartial(actor: Actor, oid: string, input: z.infer<typeof partialInput>) {
    requireStaff(actor, 'finance');
    const d = partialInput.parse(input);
    check(
      (await this.reconcile(actor, oid)).state === 'matched',
      'PAYMENT_HOLD',
      'Resolve the external reconciliation first.',
    );
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      return this.approval(
        tx,
        actor,
        'partial_refund',
        oid,
        await this.partialTerms(tx, oid, d),
        d.reason,
      );
    });
  }
  async requestRetry(actor: Actor, oid: string, reason: string) {
    requireStaff(actor, 'finance');
    await this.payments.scope(oid);
    const r = await one(
      this.db,
      'SELECT * FROM payment_refunds WHERE order_id=$1 ORDER BY attempt_number DESC LIMIT 1',
      [oid],
    );
    check(
      r && ['failed', 'canceled'].includes(r.status) && r.provider_refund_id,
      'REFUND_RETRY_INELIGIBLE',
      'A provider-confirmed failed/canceled refund is required.',
    );
    const remote = await this.provider().retrieveRefund!(r.provider_refund_id);
    check(
      remote.id === r.provider_refund_id &&
        remote.metadata.refund_id === r.id &&
        remote.amount === r.amount_cents &&
        remote.currency === 'usd' &&
        remote.payment_intent === r.payment_intent_id &&
        remote.metadata.order_id === oid &&
        ['failed', 'canceled'].includes(remote.status),
      'REFUND_RETRY_INELIGIBLE',
      'The original refund is not confirmed terminal.',
    );
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await noPaymentException(tx, oid);
      await noPendingAdjustment(tx, oid);
      return this.approval(
        tx,
        actor,
        'refund_retry',
        oid,
        {
          order_id: oid,
          previous_refund_id: r.id,
          provider_refund_id: r.provider_refund_id,
          attempt_number: r.attempt_number,
          amount_cents: r.amount_cents,
        },
        reason,
      );
    });
  }
  async execute(actor: Actor, aid: string) {
    requireStaff(actor, 'finance');
    const a = await one(this.db, 'SELECT * FROM finance_approvals WHERE id=$1', [aid]);
    check(a, 'NOT_FOUND', 'Approval not found.', 404);
    await this.payments.scope(a.resource_id);
    if (a.kind === 'partial_refund') {
      check(
        (await this.reconcile(actor, a.resource_id)).state === 'matched',
        'PAYMENT_HOLD',
        'Resolve provider reconciliation before approval execution.',
      );
      await this.db.transaction(async (tx) => {
        await lockChannels(tx);
        const terms = await this.partialTerms(tx, a.resource_id, {
          ...a.payload,
          reason: a.reason,
        });
        check(
          canonical(terms) === canonical(a.payload),
          'APPROVAL_STALE',
          'Refund inputs changed.',
        );
        await consumeApproval(tx, actor.id, aid, a.kind, a.resource_id, terms);
        const payload = {
          payment_intent: terms.payment_intent_id,
          amount: String(terms.amount_cents),
          'metadata[order_id]': terms.order_id,
          'metadata[refund_id]': aid,
        };
        await tx.query(
          'INSERT INTO payment_adjustments(id,order_id,requested_by,amount_cents,seller_cents,fee_cents,shipping_cents,account_id,payment_intent_id,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            aid,
            terms.order_id,
            a.requested_by,
            terms.amount_cents,
            terms.seller_cents,
            terms.fee_cents,
            terms.shipping_cents,
            terms.account_id,
            terms.payment_intent_id,
            JSON.stringify(payload),
          ],
        );
      });
      await this.syncPartial(aid);
      return { ok: true };
    }
    check(a.kind === 'refund_retry', 'ACTION_UNAVAILABLE', 'Unsupported payment approval.');
    const remote = await this.provider().retrieveRefund!(a.payload.provider_refund_id);
    check(
      remote.id === a.payload.provider_refund_id &&
        remote.metadata.refund_id === a.payload.previous_refund_id &&
        remote.amount === a.payload.amount_cents &&
        ['failed', 'canceled'].includes(remote.status),
      'REFUND_RETRY_INELIGIBLE',
      'The original refund is no longer confirmed failed/canceled.',
    );
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const old = await one(
        tx,
        'SELECT * FROM payment_refunds WHERE order_id=$1 ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE',
        [a.resource_id],
      );
      check(
        old &&
          old.id === a.payload.previous_refund_id &&
          ['failed', 'canceled'].includes(old.status),
        'APPROVAL_STALE',
        'Refund attempt changed.',
      );
      const o = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [a.resource_id]);
      await noPaymentException(tx, a.resource_id);
      await noPendingAdjustment(tx, a.resource_id);
      check(
        remote.currency === 'usd' &&
          remote.payment_intent === old.payment_intent_id &&
          remote.metadata.order_id === a.resource_id,
        'REFUND_RETRY_INELIGIBLE',
        'The original refund identity changed.',
      );
      if (old.kind === 'sale') await this.commerce.assertRefundable(tx, o);
      else {
        const asset = await one(tx, 'SELECT owner_id FROM assets WHERE id=$1 FOR UPDATE', [
          o!.asset_id,
        ]);
        const listing = await one(tx, 'SELECT status FROM listings WHERE id=$1 FOR UPDATE', [
          o!.listing_id,
        ]);
        check(
          o!.status === 'pending_payment' &&
            asset?.owner_id === o!.seller_id &&
            listing?.status === 'reserved',
          'INVENTORY_CONFLICT',
          'The original paid reservation changed. Investigate before refunding.',
        );
      }
      await consumeApproval(tx, actor.id, aid, a.kind, a.resource_id, a.payload);
      const rid = id(),
        payload = { ...old.request_payload, 'metadata[refund_id]': rid };
      await tx.query(
        'INSERT INTO payment_refunds(id,order_id,requested_by,reason,amount_cents,payment_intent_id,request_payload,kind,attempt_number,previous_refund_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          rid,
          old.order_id,
          a.requested_by,
          a.reason,
          old.amount_cents,
          old.payment_intent_id,
          JSON.stringify(payload),
          old.kind,
          old.attempt_number + 1,
          old.id,
        ],
      );
    });
    await this.payments.syncRefund(a.resource_id);
    return { ok: true };
  }
  async syncPartial(aid: string, originalId?: string) {
    const initial = await one(this.db, 'SELECT * FROM payment_adjustments WHERE id=$1', [aid]);
    check(initial, 'NOT_FOUND', 'Partial refund not found.', 404);
    if (['succeeded', 'failed', 'canceled'].includes(initial.state)) return;
    await this.payments.scope(initial.order_id);
    const provider = this.provider();
    const r = await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      return one(
        tx,
        "UPDATE payment_adjustments SET sync_version=sync_version+1,checked_at=now() WHERE id=$1 AND state NOT IN ('succeeded','failed','canceled') RETURNING *",
        [aid],
      );
    });
    if (!r) return;
    try {
      const ref = r.provider_refund_id || originalId;
      check(
        ref || Date.parse(r.created_at) > Date.now() - 23 * 3600000,
        'REFUND_REVIEW_REQUIRED',
        'Find the original refund; do not recreate an ambiguous old request.',
      );
      const remote = ref
        ? await provider.retrieveRefund!(ref)
        : await provider.refund!(r.payload, `pixup-partial-${r.id}`);
      check(
        remote.amount === r.amount_cents &&
          remote.currency === 'usd' &&
          remote.payment_intent === r.payment_intent_id &&
          remote.metadata.order_id === r.order_id &&
          remote.metadata.refund_id === r.id &&
          (!r.provider_refund_id || r.provider_refund_id === remote.id),
        'REFUND_MISMATCH',
        'Provider refund does not match the approved partial refund.',
      );
      await this.db.transaction(async (tx) => {
        await lockChannels(tx);
        const current = await one(tx, 'SELECT * FROM payment_adjustments WHERE id=$1 FOR UPDATE', [
          aid,
        ]);
        if (
          current!.sync_version !== r.sync_version ||
          ['succeeded', 'failed', 'canceled'].includes(current!.state)
        )
          return;
        await tx.query(
          'UPDATE payment_adjustments SET state=$2,provider_refund_id=$3,error_code=NULL WHERE id=$1',
          [aid, remote.status, remote.id],
        );
        if (remote.status === 'succeeded') {
          const o = (await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [r.order_id]))!;
          await journal(
            tx,
            `partial-refund:${aid}`,
            'USD',
            'Approved Stripe test partial price adjustment',
            [
              ['stripe_test_clearing', -r.amount_cents],
              [`seller_payable:${o.seller_id}`, r.seller_cents],
              ['platform_fees', r.fee_cents],
              ['shipping_liability', r.shipping_cents],
            ],
          );
          await tx.query(
            "UPDATE settlements SET amount_cents=amount_cents-$2 WHERE order_id=$1 AND status='held'",
            [r.order_id, r.seller_cents],
          );
        }
        await audit(tx, r.requested_by, 'stripe_test.partial_refund_status', aid, {
          status: remote.status,
        });
      });
    } catch (e) {
      await this.db.query(
        "UPDATE payment_adjustments SET error_code=$3,state=CASE WHEN $3='REFUND_REVIEW_REQUIRED' THEN 'requires_review' ELSE state END WHERE id=$1 AND sync_version=$2 AND state NOT IN ('succeeded','failed','canceled')",
        [aid, r.sync_version, e instanceof DomainError ? e.code : 'PROVIDER_UNAVAILABLE'],
      );
      throw e;
    }
  }
  async refreshPartial(actor: Actor, aid: string, original: string | undefined, note: string) {
    requireStaff(actor, 'finance');
    await this.syncPartial(aid, original);
    await audit(this.db, actor.id, 'stripe_test.partial_reconciled', aid, { note });
    return { ok: true };
  }
  async reconcile(actor: Actor, oid: string) {
    requireStaff(actor, 'finance');
    const account = await this.payments.scope(oid);
    check(account, 'PROVIDER_SCOPE_REQUIRED', 'Account scope is required.');
    await this.payments.syncRefund(oid);
    const pending = (
      await this.db.query(
        "SELECT id FROM payment_adjustments WHERE order_id=$1 AND state NOT IN ('succeeded','failed','canceled')",
        [oid],
      )
    ).rows;
    for (const r of pending) await this.syncPartial(r.id);
    const a = await one(
      this.db,
      'SELECT payment_intent_id FROM payment_attempts WHERE order_id=$1',
      [oid],
    );
    check(a?.payment_intent_id, 'PAYMENT_NOT_PAID', 'Reconcile a paid cash payment.');
    const version = await this.claim(account, `reconcile:${oid}`),
      p = await this.provider().payment(a.payment_intent_id);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      check(
        await this.current(tx, account, `reconcile:${oid}`, version),
        'RECONCILIATION_STALE',
        'A newer reconciliation is running.',
      );
      const o = (await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [oid]))!;
      const refunds = (
        await tx.query(
          'SELECT id,provider_refund_id,amount_cents,status AS state FROM payment_refunds WHERE order_id=$1 UNION ALL SELECT id,provider_refund_id,amount_cents,state FROM payment_adjustments WHERE order_id=$1',
          [oid],
        )
      ).rows;
      const expectedCash = refunds
        .filter((r) => r.state === 'succeeded')
        .reduce((n, r) => n + r.amount_cents, 0);
      const knownDisputes = (
        await tx.query('SELECT status FROM provider_disputes WHERE order_id=$1', [oid])
      ).rows;
      const refundMatch =
        p.refunds.every((r) =>
          refunds.some(
            (l) =>
              l.provider_refund_id === r.id &&
              l.amount_cents === r.amount &&
              l.state === r.status &&
              r.currency === 'usd' &&
              r.payment_intent === a.payment_intent_id,
          ),
        ) &&
        refunds
          .filter((r) => r.provider_refund_id)
          .every((l) => p.refunds.some((r) => r.id === l.provider_refund_id));
      const match =
        p.id === a.payment_intent_id &&
        p.metadata.order_id === oid &&
        p.amount_received === o.total_cents &&
        p.currency === 'usd' &&
        p.latest_charge.amount === o.total_cents &&
        p.latest_charge.currency === 'usd' &&
        p.latest_charge.amount_refunded === expectedCash &&
        refundMatch &&
        (!p.latest_charge.disputed ||
          (knownDisputes.length > 0 &&
            knownDisputes.every((d) => ['won', 'warning_closed'].includes(d.status))));
      const expected = { cash_cents: o.total_cents, refunded_cents: expectedCash },
        observed = {
          payment_intent: p.id,
          charge_id: p.latest_charge.id,
          cash_cents: p.amount_received,
          refunded_cents: p.latest_charge.amount_refunded,
          disputed: p.latest_charge.disputed,
          refunds: p.refunds.map((r) => ({ id: r.id, amount: r.amount, status: r.status })),
          balance: p.latest_charge.balance_transaction,
        };
      const rid = id();
      await tx.query(
        'INSERT INTO payment_reconciliations(id,order_id,account_id,requested_by,state,expected,observed) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          rid,
          oid,
          account,
          actor.id,
          match ? 'matched' : 'mismatch',
          JSON.stringify(expected),
          JSON.stringify(observed),
        ],
      );
      await tx.query(
        "INSERT INTO payment_exceptions(order_id,code,state,run_id) VALUES ($1,'PROVIDER_RECONCILIATION',$2,$3) ON CONFLICT(order_id,code) DO UPDATE SET state=EXCLUDED.state,run_id=EXCLUDED.run_id,updated_at=now()",
        [oid, match ? 'resolved' : 'open', rid],
      );
      await audit(tx, actor.id, 'payment.external_reconciled', oid, {
        run_id: rid,
        state: match ? 'matched' : 'mismatch',
      });
      return { id: rid, state: match ? 'matched' : 'mismatch' };
    });
  }
  async syncDispute(did: string) {
    const account = await this.provider().identity(),
      version = await this.claim(account, did),
      d = await this.provider().dispute(did);
    check(
      d.id === did && d.currency === 'usd',
      'DISPUTE_SCOPE',
      'Unsupported dispute identity or currency.',
    );
    const a = await one(
      this.db,
      'SELECT order_id FROM payment_attempts WHERE payment_intent_id=$1 AND account_id=$2',
      [d.payment_intent, account],
    );
    check(a, 'DISPUTE_UNMAPPED', 'The dispute has no scoped local payment.');
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      if (!(await this.current(tx, account, did, version))) return;
      const o = (await one(tx, 'SELECT * FROM orders WHERE id=$1', [a.order_id]))!;
      check(d.amount <= o.total_cents, 'DISPUTE_SCOPE', 'Disputed amount exceeds this order.');
      await tx.query(
        'INSERT INTO provider_disputes(account_id,id,order_id,status,amount_cents,currency,due_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(account_id,id) DO UPDATE SET status=EXCLUDED.status,amount_cents=EXCLUDED.amount_cents,due_at=EXCLUDED.due_at,checked_at=now()',
        [
          account,
          did,
          o.id,
          d.status,
          d.amount,
          d.currency,
          d.evidence_details.due_by
            ? new Date(d.evidence_details.due_by * 1000).toISOString()
            : null,
        ],
      );
      await audit(tx, o.buyer_id, 'payment.provider_dispute_observed', did, {
        source: 'provider_worker',
        status: d.status,
      });
    });
    return { ok: true };
  }
  async dispute(actor: Actor, did: string, note: string) {
    requireStaff(actor, 'finance');
    await this.syncDispute(did);
    await audit(this.db, actor.id, 'payment.dispute_refreshed', did, { note });
    return { ok: true };
  }
  async webhook(raw: Buffer, signature: string) {
    verifyStripeSignature(raw, signature, this.payments.options.webhookSecret);
    let e: any;
    try {
      e = z
        .object({
          id: z.string().startsWith('evt_'),
          type: z.string(),
          livemode: z.literal(false),
          account: z.string().optional(),
          data: z.object({
            object: z.object({ id: z.string(), payment_intent: z.string().nullable().optional() }),
          }),
        })
        .parse(JSON.parse(raw.toString()));
    } catch {
      throw new DomainError(400, 'WEBHOOK_EVENT_INVALID', 'Expected a signed Stripe test event.');
    }
    if (e.type.startsWith('checkout.session.')) return null;
    if (
      ![
        'refund.created',
        'refund.updated',
        'refund.failed',
        'charge.dispute.created',
        'charge.dispute.updated',
        'charge.dispute.closed',
        'charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated',
      ].includes(e.type)
    )
      return { received: true };
    const account = await this.provider().identity();
    check(
      !e.account || e.account === account,
      'WEBHOOK_ACCOUNT',
      'Unexpected connected-account event.',
      400,
    );
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const h = hash(raw.toString()),
        old = await one(
          tx,
          'SELECT payload_hash FROM payment_control_events WHERE account_id=$1 AND event_id=$2',
          [account, e.id],
        );
      check(
        !old || old.payload_hash === h,
        'WEBHOOK_CONFLICT',
        'An event ID has different contents.',
        400,
      );
      await tx.query(
        'INSERT INTO payment_control_events(account_id,event_id,event_type,object_id,payment_intent_id,payload_hash) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [account, e.id, e.type, e.data.object.id, e.data.object.payment_intent || null, h],
      );
    });
    return { received: true };
  }
  async worker() {
    if (!this.payments.options.provider?.identity) return;
    const account = await this.provider().identity();
    const events = (
      await this.db.query(
        "SELECT * FROM payment_control_events WHERE account_id=$1 AND processed_at IS NULL AND (checked_at IS NULL OR checked_at<now()-interval '1 minute') ORDER BY checked_at NULLS FIRST,created_at LIMIT 5",
        [account],
      )
    ).rows;
    for (const e of events) {
      await this.db.query(
        'UPDATE payment_control_events SET checked_at=now() WHERE account_id=$1 AND event_id=$2',
        [account, e.event_id],
      );
      try {
        if (e.event_type.startsWith('charge.dispute.')) await this.syncDispute(e.object_id);
        else {
          const remote = await this.provider().retrieveRefund!(e.object_id);
          const partial = await one(
            this.db,
            'SELECT id FROM payment_adjustments WHERE id=$1 AND account_id=$2',
            [remote.metadata.refund_id, account],
          );
          if (partial) await this.syncPartial(partial.id, remote.id);
          else {
            const full = await one(
              this.db,
              'SELECT r.* FROM payment_refunds r JOIN payment_attempts p ON p.order_id=r.order_id WHERE r.id=$1 AND p.account_id=$2',
              [remote.metadata.refund_id, account],
            );
            check(full, 'REFUND_UNMAPPED', 'Refund needs finance reconciliation.');
            const latest = await one(
              this.db,
              'SELECT id FROM payment_refunds WHERE order_id=$1 ORDER BY attempt_number DESC LIMIT 1',
              [full.order_id],
            );
            if (latest?.id === full.id) await this.payments.syncRefund(full.order_id, remote.id);
            else
              check(
                full.provider_refund_id === remote.id &&
                  full.amount_cents === remote.amount &&
                  full.payment_intent_id === remote.payment_intent &&
                  full.status === remote.status &&
                  ['failed', 'canceled'].includes(remote.status),
                'REFUND_HISTORY_CHANGED',
                'A historical refund outcome changed; reconcile the payment.',
              );
          }
        }
        await this.db.query(
          'UPDATE payment_control_events SET processed_at=now(),error_code=NULL WHERE account_id=$1 AND event_id=$2',
          [account, e.event_id],
        );
      } catch (err) {
        await this.db.query(
          'UPDATE payment_control_events SET error_code=$3 WHERE account_id=$1 AND event_id=$2',
          [account, e.event_id, err instanceof DomainError ? err.code : 'PROVIDER_UNAVAILABLE'],
        );
      }
    }
    const rows = (
      await this.db.query(
        "SELECT id FROM payment_adjustments WHERE account_id=$1 AND state IN ('created','pending','requires_action') AND (checked_at IS NULL OR checked_at<now()-interval '1 minute') ORDER BY checked_at NULLS FIRST LIMIT 5",
        [account],
      )
    ).rows;
    for (const r of rows) await this.syncPartial(r.id).catch(() => {});
  }
  async dashboard(actor: Actor) {
    requireStaff(actor, 'finance');
    return {
      adjustments: (
        await this.db.query(
          'SELECT id,order_id,amount_cents,seller_cents,fee_cents,shipping_cents,state,provider_refund_id,error_code,created_at FROM payment_adjustments ORDER BY created_at DESC LIMIT 100',
        )
      ).rows,
      disputes: (
        await this.db.query('SELECT * FROM provider_disputes ORDER BY checked_at DESC LIMIT 100')
      ).rows,
      reconciliations: (
        await this.db.query(
          'SELECT * FROM payment_reconciliations ORDER BY created_at DESC LIMIT 100',
        )
      ).rows,
      events: (
        await this.db.query(
          'SELECT account_id,event_id,event_type,object_id,error_code FROM payment_control_events WHERE processed_at IS NULL ORDER BY created_at LIMIT 100',
        )
      ).rows,
      refunds: (
        await this.db.query(
          'SELECT id,order_id,attempt_number,previous_refund_id,amount_cents,status,provider_refund_id FROM payment_refunds ORDER BY created_at DESC LIMIT 100',
        )
      ).rows,
      scopes: (
        await this.db.query(
          'SELECT order_id,account_id,provider_mode,provider_session_id FROM payment_attempts ORDER BY created_at DESC LIMIT 100',
        )
      ).rows,
    };
  }
  async order(actor: Actor, oid: string) {
    check(
      await one(this.db, 'SELECT id FROM orders WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)', [
        oid,
        actor.id,
      ]),
      'NOT_FOUND',
      'Order not found.',
      404,
    );
    return {
      adjustments: (
        await this.db.query(
          'SELECT id,amount_cents,state,created_at FROM payment_adjustments WHERE order_id=$1 ORDER BY created_at',
          [oid],
        )
      ).rows,
      disputes: (
        await this.db.query(
          'SELECT status,amount_cents,checked_at FROM provider_disputes WHERE order_id=$1',
          [oid],
        )
      ).rows,
    };
  }
}
