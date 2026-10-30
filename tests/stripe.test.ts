import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDatabase, migrate, one, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services, createApp } from '../apps/api/src/app';
import { DomainError, id } from '../packages/domain/core';
import {
  type CheckoutProvider,
  type SessionPayload,
  type StripeSession,
  stripeConfiguration,
  verifyStripeEvent,
} from '../apps/api/src/stripe';
import type { Actor } from '../apps/api/src/auth';

class FakeStripe implements CheckoutProvider {
  sessions = new Map<string, StripeSession>();
  keys = new Map<string, string>();
  payloads: SessionPayload[] = [];
  loseResponse = false;
  payDuringCancel = false;
  async create(payload: SessionPayload, key: string) {
    this.payloads.push(payload);
    let sid = this.keys.get(key);
    if (!sid) {
      sid = `cs_test_${id()}`;
      this.keys.set(key, sid);
      this.sessions.set(sid, {
        id: sid,
        livemode: false,
        status: 'open',
        payment_status: 'unpaid',
        amount_total: Number(payload['line_items[0][price_data][unit_amount]']),
        currency: 'usd',
        client_reference_id: payload.client_reference_id,
        metadata: { order_id: payload['metadata[order_id]'] },
        url: `https://checkout.stripe.com/c/pay/${sid}`,
        payment_intent: null,
      });
    }
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new DomainError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Test response lost');
    }
    return structuredClone(this.sessions.get(sid)!);
  }
  async retrieve(sid: string) {
    return structuredClone(this.sessions.get(sid)!);
  }
  async expire(sid: string) {
    const session = this.sessions.get(sid)!;
    if (this.payDuringCancel) {
      this.paid(sid);
      throw new Error('Payment already completed');
    }
    session.status = 'expired';
    session.url = null;
    return structuredClone(session);
  }
  paid(sid: string) {
    const session = this.sessions.get(sid)!;
    session.status = 'complete';
    session.payment_status = session.amount_total === 0 ? 'no_payment_required' : 'paid';
    session.payment_intent = session.amount_total === 0 ? null : `pi_${sid}`;
    session.url = null;
  }
}
let db: Database, s: Services, provider: FakeStripe;
const buyer: Actor = {
  id: 'collector',
  email: 'collector@pixup.demo',
  name: 'Collector',
  csrf: 'test',
  is_staff: false,
  organizations: [],
  staff_permissions: [],
};
const seller: Actor = { ...buyer, id: 'seller', email: 'seller@pixup.demo' };
const rejects = (code: string) => (error: unknown) =>
  error instanceof DomainError && error.code === code;
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  provider = new FakeStripe();
  s = new Services(db, {
    provider,
    origin: 'http://127.0.0.1:3000',
    webhookSecret: 'whsec_fixture',
  });
});
afterEach(async () => {
  await db.close();
});
async function checkout(credits = false) {
  const quote = await s.commerce.quote(buyer, {
    listing_id: 'listing-court-01',
    fulfillment: 'vault',
    use_credits: credits,
  });
  return s.commerce.checkout(buyer, { quote_id: quote.id, shipping_address: '' }, id());
}
async function attempt(oid: string) {
  return (await one(db, 'SELECT * FROM payment_attempts WHERE order_id=$1', [oid]))!;
}
function signature(raw: Buffer, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac('sha256', 'whsec_fixture')
    .update(String(timestamp) + '.')
    .update(raw)
    .digest('hex')}`;
}

test('Stripe configuration uses test keys only and never exposes secrets', () => {
  assert.equal(
    stripeConfiguration({ PAYMENT_PROVIDER: 'demo', STRIPE_SECRET_KEY: 'sk_test_fixture' })
      .provider,
    undefined,
  );
  assert(stripeConfiguration({ STRIPE_SECRET_KEY: 'sk_test_fixture' }).provider);
  assert.throws(
    () => stripeConfiguration({ STRIPE_SECRET_KEY: 'sk_live_fixture' }),
    rejects('STRIPE_TEST_KEY_REQUIRED'),
  );
  assert.throws(
    () => stripeConfiguration({ PAYMENT_PROVIDER: 'stripe_test' }),
    rejects('STRIPE_TEST_KEY_REQUIRED'),
  );
  assert(!JSON.stringify(s.payments.configuration()).includes('whsec_'));
});

test('hosted checkout uses persisted amount, one provider session and buyer-only access', async () => {
  const order = await checkout(true);
  assert.equal(order.payment_provider, 'stripe_test');
  await assert.rejects(
    s.commerce.pay(buyer, order.id, true),
    rejects('PROVIDER_CONFIRMATION_REQUIRED'),
  );
  await assert.rejects(s.payments.start(seller, order.id), rejects('NOT_FOUND'));
  const [a, b] = await Promise.all([
    s.payments.start(buyer, order.id),
    s.payments.start(buyer, order.id),
  ]);
  assert.equal(a.url, b.url);
  assert.equal(provider.sessions.size, 1);
  const persisted = await s.commerce.order(buyer, order.id);
  assert.equal(
    Number(provider.payloads[0]['line_items[0][price_data][unit_amount]']),
    persisted.total_cents,
  );
  assert.equal(provider.payloads[0]['allowed_payment_method_types[0]'], 'card');
  assert.equal(persisted.status, 'pending_payment');
  assert.equal(
    (await one(db, "SELECT owner_id FROM assets WHERE id='court-01'"))!.owner_id,
    'platform',
  );
});

test('lost create response and browser loss recover without a duplicate payment or journal', async () => {
  const order = await checkout(true);
  provider.loseResponse = true;
  await assert.rejects(s.payments.start(buyer, order.id), rejects('PAYMENT_PROVIDER_UNAVAILABLE'));
  assert((await attempt(order.id)).request_payload);
  assert.equal((await attempt(order.id)).provider_session_id, null);
  await db.query('UPDATE payment_attempts SET last_checked_at=NULL WHERE order_id=$1', [order.id]);
  await s.payments.worker();
  assert.equal(provider.sessions.size, 1);
  const payment = await attempt(order.id);
  provider.paid(payment.provider_session_id);
  await Promise.all([s.payments.status(buyer, order.id), s.payments.status(buyer, order.id)]);
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'fulfilled');
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM journal_entries WHERE reference=$1', [
      `payment:${order.id}`,
    ]))!.n,
    1,
  );
  assert.equal((await attempt(order.id)).status, 'succeeded');
  assert.equal(
    (await one(db, "SELECT owner_id FROM assets WHERE id='court-01'"))!.owner_id,
    buyer.id,
  );
  assert.equal((await s.commerce.credits(buyer)).held, 0);
  await assert.rejects(
    s.commerce.refund(buyer, order.id),
    rejects('STRIPE_REFUND_REQUIRES_SUPPORT'),
  );
});

test('local timeout never releases an open Stripe session; late success retains one allocation', async () => {
  const order = await checkout();
  await s.payments.start(buyer, order.id);
  await db.query("UPDATE orders SET reservation_expires_at=now()-interval '1 minute' WHERE id=$1", [
    order.id,
  ]);
  await s.commerce.expire();
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'pending_payment');
  provider.paid((await attempt(order.id)).provider_session_id);
  await s.payments.status(buyer, order.id);
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'fulfilled');
});

test('cancel verifies Stripe expiration before releasing inventory and credit holds', async () => {
  const order = await checkout(true);
  await s.payments.start(buyer, order.id);
  const result = await s.payments.cancel(buyer, order.id);
  assert.equal(result.status, 'canceled');
  assert.equal((await s.commerce.credits(buyer)).available, 1200);
  assert.equal(
    (await one(db, "SELECT status FROM listings WHERE id='listing-court-01'"))!.status,
    'active',
  );
  assert.equal((await attempt(order.id)).status, 'canceled');
});

test('payment winning cancellation race is confirmed, not returned to stock', async () => {
  const order = await checkout();
  await s.payments.start(buyer, order.id);
  provider.payDuringCancel = true;
  const result = await s.payments.cancel(buyer, order.id);
  assert.equal(result.status, 'fulfilled');
  assert.equal(
    (await one(db, "SELECT status FROM listings WHERE id='listing-court-01'"))!.status,
    'sold',
  );
});

test('mismatched provider amount cannot confirm an order', async () => {
  const order = await checkout();
  await s.payments.start(buyer, order.id);
  const sid = (await attempt(order.id)).provider_session_id;
  provider.paid(sid);
  provider.sessions.get(sid)!.amount_total++;
  await assert.rejects(s.payments.status(buyer, order.id), rejects('PAYMENT_MISMATCH'));
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'pending_payment');
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM settlements WHERE order_id=$1', [order.id]))!.n,
    0,
  );
});

test('fully credit-funded Checkout requires confirmed no-payment-required state', async () => {
  await db.query("UPDATE listings SET price_cents=1000 WHERE id='listing-court-01'");
  const order = await checkout(true);
  await s.payments.start(buyer, order.id);
  const sid = (await attempt(order.id)).provider_session_id;
  assert.equal(provider.sessions.get(sid)!.amount_total, 0);
  provider.paid(sid);
  await s.payments.status(buyer, order.id);
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'fulfilled');
});

test('stale ambiguous attempts are held for review instead of recreating a session after key expiry', async () => {
  const order = await checkout();
  provider.loseResponse = true;
  await assert.rejects(s.payments.start(buyer, order.id));
  await db.query(
    "UPDATE payment_attempts SET created_at=now()-interval '25 hours' WHERE order_id=$1",
    [order.id],
  );
  const calls = provider.payloads.length;
  const result = await s.payments.status(buyer, order.id);
  assert.equal(result.payment_status, 'requires_review');
  assert.equal(result.status, 'pending_payment');
  assert.equal(provider.payloads.length, calls);
});

test('raw webhook signature and timestamp are verified; durable inbox deduplicates and retrieves truth', async () => {
  const order = await checkout();
  await s.payments.start(buyer, order.id);
  const sid = (await attempt(order.id)).provider_session_id;
  const raw = Buffer.from(
    JSON.stringify({
      id: 'evt_fixture',
      type: 'checkout.session.completed',
      livemode: false,
      data: { object: { id: sid, payment_status: 'paid' } },
    }),
  );
  assert.throws(
    () => verifyStripeEvent(raw, signature(raw, 1), 'whsec_fixture'),
    rejects('WEBHOOK_SIGNATURE_INVALID'),
  );
  assert.throws(
    () => verifyStripeEvent(Buffer.from(raw.toString() + ' '), signature(raw), 'whsec_fixture'),
    rejects('WEBHOOK_SIGNATURE_INVALID'),
  );
  await s.payments.webhook(raw, signature(raw));
  await s.payments.webhook(raw, signature(raw));
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM payment_event_inbox'))!.n, 1);
  await s.payments.worker();
  // A signed event saying paid is not enough: provider retrieval still says unpaid.
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'pending_payment');
  provider.paid(sid);
  await db.query('UPDATE payment_attempts SET last_checked_at=NULL WHERE order_id=$1', [order.id]);
  await s.payments.worker();
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'fulfilled');
});

test('webhook route keeps original bytes and works independently of cookie CSRF', async () => {
  const server = createApp(s).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  try {
    const raw = Buffer.from(
      '{ "id":"evt_http", "type":"checkout.session.expired", "livemode":false, "data":{"object":{"id":"cs_test_http"}} }',
    );
    const send = (sig: string) =>
      fetch(base + '/webhooks/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig },
        body: raw,
      });
    assert.equal((await send('invalid')).status, 400);
    assert.equal((await send(signature(raw))).status, 200);
    assert.equal((await send(signature(raw))).status, 200);
    assert.equal((await one(db, 'SELECT count(*)::int AS n FROM payment_event_inbox'))!.n, 1);
    const config = await (await fetch(base + '/payments/config')).json();
    assert.equal(config.provider, 'stripe_test');
    assert(!JSON.stringify(config).includes('secret'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
