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
  type StripeRefund,
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
  refunds = new Map<string, StripeRefund>();
  refundKeys = new Map<string, string>();
  loseRefundResponse = false;
  refundOutcome: StripeRefund['status'] = 'succeeded';
  async refund(payload: SessionPayload, key: string) {
    let rid = this.refundKeys.get(key);
    if (!rid) {
      rid = `re_${id()}`;
      this.refundKeys.set(key, rid);
      this.refunds.set(rid, {
        id: rid,
        amount: Number(payload.amount),
        currency: 'usd',
        payment_intent: payload.payment_intent,
        metadata: {
          order_id: payload['metadata[order_id]'],
          refund_id: payload['metadata[refund_id]'],
        },
        status: this.refundOutcome,
      });
    }
    if (this.loseRefundResponse) {
      this.loseRefundResponse = false;
      throw new DomainError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Refund response lost');
    }
    return structuredClone(this.refunds.get(rid)!);
  }
  async retrieveRefund(rid: string) {
    return structuredClone(this.refunds.get(rid)!);
  }
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
const finance: Actor = { ...buyer, id: 'ops', is_staff: true, staff_permissions: ['finance'] };
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

async function paidOrder(credits = true) {
  const order = await checkout(credits);
  await s.payments.start(buyer, order.id);
  provider.paid((await attempt(order.id)).provider_session_id);
  await s.payments.status(buyer, order.id);
  return order;
}
test('full Stripe refund restores both tenders and title exactly once after lost response', async () => {
  const order = await paidOrder();
  provider.loseRefundResponse = true;
  await assert.rejects(
    s.payments.requestRefund(finance, order.id, 'Buyer requested vault cancellation'),
    rejects('PAYMENT_PROVIDER_UNAVAILABLE'),
  );
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'fulfilled');
  await assert.rejects(s.catalog.list(buyer, 'court-01', 15000), rejects('REFUND_PENDING'));
  await assert.rejects(
    s.operations.intake(buyer, {
      asset_id: 'court-01',
      kind: 'repool',
      accepted_terms: true,
      evidence: 'Vault intake evidence',
    }),
    rejects('REFUND_PENDING'),
  );
  await Promise.all([
    s.payments.requestRefund(finance, order.id, 'Retry original refund request'),
    s.payments.status(buyer, order.id),
  ]);
  assert.equal(provider.refunds.size, 1);
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'refunded');
  assert.equal((await s.commerce.credits(buyer)).available, 1200);
  assert.equal(
    (await one(db, "SELECT owner_id FROM assets WHERE id='court-01'"))!.owner_id,
    'platform',
  );
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM journal_entries WHERE reference=$1', [
      `refund:${order.id}`,
    ]))!.n,
    1,
  );
  const record = await one(db, 'SELECT * FROM payment_refunds WHERE order_id=$1', [order.id]);
  await assert.rejects(
    db.query('UPDATE payment_refunds SET amount_cents=1 WHERE id=$1', [record!.id]),
    /immutable/,
  );
  await assert.rejects(
    db.query('DELETE FROM payment_refunds WHERE id=$1', [record!.id]),
    /Append-only/,
  );
});
test('pending refund holds shipment and inventory until provider success, with safe failed outcome', async () => {
  const quote = await s.commerce.quote(buyer, {
    listing_id: 'listing-court-01',
    fulfillment: 'ship',
    use_credits: false,
  });
  const order = await s.commerce.checkout(
    buyer,
    { quote_id: quote.id, shipping_address: 'Test return street' },
    id(),
  );
  await s.payments.start(buyer, order.id);
  provider.paid((await attempt(order.id)).provider_session_id);
  await s.payments.status(buyer, order.id);
  provider.refundOutcome = 'pending';
  const result = await s.payments.requestRefund(
    finance,
    order.id,
    'Buyer requested before shipment',
  );
  assert.equal(result.refund!.status, 'pending');
  await assert.rejects(
    s.operations.fulfill({ ...finance, staff_permissions: ['warehouse'] }, order.id, 'DEMO-TRACK'),
    rejects('REFUND_PENDING'),
  );
  provider.refunds.values().next().value!.status = 'failed';
  await s.payments.reconcileRefund(finance, order.id, { note: 'Checked failed provider refund' });
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'paid');
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM journal_entries WHERE reference=$1', [
      `refund:${order.id}`,
    ]))!.n,
    0,
  );
});
test('only finance can inspect recovery or request provider refunds; active listing prevents external call', async () => {
  const order = await paidOrder();
  for (const actor of [
    buyer,
    { ...finance, staff_permissions: ['support'] as Actor['staff_permissions'] },
  ]) {
    await assert.rejects(s.payments.queue(actor), rejects('FORBIDDEN'));
    await assert.rejects(
      s.payments.requestRefund(actor, order.id, 'Refund requested by customer'),
      rejects('FORBIDDEN'),
    );
  }
  await s.catalog.list(buyer, 'court-01', 15000);
  await assert.rejects(
    s.payments.requestRefund(finance, order.id, 'Refund request during resale'),
    rejects('ASSET_BUSY'),
  );
  assert.equal(provider.refunds.size, 0);
});
test('zero cash Stripe refunds restore credits without making a provider refund', async () => {
  await db.query("UPDATE listings SET price_cents=1000 WHERE id='listing-court-01'");
  const order = await paidOrder();
  const result = await s.payments.requestRefund(
    finance,
    order.id,
    'Return credit-only vault purchase',
  );
  assert.equal(result.status, 'refunded');
  assert.equal(result.refund!.amount_cents, 0);
  assert.equal(provider.refunds.size, 0);
  assert.equal((await s.commerce.credits(buyer)).available, 1200);
});
test('paid inventory exception opens a review and can be refunded without transferring title', async () => {
  const order = await checkout(true);
  await s.payments.start(buyer, order.id);
  provider.paid((await attempt(order.id)).provider_session_id);
  await db.query("UPDATE assets SET certification='revoked' WHERE id='court-01'");
  const status = await s.payments.status(buyer, order.id);
  assert.equal(status.payment_status, 'requires_review');
  assert.equal((await s.payments.queue(finance)).items[0].review_reason, 'inventory_exception');
  await s.payments.requestRefund(finance, order.id, 'Refund paid but ineligible inventory');
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'refunded');
  assert.equal((await s.commerce.credits(buyer)).available, 1200);
  assert.equal(
    (await one(db, "SELECT status FROM listings WHERE id='listing-court-01'"))!.status,
    'withdrawn',
  );
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM settlements WHERE order_id=$1', [order.id]))!.n,
    0,
  );
  assert.equal(
    (await one(db, 'SELECT status FROM payment_reviews WHERE order_id=$1', [order.id]))!.status,
    'resolved',
  );
  assert.equal(
    (await one(
      db,
      "SELECT coalesce(sum(amount),0)::int AS n FROM journal_lines WHERE account='stripe_test_clearing'",
    ))!.n,
    0,
  );
});
test('stale session recovery validates original identity and version without recreating payment', async () => {
  const order = await checkout();
  provider.loseResponse = true;
  await assert.rejects(s.payments.start(buyer, order.id));
  const sid = [...provider.sessions.keys()][0];
  await db.query(
    "UPDATE payment_attempts SET created_at=now()-interval '25 hours' WHERE order_id=$1",
    [order.id],
  );
  await s.payments.status(buyer, order.id);
  await s.payments.claim(finance, order.id, 1);
  await assert.rejects(
    s.payments.review(finance, order.id, {
      expected_version: 1,
      session_id: sid,
      note: 'Stale operator review request',
      cancel: false,
    }),
    rejects('VERSION_CONFLICT'),
  );
  provider.sessions.get(sid)!.amount_total++;
  await assert.rejects(
    s.payments.review(finance, order.id, {
      expected_version: 2,
      session_id: sid,
      note: 'Check mismatched session data',
      cancel: true,
    }),
    rejects('PAYMENT_MISMATCH'),
  );
  assert.equal(provider.sessions.get(sid)!.status, 'open');
  provider.sessions.get(sid)!.amount_total--;
  provider.paid(sid);
  await s.payments.review(finance, order.id, {
    expected_version: 2,
    session_id: sid,
    note: 'Matched original Stripe test session',
    cancel: false,
  });
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'fulfilled');
  assert.equal(provider.payloads.length, 1);
});
test('ambiguous refund past provider key window requires verified original refund ID', async (t) => {
  const order = await paidOrder();
  provider.loseRefundResponse = true;
  await assert.rejects(
    s.payments.requestRefund(finance, order.id, 'Refund lost response scenario'),
  );
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 25 * 3600000 });
  const status = await s.payments.status(buyer, order.id);
  assert.equal(status.refund!.status, 'requires_review');
  const rid = [...provider.refunds.keys()][0];
  provider.refunds.get(rid)!.amount++;
  await assert.rejects(
    s.payments.reconcileRefund(finance, order.id, {
      refund_id: rid,
      note: 'Mismatched refund investigation',
    }),
    rejects('REFUND_MISMATCH'),
  );
  provider.refunds.get(rid)!.amount--;
  await s.payments.reconcileRefund(finance, order.id, {
    refund_id: rid,
    note: 'Matched original refund in Stripe',
  });
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'refunded');
  assert.equal(provider.refunds.size, 1);
});
test('passport separates an unassessed registry record from VIA and omits private evidence', async () => {
  const created = await s.catalog.createAsset(seller, {
    title: 'Unassessed physical card',
    description: 'A physical item awaiting independent review',
    category: 'Sports',
    artwork: 'court',
  });
  const item = await s.catalog.item(created.id, seller);
  assert.equal(item.passport.authenticity, 'unverified');
  assert.equal(item.passport.assessed_at, null);
  assert.equal(item.passport.certificate, null);
  assert.equal(item.passport.issuance_mode, null);
  assert(!JSON.stringify(item.passport).includes('owner_id'));
  await assert.rejects(s.catalog.item(created.id, buyer), rejects('NOT_FOUND'));
  const publicItem = await s.catalog.item('court-01');
  assert.equal(publicItem.passport.authenticity, 'verified');
  assert(publicItem.passport.assessed_at);
  assert(!JSON.stringify(publicItem.passport).includes('evidence'));
});
test('VIA quarantine during pending refund preserves quarantine and never reactivates the listing', async () => {
  const order = await paidOrder();
  provider.refundOutcome = 'pending';
  await s.payments.requestRefund(finance, order.id, 'Return before independent review');
  await s.operations.revoke(
    { ...finance, staff_permissions: ['via'] },
    'court-01',
    'New evidence requires quarantine',
  );
  provider.refunds.values().next().value!.status = 'succeeded';
  await s.payments.status(buyer, order.id);
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'refunded');
  assert.equal(
    (await one(db, "SELECT custody FROM assets WHERE id='court-01'"))!.custody,
    'quarantine',
  );
  assert.equal(
    (await one(db, "SELECT status FROM listings WHERE id='listing-court-01'"))!.status,
    'withdrawn',
  );
});
test('payment operations HTTP contracts enforce permission, CSRF, reason and recoverable refund status', async () => {
  const order = await paidOrder();
  const server = createApp(s).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  try {
    const login = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ops@pixup.demo', password: 'PixupDemo2026!' }),
    });
    const { user } = await login.json();
    const headers = {
      'Content-Type': 'application/json',
      cookie: login.headers.get('set-cookie')!.split(';')[0],
    };
    const csrf = { ...headers, 'X-CSRF-Token': user.csrf };
    assert.equal((await fetch(base + '/ops/payments')).status, 401);
    const queue = await (await fetch(base + '/ops/payments', { headers })).json();
    assert.equal(queue.items[0].id, order.id);
    assert(!JSON.stringify(queue).includes('shipping_address'));
    assert.equal(
      (
        await fetch(base + `/ops/payments/${order.id}/refund`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ reason: 'Verified customer request' }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + `/ops/payments/${order.id}/refund`, {
          method: 'POST',
          headers: csrf,
          body: JSON.stringify({ reason: 'short' }),
        })
      ).status,
      400,
    );
    const refunded = await fetch(base + `/ops/payments/${order.id}/refund`, {
      method: 'POST',
      headers: csrf,
      body: JSON.stringify({ reason: 'Verified customer vault return' }),
    });
    assert.equal(refunded.status, 200);
    assert.equal((await refunded.json()).refund.status, 'succeeded');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Stripe CVM payment and full refund use the shared ledger while preserving unresolved physical custody', async () => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const warehouse: Actor = { ...finance, staff_permissions: ['finance', 'warehouse'] };
  await s.channels.setGate(warehouse, 'cvm', true, 'Signed device pilot contract evidence');
  const keys = generateKeyPairSync('ed25519');
  const c = await s.channels.create(warehouse, {
    kind: 'cvm',
    org_id: 'ops-org',
    name: 'Stripe test device',
    terms: { description: 'Physical dispense follows confirmed provider payment' },
    public_key: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  const a = await s.channels.assign(warehouse, c.id, {
    listing_id: 'listing-court-01',
    slot: 'A1',
  });
  async function event(body: any) {
    const raw = Buffer.from(JSON.stringify(body)),
      timestamp = String(Date.now());
    return s.channels.event(
      c.id,
      raw,
      timestamp,
      sign(null, Buffer.from(`${c.id}\n${timestamp}\n${raw.toString()}`), keys.privateKey).toString(
        'base64',
      ),
    );
  }
  await event({ event_id: id(), type: 'heartbeat' });
  const q = await s.commerce.quote(buyer, {
    listing_id: 'listing-court-01',
    allocation_id: a.id,
    fulfillment: 'vault',
    use_credits: true,
  });
  const o = await s.commerce.checkout(buyer, { quote_id: q.id, shipping_address: '' }, id());
  await s.payments.start(buyer, o.id);
  provider.paid((await attempt(o.id)).provider_session_id);
  await Promise.all([s.payments.status(buyer, o.id), s.payments.status(buyer, o.id)]);
  assert.equal((await s.commerce.order(buyer, o.id)).status, 'paid');
  await s.channels.worker();
  const command = (await event({ event_id: id(), type: 'heartbeat' })).commands[0];
  await event({
    event_id: id(),
    type: 'vend',
    command_id: command.id,
    outcome: 'unknown',
    evidence: 'Device sensor response was interrupted',
  });
  await assert.rejects(
    s.payments.requestRefund(finance, o.id, 'Customer requested device refund'),
    rejects('CHANNEL_RECOVERY_REQUIRED'),
  );
  const originalNow = Date.now,
    afterLease = originalNow() + 660000;
  Date.now = () => afterLease;
  try {
    await s.channels.reconcileVend(
      warehouse,
      command.id,
      'not_dispensed',
      'Serial physically witnessed inside device slot',
    );
  } finally {
    Date.now = originalNow;
  }
  await s.payments.requestRefund(finance, o.id, 'Confirmed undispensed original item');
  assert.equal((await s.commerce.order(buyer, o.id)).status, 'refunded');
  assert.equal((await s.commerce.credits(buyer)).available, 1200);
  assert.equal(
    (await one(db, 'SELECT custody FROM assets WHERE id=$1', ['court-01']))!.custody,
    'device',
  );
  assert.equal(provider.refunds.size, 1);
});
