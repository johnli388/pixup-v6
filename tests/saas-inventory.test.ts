import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDatabase, migrate, one, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services, createApp } from '../apps/api/src/app';
import { DomainError, id } from '../packages/domain/core';
import { pilotLimits, consumeUsage, entitlement } from '../packages/domain/saas';
import { staffPermissions } from '../packages/domain/contracts';
import { type Actor } from '../apps/api/src/auth';
import {
  type BillingProvider,
  type BillingSession,
  type BillingSubscription,
  StripeBillingProvider,
} from '../apps/api/src/billing-provider';
const actor = (uid: string, staff = false): Actor => ({
  id: uid,
  email: `${uid}@pixup.demo`,
  name: uid,
  csrf: 'fixture',
  organizations: [],
  is_staff: staff,
  staff_permissions: staff ? [...staffPermissions] : [],
});
const ops = actor('ops', true),
  reviewer = actor('creator', true),
  buyer = actor('collector');
const rejection = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
import { FakeBilling } from './fixtures/billing-provider';

let db: Database, s: Services, provider: FakeBilling;
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  await db.query("UPDATE users SET is_staff=true WHERE id='creator'");
  await db.query("INSERT INTO staff_permissions(user_id,permission) VALUES ('creator','finance')");
  provider = new FakeBilling();
  s = new Services(
    db,
    {},
    { provider, origin: 'http://127.0.0.1:3000', webhookSecret: 'fixture-secret' },
  );
});
afterEach(async () => {
  await db.close();
});
async function plan(limits = pilotLimits, trial = 0) {
  const p = await s.billing.createPlan(ops, {
    name: 'Synthetic monthly plan',
    audience: 'demand',
    amount_cents: 3000,
    trial_days: trial,
    grace_days: 3,
    limits,
  });
  const a = await s.finance.request(
    ops,
    'plan_activate',
    p.id,
    'Review synthetic test subscription pricing and limits',
  );
  await s.finance.decide(
    reviewer,
    a.id,
    1,
    'approve',
    'Independent approval for synthetic test plan',
  );
  return p.id;
}
async function paid(limits = pilotLimits) {
  const p = await plan(limits);
  const sub = await s.billing.start(buyer, 'collector-org', p);
  const remote = provider.complete(sub.id);
  await s.billing.resume(buyer, sub.id);
  return { p, sub, remote };
}
test('plan approval requires a second finance reviewer, exact inputs and immutable versioned terms', async () => {
  const p = await s.billing.createPlan(ops, {
    name: 'Reviewed plan version',
    audience: 'supply',
    amount_cents: 4500,
    trial_days: 0,
    grace_days: 0,
    limits: pilotLimits,
  });
  assert.equal((await s.billing.plans(buyer)).plans.length, 0);
  await assert.rejects(
    s.billing.start(buyer, 'collector-org', p.id),
    rejection('PLAN_UNAVAILABLE'),
  );
  const a = await s.finance.request(
    ops,
    'plan_activate',
    p.id,
    'Published price and entitlement terms need review',
  );
  await assert.rejects(
    s.finance.decide(ops, a.id, 1, 'approve', 'Invalid self approval attempt'),
    rejection('SELF_APPROVAL'),
  );
  await db.query("DELETE FROM staff_permissions WHERE user_id='creator' AND permission='finance'");
  await assert.rejects(
    s.finance.decide(reviewer, a.id, 1, 'approve', 'Reviewed synthetic subscription terms'),
    rejection('APPROVAL_STALE'),
  );
  assert.equal(
    (await one(db, 'SELECT state FROM plan_versions WHERE id=$1', [p.id]))!.state,
    'draft',
  );
  await db.query("INSERT INTO staff_permissions(user_id,permission) VALUES ('creator','finance')");
  await s.finance.execute(reviewer, a.id);
  assert.equal((await s.billing.plans(buyer)).plans.length, 1);
  await assert.rejects(db.query('UPDATE plan_versions SET amount_cents=1 WHERE id=$1', [p.id]));
  await assert.rejects(
    s.finance.decide(reviewer, a.id, 1, 'approve', 'Stale repeated decision'),
    rejection('APPROVAL_VERSION'),
  );
  assert.equal((await s.finance.execute(reviewer, a.id)).ok, true);
});
test('lost and competing subscription creates reuse immutable payloads and do not grant entitlements on browser return', async () => {
  const p = await plan();
  provider.lose = true;
  await assert.rejects(s.billing.start(buyer, 'collector-org', p));
  const lost = (await one(db, 'SELECT id FROM subscriptions'))!;
  await s.billing.recover(
    ops,
    lost.id,
    [...provider.sessions.keys()][0],
    'Recovered the original test session from provider metadata',
  );
  assert.equal(provider.calls, 1);
  const attempts = await Promise.all([
    s.billing.start(buyer, 'collector-org', p),
    s.billing.start(buyer, 'collector-org', p),
  ]);
  assert.equal(attempts[0].id, attempts[1].id);
  assert.equal(provider.sessions.size, 1);
  assert.equal((await entitlement(db, 'collector-org')).paid_entitlement, false);
  const remote = provider.complete(attempts[0].id);
  await s.billing.resume(buyer, attempts[0].id);
  assert.equal((await entitlement(db, 'collector-org')).paid_entitlement, true);
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM subscription_invoices'))!.n, 1);
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM orders'))!.n, 0);
  await s.billing.resume(buyer, attempts[0].id);
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM subscription_invoices'))!.n, 1);
  remote.items.data[0].price.unit_amount = 99;
  await assert.rejects(s.billing.resume(buyer, attempts[0].id), rejection('BILLING_IDENTITY'));
  assert.equal(
    (await one(db, 'SELECT error_code FROM subscriptions WHERE id=$1', [attempts[0].id]))!
      .error_code,
    'BILLING_IDENTITY',
  );
});
test('trial, past-due grace, cancellation and expiry derive from authoritative provider state and never erase records', async () => {
  const p = await plan(pilotLimits, 7),
    a = await s.billing.start(buyer, 'collector-org', p);
  const sub = provider.complete(a.id, 'trialing');
  await s.billing.resume(buyer, a.id);
  assert.equal((await entitlement(db, 'collector-org')).state, 'trial');
  sub.status = 'active';
  sub.latest_invoice!.amount_due = 3000;
  sub.latest_invoice!.amount_paid = 3000;
  await s.billing.resume(buyer, a.id);
  sub.status = 'past_due';
  sub.latest_invoice!.status = 'open';
  sub.latest_invoice!.amount_paid = 0;
  sub.latest_invoice!.created = Math.floor(Date.now() / 1000) - 86400;
  await s.billing.resume(buyer, a.id);
  assert.equal((await entitlement(db, 'collector-org')).state, 'grace');
  const since = (await one(db, 'SELECT past_due_since FROM subscriptions WHERE id=$1', [a.id]))!
    .past_due_since;
  await s.billing.resume(buyer, a.id);
  assert.equal(
    String(
      (await one(db, 'SELECT past_due_since FROM subscriptions WHERE id=$1', [a.id]))!
        .past_due_since,
    ),
    String(since),
  );
  await db.query("UPDATE subscriptions SET past_due_since=now()-interval '4 days' WHERE id=$1", [
    a.id,
  ]);
  assert.equal((await entitlement(db, 'collector-org')).paid_entitlement, false);
  await s.billing.cancel(buyer, a.id);
  assert.equal(sub.cancel_at_period_end, true);
  sub.status = 'canceled';
  await s.billing.resume(buyer, a.id);
  assert.equal((await entitlement(db, 'collector-org')).state, 'canceled');
  assert.equal((await s.billing.account(buyer, 'collector-org')).invoices.length, 1);
  assert((await s.catalog.portfolio(buyer)).items.length > 0);
  const newAttempt = await s.billing.start(buyer, 'collector-org', p);
  assert.notEqual(newAttempt.id, a.id);
});
test('webhooks reject forgery, deduplicate events and retrieve current state rather than trusting old invoice events', async () => {
  const { sub, remote } = await paid();
  const event = {
    id: 'evt_billing_fixture',
    livemode: false,
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: remote.latest_invoice!.id,
        parent: { subscription_details: { subscription: remote.id } },
      },
    },
  };
  const raw = Buffer.from(JSON.stringify(event)),
    t = String(Math.floor(Date.now() / 1000));
  const sig = `t=${t},v1=${createHmac('sha256', 'fixture-secret')
    .update(t + '.')
    .update(raw)
    .digest('hex')}`;
  await assert.rejects(s.billing.webhook(raw, 'bad'), rejection('WEBHOOK_SIGNATURE_INVALID'));
  await s.billing.webhook(raw, sig);
  await s.billing.webhook(raw, sig);
  await s.billing.worker();
  assert.equal(
    (await one(db, 'SELECT state FROM subscriptions WHERE id=$1', [sub.id]))!.state,
    'active',
  );
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM billing_events'))!.n, 1);
  assert(
    (await one(db, "SELECT processed_at FROM billing_events WHERE id='evt_billing_fixture'"))!
      .processed_at,
  );
});
test('aggregate usage is atomic, replay-safe and enforced without granting membership; downgrade preserves inventory', async () => {
  const { sub, remote } = await paid({ ...pilotLimits, asset_registrations: 51 });
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(770077)');
    await consumeUsage(tx, 'collector-org', 'asset_registrations', 'prior-fixture', 50);
    await consumeUsage(tx, 'collector-org', 'asset_registrations', 'prior-fixture', 50);
  });
  const input = {
    title: 'Metered fixture',
    description: 'Synthetic physical collectible record',
    category: 'Sports',
    artwork: 'court',
    org_id: 'collector-org',
    attributes: { category: 'Sports', athlete: 'Synthetic Athlete', season: '2026' },
  };
  const races = await Promise.allSettled([
    s.catalog.createAsset(buyer, input),
    s.catalog.createAsset(buyer, input),
  ]);
  assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.rejects(s.catalog.createAsset(actor('seller'), input), rejection('FORBIDDEN'));
  remote.status = 'canceled';
  await s.billing.resume(buyer, sub.id);
  await assert.rejects(s.catalog.createAsset(buyer, input), rejection('PLAN_LIMIT'));
  assert((await s.catalog.portfolio(buyer)).items.some((a) => a.title === 'Metered fixture'));
  assert.equal(
    (await one(
      db,
      "SELECT sum(quantity)::int AS n FROM usage_events WHERE org_id='collector-org' AND metric='asset_registrations'",
    ))!.n,
    51,
  );
  await assert.rejects(db.query("DELETE FROM usage_events WHERE org_id='collector-org'"));
});
test('organization inventory delegation preserves title/payee, rejects stale membership and clears on ownership transfer', async () => {
  const q = await s.commerce.quote(buyer, { listing_id: 'listing-orbit-01', fulfillment: 'vault' }),
    o = await s.commerce.checkout(buyer, { quote_id: q.id, shipping_address: '' }, id());
  await s.commerce.pay(buyer, o.id, true);
  await db.query(
    "INSERT INTO memberships(user_id,org_id,role) VALUES ('collector','creator-org','publisher')",
  );
  const a = await s.finance.request(
    buyer,
    'inventory_assign',
    'orbit-01',
    'Delegate merchandising to the publishing workspace',
    'creator-org',
  );
  await s.finance.decide(
    ops,
    a.id,
    1,
    'approve',
    'Review owner authority and current physical holds',
  );
  assert.equal((await s.inventory.list(actor('creator'), 'creator-org')).items[0].is_owner, false);
  await assert.rejects(s.inventory.list(actor('seller'), 'creator-org'), rejection('FORBIDDEN'));
  const listed = await s.catalog.list(actor('creator'), 'orbit-01', 8000);
  assert.equal(
    (await one(db, 'SELECT seller_id FROM listings WHERE id=$1', [listed.id]))!.seller_id,
    'collector',
  );
  await s.catalog.withdrawListing(actor('creator'), listed.id);
  await db.query("DELETE FROM memberships WHERE user_id='creator' AND org_id='creator-org'");
  await assert.rejects(s.catalog.list(actor('creator'), 'orbit-01', 8000), rejection('FORBIDDEN'));
  const own = await s.catalog.list(buyer, 'orbit-01', 8000);
  const q2 = await s.commerce.quote(actor('seller'), { listing_id: own.id, fulfillment: 'vault' }),
    o2 = await s.commerce.checkout(
      actor('seller'),
      { quote_id: q2.id, shipping_address: '' },
      id(),
    );
  await s.commerce.pay(actor('seller'), o2.id, true);
  const asset = (await one(
    db,
    "SELECT owner_id,inventory_org_id FROM assets WHERE id='orbit-01'",
  ))!;
  assert.equal(asset.owner_id, 'seller');
  assert.equal(asset.inventory_org_id, null);
});
test('category schemas reject incompatible fields and catalogue changes preserve revision history', async () => {
  const item = await s.catalog.createAsset(buyer, {
    title: 'Detailed photocard',
    description: 'Synthetic K-pop card catalog fixture',
    category: 'K-pop',
    artwork: 'idol',
    attributes: {
      category: 'K-pop',
      group: 'Synthetic group',
      member: 'Member A',
      album: 'Album 1',
    },
  });
  await assert.rejects(
    s.inventory.attributes(buyer, item.id, { category: 'Sports', athlete: 'A' }),
    rejection('CATEGORY_MISMATCH'),
  );
  await assert.rejects(
    s.inventory.attributes(buyer, item.id, { category: 'K-pop', athlete: 'Wrong schema' }),
  );
  await s.inventory.attributes(buyer, item.id, {
    category: 'K-pop',
    group: 'Synthetic group',
    member: 'Member A',
    album: 'Album 2',
  });
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM catalog_revisions WHERE asset_id=$1', [
      item.id,
    ]))!.n,
    2,
  );
  await assert.rejects(db.query('DELETE FROM catalog_revisions WHERE asset_id=$1', [item.id]));
});
test('pending seat reservations enforce caps and a stale inventory approval cannot change an item', async () => {
  await paid({ ...pilotLimits, seats: 1 });
  // Personal workspace invitations remain forbidden independently of entitlements.
  await assert.rejects(
    s.organizations.invite(buyer, 'collector-org', 'seller@pixup.demo', 'viewer'),
    rejection('FORBIDDEN'),
  );
  const creatorPlan = await plan({ ...pilotLimits, seats: 2 });
  const creatorSubscription = await s.billing.start(reviewer, 'creator-org', creatorPlan);
  provider.complete(creatorSubscription.id);
  await s.billing.resume(reviewer, creatorSubscription.id);
  await s.organizations.invite(reviewer, 'creator-org', 'seller@pixup.demo', 'viewer');
  await assert.rejects(
    s.organizations.invite(reviewer, 'creator-org', 'collector@pixup.demo', 'viewer'),
    rejection('PLAN_LIMIT'),
  );
  const item = await s.catalog.createAsset(buyer, {
    title: 'Assigned stock fixture',
    description: 'Synthetic assignment review record',
    category: 'Sports',
    artwork: 'court',
  });
  await db.query(
    "INSERT INTO memberships(user_id,org_id,role) VALUES ('collector','creator-org','publisher')",
  );
  const a = await s.finance.request(
    buyer,
    'inventory_assign',
    item.id,
    'Review assignment while membership is current',
    'creator-org',
  );
  await db.query("DELETE FROM memberships WHERE user_id='collector' AND org_id='creator-org'");
  await assert.rejects(
    s.finance.decide(ops, a.id, 1, 'approve', 'Try approval after membership has been revoked'),
    rejection('FORBIDDEN'),
  );
  assert.equal(
    (await one(db, 'SELECT inventory_org_id FROM assets WHERE id=$1', [item.id]))!.inventory_org_id,
    null,
  );
});
test('a delayed old provider response cannot overwrite a newer cancellation', async () => {
  const { sub, remote } = await paid();
  const old = structuredClone(remote);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    wait = new Promise<void>((r) => (release = r));
  let first = true;
  provider.subscription = async () => {
    if (first) {
      first = false;
      entered();
      await wait;
      return old;
    }
    return structuredClone(remote);
  };
  const stale = s.billing.reconcile(sub.id);
  await started;
  remote.status = 'canceled';
  await s.billing.reconcile(sub.id);
  release();
  await stale;
  assert.equal(
    (await one(db, 'SELECT state FROM subscriptions WHERE id=$1', [sub.id]))!.state,
    'canceled',
  );
  await assert.rejects(db.query("UPDATE subscriptions SET payload='{}' WHERE id=$1", [sub.id]));
});
test('billing HTTP owner scope, CSRF and live-key guards remain independent of plan purchase', async () => {
  assert.throws(
    () => new StripeBillingProvider('sk_live_never_used'),
    rejection('BILLING_TEST_KEY_REQUIRED'),
  );
  const server = createApp(s).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1`;
  try {
    const login = await s.auth.login('collector@pixup.demo', 'PixupDemo2026!'),
      headers = { cookie: `pixup_session=${login.token}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(base + '/billing/accounts/creator-org', { headers })).status, 403);
    assert.equal(
      (
        await fetch(base + '/billing/accounts/collector-org/checkout', {
          method: 'POST',
          headers,
          body: JSON.stringify({ plan_id: 'none' }),
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base + '/ops/approvals', { headers })).status, 403);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
