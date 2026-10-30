import { one, type Database } from '../../../packages/database/index';
import { audit, check } from '../../../packages/domain/core';
import type { Actor } from './auth';
import { CommerceService } from './commerce';
import type { PaymentStatus, PaymentConfiguration } from '../../../packages/domain/contracts';
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
};
export class PaymentService {
  constructor(
    private db: Database,
    private commerce: CommerceService,
    private options: PaymentOptions,
  ) {}
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
    this.provider();
    await this.db.transaction(async (tx) => {
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
    return this.sync(orderId);
  }
  async cancel(actor: Actor, orderId: string) {
    await this.authorize(actor, orderId);
    const canceled = await this.db.transaction(async (tx) => {
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
      await this.db.query(
        "UPDATE payment_attempts SET status='requires_review' WHERE id=$1 AND provider_session_id IS NULL AND status='created'",
        [attempt.id],
      );
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
      reservation_expires_at: new Date(row.reservation_expires_at).toISOString(),
      url: row?.status === 'pending_payment' && row?.payment_status === 'open' ? url : null,
    };
  }
  async sync(orderId: string) {
    const session = await this.resolve(orderId);
    if (session) await this.apply(orderId, session);
    return this.summary(orderId, session?.status === 'open' ? session.url : null);
  }
  private async apply(orderId: string, session: StripeSession) {
    await this.db.transaction(async (tx) => {
      const order = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      const attempt = await one(tx, 'SELECT * FROM payment_attempts WHERE order_id=$1 FOR UPDATE', [
        orderId,
      ]);
      check(
        order && attempt && order.payment_provider === 'stripe_test',
        'PAYMENT_MISMATCH',
        'Payment does not match an order.',
      );
      check(
        !session.livemode &&
          session.metadata.order_id === orderId &&
          session.client_reference_id === orderId &&
          session.amount_total === order.total_cents &&
          session.currency === 'usd' &&
          (!attempt.provider_session_id || attempt.provider_session_id === session.id),
        'PAYMENT_MISMATCH',
        'Stripe amount, currency or order reference does not match. Contact support.',
      );
      if (session.url)
        check(
          new URL(session.url).origin === 'https://checkout.stripe.com',
          'PAYMENT_URL_INVALID',
          'Unexpected checkout destination.',
          502,
        );
      if (['succeeded', 'canceled', 'requires_review'].includes(attempt.status)) return;
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
        if (
          order.status !== 'pending_payment' ||
          asset?.owner_id !== order.seller_id ||
          asset?.custody !== 'vault' ||
          asset?.certification !== 'verified'
        ) {
          await tx.query("UPDATE payment_attempts SET status='requires_review' WHERE id=$1", [
            attempt.id,
          ]);
          await audit(tx, order.buyer_id, 'stripe_test.payment_requires_review', orderId);
          return;
        }
        await this.commerce.completePayment(tx, order);
        await tx.query("UPDATE payment_attempts SET status='succeeded' WHERE id=$1", [attempt.id]);
      } else if (session.status === 'expired' && session.payment_status === 'unpaid') {
        if (order.status === 'pending_payment') await this.commerce.cancel(tx, order);
        await tx.query("UPDATE payment_attempts SET status='canceled' WHERE id=$1", [attempt.id]);
      } else await tx.query("UPDATE payment_attempts SET status='open' WHERE id=$1", [attempt.id]);
    });
  }
  async webhook(raw: Buffer, signature: string) {
    const event = verifyStripeEvent(raw, signature, this.options.webhookSecret);
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
    await this.db.query(
      'INSERT INTO payment_event_inbox(event_id,event_type,session_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [event.id, event.type, event.data.object.id],
    );
    return { received: true };
  }
  async worker() {
    if (!this.options.provider) return;
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
