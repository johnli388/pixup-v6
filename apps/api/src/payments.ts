import { lockChannels, saleEligible, channelRefunded } from './channel-core';
import { one, type Database, type SQL } from '../../../packages/database/index';
import { audit, check, id, journal, notify } from '../../../packages/domain/core';
import { requireStaff, type Actor } from './auth';
import {
  adjustments,
  noPaymentException,
  noPendingAdjustment,
} from '../../../packages/domain/payment-control';
import { hash } from '../../../packages/domain/security';
import { CommerceService } from './commerce';
import type {
  PaymentStatus,
  PaymentConfiguration,
  RefundStatus,
} from '../../../packages/domain/contracts';
import {
  type CheckoutProvider,
  checkoutPayload,
  type StripeSession,
  verifyStripeEvent,
} from './stripe';

export type PaymentOptions = {
  provider?: CheckoutProvider;
  origin?: string;
  webhookSecret?: string;
  connectCountries?: string[];
  connectTransfers?: boolean;
};
export class PaymentService {
  constructor(
    private db: Database,
    private commerce: CommerceService,
    public options: PaymentOptions,
  ) {}
  async scope(orderId: string) {
    const provider = this.provider();
    if (!provider.identity) return null; // Injectable legacy fixtures have no external account.
    const account = await provider.identity();
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const a = await one(tx, 'SELECT * FROM payment_attempts WHERE order_id=$1 FOR UPDATE', [
        orderId,
      ]);
      check(a, 'NOT_FOUND', 'Payment attempt not found.', 404);
      check(
        !a.account_id || a.account_id === account,
        'PROVIDER_ACCOUNT_MISMATCH',
        'Restore the original Stripe account before reconciling this order.',
        409,
      );
      check(
        a.account_id || (!a.request_payload && !a.provider_session_id),
        'PAYMENT_SCOPE_REVIEW',
        'Finance must bind this legacy payment to its verified original Stripe account.',
        409,
      );
      if (!a.account_id)
        await tx.query(
          "UPDATE payment_attempts SET account_id=$2,provider_mode='test' WHERE order_id=$1",
          [orderId, account],
        );
    });
    return account;
  }
  async bindScope(actor: Actor, orderId: string, sessionId: string, note: string) {
    requireStaff(actor, 'finance');
    const p = this.provider();
    check(
      p.identity,
      'PROVIDER_SCOPE_REQUIRED',
      'Provider account verification is unavailable.',
      503,
    );
    const account = await p.identity(),
      session = await p.retrieve(sessionId);
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const o = await one(
          tx,
          "SELECT * FROM orders WHERE id=$1 AND payment_provider='stripe_test' FOR UPDATE",
          [orderId],
        ),
        a = await one(tx, 'SELECT * FROM payment_attempts WHERE order_id=$1 FOR UPDATE', [orderId]);
      check(o && a, 'NOT_FOUND', 'Stripe payment not found.', 404);
      this.validateSession(o, a, session);
      check(
        !a.account_id || a.account_id === account,
        'PROVIDER_ACCOUNT_MISMATCH',
        'This payment is already bound to another account.',
      );
      await tx.query(
        "UPDATE payment_attempts SET account_id=$2,provider_mode='test' WHERE order_id=$1",
        [orderId, account],
      );
      await audit(tx, actor.id, 'payment.scope_bound', orderId, {
        account,
        note,
        session_id: sessionId,
      });
    });
    return { ok: true };
  }
  configuration(): PaymentConfiguration {
    return {
      provider: this.options.provider ? 'stripe_test' : 'demo',
      test_mode: true,
      payment_methods: this.options.provider ? ['card'] : [],
      webhooks_configured: !!this.options.webhookSecret,
    };
  }
  private provider() {
    check(
      this.options.provider,
      'PAYMENTS_NOT_CONFIGURED',
      'Stripe is not configured. Restore the test key to resume this order.',
      503,
    );
    return this.options.provider;
  }
  private async authorize(actor: Actor, orderId: string) {
    const order = await one(this.db, 'SELECT * FROM orders WHERE id=$1 AND buyer_id=$2', [
      orderId,
      actor.id,
    ]);
    check(order, 'NOT_FOUND', 'Order not found.', 404);
    check(
      order.payment_provider === 'stripe_test',
      'PAYMENT_PROVIDER_MISMATCH',
      'This order uses demo payment.',
    );
    return order;
  }
  async start(actor: Actor, orderId: string) {
    await this.authorize(actor, orderId);
    await this.scope(orderId);
    this.provider();
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const order = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      const attempt = await one(tx, 'SELECT * FROM payment_attempts WHERE order_id=$1 FOR UPDATE', [
        orderId,
      ]);
      check(attempt, 'PAYMENT_ATTEMPT_MISSING', 'Payment record is missing. Contact support.', 409);
      if (order!.status !== 'pending_payment' || attempt.request_payload) return;
      // Stripe Checkout has a 30-minute minimum expiry. An unstarted reservation
      // can be canceled safely; never extend or recreate a previously sent request.
      if (new Date(order!.reservation_expires_at).getTime() < Date.now() + 31 * 60000) {
        await this.commerce.cancel(tx, order);
        await tx.query("UPDATE payment_attempts SET status='canceled' WHERE id=$1", [attempt.id]);
        return;
      }
      const origin = this.options.origin || 'http://127.0.0.1:3000';
      const payload = checkoutPayload(
        orderId,
        order!.total_cents,
        new Date(order!.reservation_expires_at),
        origin,
      );
      await tx.query('UPDATE payment_attempts SET request_payload=$2 WHERE id=$1', [
        attempt.id,
        JSON.stringify(payload),
      ]);
    });
    return this.sync(orderId);
  }
  async status(actor: Actor, orderId: string) {
    await this.authorize(actor, orderId);
    await this.syncRefund(orderId);
    return this.sync(orderId);
  }
  async cancel(actor: Actor, orderId: string) {
    await this.authorize(actor, orderId);
    const canceled = await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const order = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      const attempt = await one(tx, 'SELECT * FROM payment_attempts WHERE order_id=$1 FOR UPDATE', [
        orderId,
      ]);
      if (order!.status !== 'pending_payment') return true;
      if (attempt!.request_payload) return false;
      await this.commerce.cancel(tx, order);
      await tx.query("UPDATE payment_attempts SET status='canceled' WHERE order_id=$1", [orderId]);
      return true;
    });
    if (canceled) return this.summary(orderId);
    // Resolve an ambiguous create by replaying its durable key before expiring.
    const session = await this.resolve(orderId);
    if (!session) return this.summary(orderId);
    let current = session;
    if (session.status === 'open') {
      try {
        current = await this.provider().expire(session.id);
      } catch {
        current = await this.provider().retrieve(session.id);
      }
    }
    await this.apply(orderId, current);
    return this.summary(orderId);
  }
  private async resolve(orderId: string) {
    await this.scope(orderId);
    const attempt = await one(this.db, 'SELECT * FROM payment_attempts WHERE order_id=$1', [
      orderId,
    ]);
    check(attempt, 'NOT_FOUND', 'Payment attempt not found.', 404);
    if (
      !attempt.request_payload ||
      ['succeeded', 'canceled', 'requires_review'].includes(attempt.status)
    )
      return null;
    await this.db.query('UPDATE payment_attempts SET last_checked_at=now() WHERE id=$1', [
      attempt.id,
    ]);
    if (attempt.provider_session_id) return this.provider().retrieve(attempt.provider_session_id);
    // Stripe can prune idempotency keys after 24h. Never create a second session
    // after that window; preserve the hold for manual reconciliation instead.
    if (new Date(attempt.created_at).getTime() < Date.now() - 23 * 3600000) {
      await this.db.transaction(async (tx) => {
        await lockChannels(tx);
        await tx.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
        const current = await one(
          tx,
          'SELECT * FROM payment_attempts WHERE order_id=$1 FOR UPDATE',
          [orderId],
        );
        if (current?.status === 'created' && !current.provider_session_id)
          await this.markReview(tx, orderId, 'ambiguous_create');
      });
      return null;
    }
    return this.provider().create(attempt.request_payload, `pixup-checkout-${attempt.id}`);
  }
  private async summary(orderId: string, url: string | null = null): Promise<PaymentStatus> {
    const row = await one<Omit<PaymentStatus, 'url'>>(
      this.db,
      `SELECT o.id,o.status,o.reservation_expires_at,p.status AS payment_status,p.provider_payment_status
      FROM orders o JOIN payment_attempts p ON p.order_id=o.id WHERE o.id=$1`,
      [orderId],
    );
    check(row, 'NOT_FOUND', 'Payment record not found.', 404);
    return {
      ...row,
      refund: await this.refundSummary(orderId),
      reservation_expires_at: new Date(row.reservation_expires_at).toISOString(),
      url: row?.status === 'pending_payment' && row?.payment_status === 'open' ? url : null,
    };
  }
  async sync(orderId: string) {
    const session = await this.resolve(orderId);
    if (session) await this.apply(orderId, session);
    return this.summary(orderId, session?.status === 'open' ? session.url : null);
  }
  private validateSession(order: any, attempt: any, session: StripeSession) {
    check(
      !session.livemode &&
        session.metadata.order_id === order.id &&
        session.client_reference_id === order.id &&
        session.amount_total === order.total_cents &&
        session.currency === 'usd' &&
        (!attempt.provider_session_id || attempt.provider_session_id === session.id),
      'PAYMENT_MISMATCH',
      'Stripe amount, currency or order reference does not match. Contact support.',
    );
  }
  private async markReview(
    tx: SQL,
    orderId: string,
    reason: 'ambiguous_create' | 'inventory_exception',
  ) {
    await tx.query("UPDATE payment_attempts SET status='requires_review' WHERE order_id=$1", [
      orderId,
    ]);
    await tx.query(
      `INSERT INTO payment_reviews(order_id,reason) VALUES ($1,$2)
      ON CONFLICT(order_id) DO UPDATE SET status='open',resolved_at=NULL,reason=EXCLUDED.reason`,
      [orderId, reason],
    );
  }
  private async closeReview(tx: SQL, orderId: string) {
    await tx.query(
      "UPDATE payment_reviews SET status='resolved',resolved_at=now(),version=version+1 WHERE order_id=$1 AND status='open'",
      [orderId],
    );
  }
  private async apply(
    orderId: string,
    session: StripeSession,
    review?: { actor: Actor; version: number; note: string },
  ) {
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const order = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      const attempt = await one(tx, 'SELECT * FROM payment_attempts WHERE order_id=$1 FOR UPDATE', [
        orderId,
      ]);
      check(
        order && attempt && order.payment_provider === 'stripe_test',
        'PAYMENT_MISMATCH',
        'Payment does not match an order.',
      );
      this.validateSession(order, attempt, session);
      if (session.url)
        check(
          new URL(session.url).origin === 'https://checkout.stripe.com',
          'PAYMENT_URL_INVALID',
          'Unexpected checkout destination.',
          502,
        );
      if (review) {
        const current = await one(
          tx,
          'SELECT * FROM payment_reviews WHERE order_id=$1 FOR UPDATE',
          [orderId],
        );
        check(
          current?.status === 'open' && current.version === review.version,
          'VERSION_CONFLICT',
          'This review changed. Refresh before acting.',
        );
        await tx.query('UPDATE payment_reviews SET version=version+1 WHERE order_id=$1', [orderId]);
        await audit(tx, review.actor.id, 'payment.review.reconciled', orderId, {
          note: review.note,
          session_id: session.id,
        });
      }
      if (await one(tx, 'SELECT id FROM payment_refunds WHERE order_id=$1', [orderId])) return;
      if (
        ['succeeded', 'canceled'].includes(attempt.status) ||
        (attempt.status === 'requires_review' && !review)
      )
        return;
      await tx.query(
        'UPDATE payment_attempts SET provider_session_id=$2,payment_intent_id=$3,provider_payment_status=$4,last_checked_at=now() WHERE id=$1',
        [attempt.id, session.id, session.payment_intent, session.payment_status],
      );
      if (
        session.status === 'complete' &&
        (session.payment_status === 'paid' ||
          (order.total_cents === 0 && session.payment_status === 'no_payment_required'))
      ) {
        const asset = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [
          order.asset_id,
        ]);
        const listing = await one(tx, 'SELECT status FROM listings WHERE id=$1', [
          order.listing_id,
        ]);
        if (
          order.status !== 'pending_payment' ||
          asset?.owner_id !== order.seller_id ||
          !(await saleEligible(tx, asset, order.channel)) ||
          listing?.status !== 'reserved'
        ) {
          await this.markReview(tx, orderId, 'inventory_exception');
          await audit(tx, order.buyer_id, 'stripe_test.payment_requires_review', orderId);
          return;
        }
        await this.commerce.completePayment(tx, order);
        await tx.query("UPDATE payment_attempts SET status='succeeded' WHERE id=$1", [attempt.id]);
        await this.closeReview(tx, orderId);
      } else if (session.status === 'expired' && session.payment_status === 'unpaid') {
        if (order.status === 'pending_payment') await this.commerce.cancel(tx, order);
        await tx.query("UPDATE payment_attempts SET status='canceled' WHERE id=$1", [attempt.id]);
        await this.closeReview(tx, orderId);
      } else await tx.query("UPDATE payment_attempts SET status='open' WHERE id=$1", [attempt.id]);
    });
  }
  private async refundSummary(orderId: string) {
    return (
      (await one<RefundStatus>(
        this.db,
        'SELECT id,status,amount_cents FROM payment_refunds WHERE order_id=$1 ORDER BY attempt_number DESC LIMIT 1',
        [orderId],
      )) || null
    );
  }
  async queue(actor: Actor, cursor?: string) {
    requireStaff(actor, 'finance');
    const rows = (
      await this.db.query(
        `SELECT o.id,o.status,o.total_cents,o.credit_units,a.title,
      COALESCE((SELECT sum(amount_cents) FROM payment_adjustments WHERE order_id=o.id AND state='succeeded'),0)::int AS adjusted_cash_cents,
      p.status AS payment_status,p.provider_session_id,p.created_at,
      v.reason AS review_reason,v.status AS review_status,v.assigned_to,v.version,v.due_at,
      r.id AS refund_id,r.status AS refund_status,r.amount_cents AS refund_cents,r.provider_refund_id
      FROM orders o JOIN payment_attempts p ON p.order_id=o.id JOIN assets a ON a.id=o.asset_id
      LEFT JOIN payment_reviews v ON v.order_id=o.id LEFT JOIN LATERAL (SELECT * FROM payment_refunds WHERE order_id=o.id ORDER BY attempt_number DESC LIMIT 1) r ON true
      WHERE ($1::text IS NULL OR o.id>$1) ORDER BY o.id LIMIT 26`,
        [cursor || null],
      )
    ).rows;
    const more = rows.length > 25;
    return { items: rows.slice(0, 25), next_cursor: more ? rows[24].id : null };
  }
  async claim(actor: Actor, orderId: string, version: number) {
    requireStaff(actor, 'finance');
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await tx.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      const result = await tx.query(
        `UPDATE payment_reviews SET assigned_to=$2,version=version+1
        WHERE order_id=$1 AND version=$3 AND status='open' RETURNING order_id`,
        [orderId, actor.id, version],
      );
      check(
        result.rows.length,
        'VERSION_CONFLICT',
        'This review changed. Refresh before assigning.',
      );
      await audit(tx, actor.id, 'payment.review.assigned', orderId);
    });
    return { ok: true };
  }
  async review(
    actor: Actor,
    orderId: string,
    input: { session_id?: string; expected_version: number; note: string; cancel: boolean },
  ) {
    requireStaff(actor, 'finance');
    await this.scope(orderId);
    const order = await one(
      this.db,
      "SELECT * FROM orders WHERE id=$1 AND payment_provider='stripe_test'",
      [orderId],
    );
    const attempt = await one(this.db, 'SELECT * FROM payment_attempts WHERE order_id=$1', [
      orderId,
    ]);
    const review = await one(this.db, 'SELECT * FROM payment_reviews WHERE order_id=$1', [orderId]);
    check(
      order && attempt && review?.status === 'open',
      'NOT_FOUND',
      'Open payment review not found.',
      404,
    );
    check(
      review.version === input.expected_version,
      'VERSION_CONFLICT',
      'This review changed. Refresh before acting.',
    );
    const sid = attempt.provider_session_id || input.session_id;
    check(
      sid,
      'SESSION_REQUIRED',
      'Find the original Checkout Session in the Stripe test dashboard and supply its ID. No new charge will be created.',
      400,
    );
    let session = await this.provider().retrieve(sid);
    this.validateSession(order, attempt, session);
    if (input.cancel && session.status === 'open') {
      try {
        session = await this.provider().expire(sid);
      } catch {
        session = await this.provider().retrieve(sid);
      }
    }
    await this.apply(orderId, session, {
      actor,
      version: input.expected_version,
      note: input.note,
    });
    return this.summary(orderId);
  }
  async requestRefund(actor: Actor, orderId: string, reason: string) {
    requireStaff(actor, 'finance');
    await this.scope(orderId);
    const existing = await one(this.db, 'SELECT id FROM payment_refunds WHERE order_id=$1', [
      orderId,
    ]);
    if (existing) {
      await this.syncRefund(orderId);
      return this.summary(orderId);
    }
    const attempt = await one(this.db, 'SELECT * FROM payment_attempts WHERE order_id=$1', [
      orderId,
    ]);
    check(
      attempt?.provider_session_id,
      'SESSION_REQUIRED',
      'Reconcile the original Stripe session before refunding.',
      409,
    );
    const session = await this.provider().retrieve(attempt.provider_session_id);
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const order = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      const payment = await one(tx, 'SELECT * FROM payment_attempts WHERE order_id=$1 FOR UPDATE', [
        orderId,
      ]);
      check(
        order?.payment_provider === 'stripe_test' && payment,
        'NOT_FOUND',
        'Stripe order not found.',
        404,
      );
      if (await one(tx, 'SELECT id FROM payment_refunds WHERE order_id=$1', [orderId])) return;
      await noPaymentException(tx, orderId);
      await noPendingAdjustment(tx, orderId);
      this.validateSession(order, payment, session);
      check(
        session.status === 'complete' &&
          (session.payment_status === 'paid' ||
            (order.total_cents === 0 && session.payment_status === 'no_payment_required')),
        'PAYMENT_NOT_PAID',
        'Only provider-confirmed payments can be refunded.',
      );
      check(
        order.total_cents === 0 ||
          (session.payment_intent && this.provider().refund && this.provider().retrieveRefund),
        'REFUNDS_UNAVAILABLE',
        'Provider refunds are not configured.',
        503,
      );
      const asset = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [order.asset_id]);
      const kind = order.status === 'pending_payment' ? 'unallocated_payment' : 'sale';
      if (kind === 'sale') await this.commerce.assertRefundable(tx, order);
      else {
        check(
          asset?.owner_id === order.seller_id,
          'INVENTORY_CONFLICT',
          'Ownership changed. Investigate before refunding.',
        );
        check(
          (await one(tx, 'SELECT status FROM listings WHERE id=$1', [order.listing_id]))?.status ===
            'reserved',
          'INVENTORY_CONFLICT',
          'Reservation changed. Investigate before refunding.',
        );
      }
      const refundId = id();
      const adjusted = await adjustments(tx, orderId),
        refundCash = order.total_cents - adjusted.cash;
      const payload = {
        payment_intent: session.payment_intent || '',
        amount: String(refundCash),
        'metadata[order_id]': orderId,
        'metadata[refund_id]': refundId,
      };
      await tx.query(
        `INSERT INTO payment_refunds(id,order_id,requested_by,reason,amount_cents,payment_intent_id,request_payload,kind)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          refundId,
          orderId,
          actor.id,
          reason,
          refundCash,
          session.payment_intent,
          JSON.stringify(payload),
          kind,
        ],
      );
      if (kind === 'unallocated_payment' && order.total_cents)
        await journal(
          tx,
          `unallocated-payment:${orderId}`,
          'USD',
          'Confirmed payment held for refund',
          [
            ['stripe_test_clearing', order.total_cents],
            [`order_refund_liability:${orderId}`, -order.total_cents],
          ],
        );
      await audit(tx, actor.id, 'stripe_test.refund.requested', orderId, {
        reason,
        refund_id: refundId,
        amount_cents: refundCash,
      });
    });
    await this.syncRefund(orderId);
    return this.summary(orderId);
  }
  async reconcileRefund(
    actor: Actor,
    orderId: string,
    input: { refund_id?: string; note: string },
  ) {
    requireStaff(actor, 'finance');
    check(
      await one(this.db, 'SELECT id FROM payment_refunds WHERE order_id=$1', [orderId]),
      'NOT_FOUND',
      'Refund not found.',
      404,
    );
    await this.syncRefund(orderId, input.refund_id);
    await audit(this.db, actor.id, 'stripe_test.refund.reconciled', orderId, { note: input.note });
    return this.summary(orderId);
  }
  async syncRefund(orderId: string, suppliedId?: string) {
    const refund = await one(
      this.db,
      'SELECT * FROM payment_refunds WHERE order_id=$1 ORDER BY attempt_number DESC LIMIT 1',
      [orderId],
    );
    if (!refund || ['succeeded', 'failed', 'canceled'].includes(refund.status)) return;
    await this.scope(orderId);
    const providerId = refund.provider_refund_id || suppliedId;
    if (
      refund.amount_cents &&
      !providerId &&
      new Date(refund.created_at).getTime() < Date.now() - 23 * 3600000
    ) {
      await this.db.query(
        "UPDATE payment_refunds SET status='requires_review',last_checked_at=now() WHERE id=$1 AND provider_refund_id IS NULL AND status='created'",
        [refund.id],
      );
      return;
    }
    await this.db.query('UPDATE payment_refunds SET last_checked_at=now() WHERE id=$1', [
      refund.id,
    ]);
    const provider = refund.amount_cents ? this.provider() : null;
    check(
      !provider || (provider.refund && provider.retrieveRefund),
      'REFUNDS_UNAVAILABLE',
      'Provider refunds are not configured.',
      503,
    );
    const result = !provider
      ? null
      : providerId
        ? await provider.retrieveRefund!(providerId)
        : await provider.refund!(refund.request_payload, `pixup-refund-${refund.id}`);
    check(
      (!result && refund.amount_cents === 0) ||
        (result &&
          result.amount === refund.amount_cents &&
          result.currency === 'usd' &&
          result.payment_intent === refund.payment_intent_id &&
          result.metadata.order_id === orderId &&
          result.metadata.refund_id === refund.id &&
          (!refund.provider_refund_id || refund.provider_refund_id === result.id)),
      'REFUND_MISMATCH',
      'Refund amount or reference does not match. Funds and inventory remain held.',
    );
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const order = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      const current = await one(tx, 'SELECT * FROM payment_refunds WHERE id=$1 FOR UPDATE', [
        refund.id,
      ]);
      if (['succeeded', 'failed', 'canceled'].includes(current!.status)) return;
      check(
        !current!.provider_refund_id || current!.provider_refund_id === result?.id,
        'REFUND_MISMATCH',
        'Another refund reference is already recorded.',
      );
      const status = result?.status || 'succeeded';
      await tx.query('UPDATE payment_refunds SET provider_refund_id=$2,status=$3 WHERE id=$1', [
        refund.id,
        result?.id || null,
        status,
      ]);
      if (status === 'succeeded') {
        await tx.query('SELECT id FROM assets WHERE id=$1 FOR UPDATE', [order!.asset_id]);
        if (current!.kind === 'sale') {
          await this.commerce.assertRefundable(tx, order, true);
          await this.commerce.reverseRefund(tx, order, { id: current!.requested_by });
        } else {
          if (order!.total_cents)
            await journal(
              tx,
              `refund:${orderId}`,
              'USD',
              'Unallocated Stripe test payment returned',
              [
                ['stripe_test_clearing', -order!.total_cents],
                [`order_refund_liability:${orderId}`, order!.total_cents],
              ],
            );
          await this.commerce.cancel(tx, order);
          await tx.query("UPDATE orders SET status='refunded' WHERE id=$1", [orderId]);
          await channelRefunded(tx, order);
          await tx.query(
            `UPDATE listings SET status='withdrawn' WHERE id=$1 AND EXISTS (SELECT 1 FROM assets WHERE id=$2 AND (custody<>'vault' OR certification<>'verified'))`,
            [order!.listing_id, order!.asset_id],
          );
          await audit(
            tx,
            current!.requested_by,
            'stripe_test.unallocated_refund.completed',
            orderId,
          );
        }
        await tx.query("UPDATE payment_attempts SET status='succeeded' WHERE order_id=$1", [
          orderId,
        ]);
        await tx.query('UPDATE payment_refunds SET completed_at=now() WHERE id=$1', [refund.id]);
        await this.closeReview(tx, orderId);
        await notify(
          tx,
          order!.buyer_id,
          'Refund confirmed',
          'Your Stripe test refund is confirmed. Any original credits have been restored.',
          orderId,
        );
      } else if (['failed', 'canceled'].includes(status)) {
        await audit(tx, current!.requested_by, 'stripe_test.refund.failed', orderId, { status });
      }
    });
  }
  async webhook(raw: Buffer, signature: string) {
    const event = verifyStripeEvent(raw, signature, this.options.webhookSecret);
    const account = await this.options.provider?.identity?.();
    check(
      !event.account || event.account === account,
      'WEBHOOK_ACCOUNT',
      'Unexpected provider account.',
      400,
    );
    if (
      ![
        'checkout.session.completed',
        'checkout.session.expired',
        'checkout.session.async_payment_succeeded',
        'checkout.session.async_payment_failed',
      ].includes(event.type)
    )
      return { received: true };
    // Keep only routing metadata, never card/customer details from the raw event.
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const old = await one(
          tx,
          'SELECT payload_hash,account_id FROM payment_event_inbox WHERE event_id=$1',
          [event.id],
        ),
        h = hash(raw.toString());
      check(
        !old ||
          ((!old.payload_hash || old.payload_hash === h) &&
            (!old.account_id || old.account_id === account)),
        'WEBHOOK_CONFLICT',
        'An event ID has different contents or account.',
        400,
      );
      await tx.query(
        'INSERT INTO payment_event_inbox(event_id,event_type,session_id,account_id,payload_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [event.id, event.type, event.data.object.id, account || null, h],
      );
    });
    return { received: true };
  }
  async worker() {
    if (!this.options.provider) return;
    const refunds = (
      await this.db.query(`SELECT order_id FROM payment_refunds
      WHERE status IN ('created','pending','requires_action') AND (last_checked_at IS NULL OR last_checked_at<now()-interval '15 seconds')
      ORDER BY last_checked_at NULLS FIRST,created_at LIMIT 5`)
    ).rows;
    for (const refund of refunds) {
      try {
        await this.syncRefund(refund.order_id);
      } catch {
        /* Durable refund retains its asset hold. */
      }
    }
    const events = (
      await this.db.query(
        'SELECT * FROM payment_event_inbox WHERE processed_at IS NULL ORDER BY created_at LIMIT 10',
      )
    ).rows;
    for (const event of events) {
      try {
        const attempt = await one(
          this.db,
          'SELECT order_id FROM payment_attempts WHERE provider_session_id=$1',
          [event.session_id],
        );
        if (attempt) await this.sync(attempt.order_id);
        // Unknown sessions may precede a lost create response. Normal attempt
        // reconciliation still recovers them using the original idempotency key.
        await this.db.query('UPDATE payment_event_inbox SET processed_at=now() WHERE event_id=$1', [
          event.event_id,
        ]);
      } catch {
        /* Durable inbox retries on the next worker tick. */
      }
    }
    const attempts = (
      await this.db
        .query(`SELECT p.order_id,p.request_payload,o.reservation_expires_at FROM payment_attempts p JOIN orders o ON o.id=p.order_id
      WHERE p.status IN ('created','open') AND o.status='pending_payment' AND (p.last_checked_at IS NULL OR p.last_checked_at<now()-interval '15 seconds')
      ORDER BY p.last_checked_at NULLS FIRST,p.created_at LIMIT 5`)
    ).rows;
    for (const attempt of attempts) {
      try {
        if (attempt.request_payload) await this.sync(attempt.order_id);
        else if (new Date(attempt.reservation_expires_at).getTime() <= Date.now()) {
          await this.db.transaction(async (tx) => {
            await lockChannels(tx);
            const order = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [
              attempt.order_id,
            ]);
            const current = await one(
              tx,
              'SELECT * FROM payment_attempts WHERE order_id=$1 FOR UPDATE',
              [attempt.order_id],
            );
            if (order!.status === 'pending_payment' && !current!.request_payload) {
              await this.commerce.cancel(tx, order);
              await tx.query("UPDATE payment_attempts SET status='canceled' WHERE order_id=$1", [
                attempt.order_id,
              ]);
            }
          });
        } else
          await this.db.query(
            'UPDATE payment_attempts SET last_checked_at=now() WHERE order_id=$1',
            [attempt.order_id],
          );
      } catch {
        /* Keep inventory held while the provider outcome is unknown. */
      }
    }
  }
}
