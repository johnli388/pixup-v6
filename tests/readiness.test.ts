import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../packages/database/index';
import { one, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services, createApp } from '../apps/api/src/app';
import { MonitoringService } from '../apps/api/src/monitoring';
import { privacyPolicy } from '../packages/domain/privacy';
import { DomainError, id } from '../packages/domain/core';
import { hash } from '../packages/domain/security';
import { staffPermissions } from '../packages/domain/contracts';
import type { Actor } from '../apps/api/src/auth';
let db: Database, s: Services;
const actor = (uid: string): Actor => ({
  id: uid,
  name: uid,
  email: `${uid}@pixup.demo`,
  csrf: 'fixture',
  is_staff: uid === 'ops',
  organizations: [],
  staff_permissions: uid === 'ops' ? [...staffPermissions] : [],
});
const buyer = actor('collector'),
  ops = actor('ops');
const rejects = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  s = new Services(db);
});
afterEach(async () => {
  await db.close();
});
async function newcomer() {
  return (
    await s.auth.register('Privacy participant', `${id()}@example.test`, 'Privacy-fixture-2026!')
  ).user!;
}
async function consent(user: Actor, adult = true) {
  const p = privacyPolicy();
  return s.privacy.consent(user, {
    adult,
    terms_version: p.terms_version,
    privacy_version: p.privacy_version,
    marketing_opt_in: false,
  });
}

test('new and legacy accounts require versioned adult declaration; negative declarations cannot self-override', async () => {
  const user = await newcomer();
  await assert.rejects(
    s.commerce.quote(user, { listing_id: 'listing-court-01', fulfillment: 'vault' }),
    rejects('CONSENT_REQUIRED'),
  );
  await consent(user, false);
  await assert.rejects(s.privacy.preferences(user, true), rejects('ACCOUNT_RESTRICTED'));
  await s.privacy.preferences(user, false);
  await assert.rejects(consent(user), rejects('ACCOUNT_RESTRICTED'));
  await assert.rejects(
    s.catalog.createAsset(user, {
      title: 'Blocked item',
      category: 'Art',
      artwork: 'orbit',
      description: 'No commercial activity for restricted accounts',
    }),
    rejects('ACCOUNT_RESTRICTED'),
  );
  const request = await s.privacy.request(
    user,
    'age_review',
    'Request independent eligibility review',
  );
  await assert.rejects(
    s.privacy.decide(buyer, request.id, 'restore_access', 'Pretended review completion'),
    rejects('FORBIDDEN'),
  );
  await s.privacy.decide(
    ops,
    request.id,
    'restore_access',
    'Pilot account eligibility review recorded',
  );
  assert.equal((await s.privacy.profile(user)).eligible, false);
  await consent(user);
  assert.equal((await s.privacy.profile(user)).eligible, true);
  await db.query("UPDATE privacy_profiles SET terms_version='old-policy' WHERE user_id=$1", [
    user.id,
  ]);
  await assert.rejects(
    s.commerce.quote(user, { listing_id: 'listing-court-01', fulfillment: 'vault' }),
    rejects('CONSENT_REQUIRED'),
  );
  await assert.rejects(db.query('DELETE FROM privacy_consents WHERE user_id=$1', [user.id]));
});
test('restriction invalidates a previous quote but preserves payment recovery, refunds and personal export', async () => {
  const quote = await s.commerce.quote(buyer, {
    listing_id: 'listing-court-01',
    fulfillment: 'vault',
  });
  const order = await s.commerce.checkout(
    buyer,
    { quote_id: quote.id, shipping_address: '' },
    id(),
  );
  const other = await s.commerce.quote(buyer, {
    listing_id: 'listing-orbit-01',
    fulfillment: 'vault',
  });
  await s.privacy.request(buyer, 'restrict', 'Pause future buying while reviewing my account');
  await assert.rejects(
    s.commerce.checkout(buyer, { quote_id: other.id, shipping_address: '' }, id()),
    rejects('ACCOUNT_RESTRICTED'),
  );
  await s.commerce.pay(buyer, order.id, true);
  await s.commerce.refund(buyer, order.id);
  const exported = await s.privacy.export(buyer);
  assert.equal(exported.user!.id, buyer.id);
  assert(!JSON.stringify(exported).includes('password_hash'));
  assert.equal(exported.orders[0].status, 'refunded');
  assert.equal((await s.commerce.order(buyer, order.id)).policy_snapshot.minimum_age, 18);
});
test('restricted sellers cannot sell through assigned channels; financial accounts cannot be silently erased', async () => {
  await s.channels.setGate(ops, 'liveup', true, 'Local policy restriction test evidence');
  const c = await s.channels.create(ops, {
    kind: 'liveup',
    org_id: 'ops-org',
    name: 'Restricted seller test',
    terms: { description: 'Fixed pilot terms and physical disclosure' },
  });
  const allocation = await s.channels.assign(ops, c.id, {
    listing_id: 'listing-court-01',
    slot: '1',
  });
  await s.privacy.request(
    actor('platform'),
    'restrict',
    'Pause platform fixture new sales for review',
  );
  await assert.rejects(
    s.commerce.quote(buyer, {
      listing_id: 'listing-court-01',
      allocation_id: allocation.id,
      fulfillment: 'vault',
    }),
    rejects('SELLER_RESTRICTED'),
  );
  const request = await s.privacy.request(
    buyer,
    'delete',
    'Please close this account after retention review',
  );
  await assert.rejects(
    s.privacy.decide(ops, request.id, 'complete', 'Reviewed account closure eligibility'),
    rejects('RETENTION_REVIEW_REQUIRED'),
  );
  assert.equal(
    (await one(db, 'SELECT status FROM privacy_requests WHERE id=$1', [request.id]))!.status,
    'open',
  );
});
test('low-history account closure pseudonymizes profile, invalidates sessions and preserves audit', async () => {
  const login = await s.auth.register('Close me', `${id()}@example.test`, 'Privacy-fixture-2026!'),
    user = login.user!;
  await consent(user);
  const request = await s.privacy.request(user, 'delete', 'Close my unused personal pilot account');
  await s.privacy.decide(
    ops,
    request.id,
    'complete',
    'No business, custody or shared-workspace records found',
  );
  assert.equal(await s.auth.session(login.token), null);
  assert.equal(
    (await one(db, 'SELECT name FROM users WHERE id=$1', [user.id]))!.name,
    'Closed account',
  );
  await assert.rejects(
    s.auth.login(user.email, 'Privacy-fixture-2026!'),
    rejects('INVALID_CREDENTIALS'),
  );
  assert(
    (await one(db, "SELECT id FROM audit_log WHERE action='privacy.decided' AND resource_id=$1", [
      request.id,
    ]))!.id,
  );
});
test('account throttling persists across service instances and prevents scrypt abuse', async () => {
  await db.query('INSERT INTO auth_attempts(key,attempts) VALUES ($1,20)', [
    hash('collector@pixup.demo'),
  ]);
  await assert.rejects(
    new Services(db).auth.login('collector@pixup.demo', 'PixupDemo2026!'),
    rejects('AUTH_RATE_LIMIT'),
  );
  await db.query("UPDATE auth_attempts SET window_started=now()-interval '16 minutes'");
  assert((await s.auth.login('collector@pixup.demo', 'PixupDemo2026!')).user);
});
test('operational alerts deduplicate, retain acknowledgement and resolve only when condition clears', async () => {
  await s.monitoring.heartbeat(true);
  await db.query(
    "INSERT INTO outbox(id,type,aggregate_id,created_at) VALUES ($1,'fixture','alert-fixture',now()-interval '10 minutes')",
    [id()],
  );
  await s.monitoring.evaluate();
  await s.monitoring.evaluate();
  await assert.rejects(s.monitoring.dashboard(buyer), rejects('FORBIDDEN'));
  await s.monitoring.acknowledge(ops, 'outbox_backlog', 'INC-123 investigate worker backlog');
  await s.monitoring.evaluate();
  let a = await one(db, "SELECT * FROM operational_alerts WHERE code='outbox_backlog'");
  assert.equal(a!.status, 'active');
  assert.equal(a!.acknowledged_by, 'ops');
  await db.query("UPDATE outbox SET processed_at=now() WHERE aggregate_id='alert-fixture'");
  await s.monitoring.evaluate();
  a = await one(db, "SELECT * FROM operational_alerts WHERE code='outbox_backlog'");
  assert.equal(a!.status, 'resolved');
  await db.query("UPDATE outbox SET processed_at=NULL WHERE aggregate_id='alert-fixture'");
  await s.monitoring.evaluate();
  assert.equal(
    (await one(db, "SELECT acknowledged_by FROM operational_alerts WHERE code='outbox_backlog'"))!
      .acknowledged_by,
    null,
  );
  await db.query("UPDATE operational_heartbeats SET last_success=now()-interval '1 minute'");
  assert.equal((await s.monitoring.ready()).ok, false);
});
test('HTTP metrics require authorization and sensitive request data never enters telemetry', async () => {
  const logs: object[] = [];
  s.monitoring = new MonitoringService(db, (r) => logs.push(r));
  const server = createApp(s).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1`;
  try {
    const secret = 'MUST_NOT_APPEAR_IN_LOGS';
    assert.equal((await fetch(base + '/metrics')).status, 401);
    const rejected = await fetch(base + '/auth/login?private=' + secret, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ email: 'nobody@example.test', password: secret }),
    });
    assert.equal(rejected.status, 401);
    const malformed = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get('x-content-type-options'), 'nosniff');
    const device = await fetch(base + '/devices/missing/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(device.status, 401);
    assert.equal(device.headers.get('cache-control'), 'no-store');
    const login = await s.auth.login('ops@pixup.demo', 'PixupDemo2026!');
    assert.equal(
      (await fetch(base + '/metrics', { headers: { cookie: `pixup_session=${login.token}` } }))
        .status,
      200,
    );
    await s.monitoring.flush();
    const stored = (await db.query('SELECT * FROM operational_events')).rows;
    assert(!JSON.stringify({ logs, stored }).includes(secret));
    assert(!JSON.stringify({ logs, stored }).includes('nobody@example.test'));
    assert(stored.some((e) => e.status === 401));
    assert((await s.monitoring.prometheus()).includes('pixup_http_duration_seconds_bucket'));
    // A saturated credential-attempt limit must still allow an authenticated user to sign out.
    for (let i = 0; i < 29; i++)
      await fetch(base + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    assert.equal((await fetch(base + '/auth/login', { method: 'POST' })).status, 429);
    assert.equal(
      (
        await fetch(base + '/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `pixup_session=${login.token}`,
            'X-CSRF-Token': login.user!.csrf,
          },
          body: '{}',
        })
      ).status,
      200,
    );
    assert.equal(await s.auth.session(login.token), null);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
