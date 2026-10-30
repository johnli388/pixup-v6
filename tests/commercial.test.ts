import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate, one, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services, createApp } from '../apps/api/src/app';
import { DomainError, id } from '../packages/domain/core';
import { commercialProposal } from '../packages/domain/commercial-policy';
import { staffPermissions } from '../packages/domain/contracts';
import type { Actor } from '../apps/api/src/auth';

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
let db: Database, s: Services;
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  await db.query("UPDATE users SET is_staff=true WHERE id='creator'");
  await db.query("INSERT INTO staff_permissions(user_id,permission) VALUES ('creator','finance')");
  s = new Services(db);
});
afterEach(async () => db.close());
const review = { decision: 'approve', note: 'Independent synthetic local pilot review only.' };
async function proposal(action = 'record_review', topic = 'credit_redemption') {
  return s.commercial.propose(ops, {
    topic,
    action,
    base_version: (await s.commercial.dashboard(ops)).policy.version,
    statement: 'Synthetic decision preserves unresolved production commercial terms.',
    evidence: 'Fixture review memo; no live contract authority.',
  });
}
const quote = () =>
  s.commerce.quote(buyer, {
    listing_id: 'listing-court-01',
    fulfillment: 'vault',
    use_credits: true,
  });

test('baseline preserves all seven unresolved areas, owned-stock credits and 18+ without fabricating approvals', async () => {
  const d = await s.commercial.dashboard(ops);
  assert.equal(d.policy.production_launch_approved, false);
  assert.equal(d.minimum_age, 18);
  assert.equal(Object.keys(d.policy.terms).length, 7);
  assert.deepEqual(d.policy.reviewed_decisions, {});
  assert.equal(d.decisions.length, 0);
  const q = await quote();
  assert.ok(q.credit_units > 0);
  assert.equal(q.commercial_snapshot.minimum_age, 18);
  assert.equal(q.commercial_policy_version, 1);
  await migrate(db);
  assert.equal((await s.commercial.dashboard(ops)).versions.length, 1);
});
test('independent current finance authority and immutable proposals are required', async () => {
  await assert.rejects(s.commercial.dashboard(buyer), rejection('FORBIDDEN'));
  const p = await proposal();
  await assert.rejects(
    s.commercial.review(ops, p.id, review),
    rejection('INDEPENDENT_REVIEW_REQUIRED'),
  );
  await assert.rejects(
    db.query("UPDATE commercial_decisions SET statement='changed evidence' WHERE id=$1", [p.id]),
  );
  await db.query("DELETE FROM staff_permissions WHERE user_id='creator' AND permission='finance'");
  await assert.rejects(s.commercial.review(reviewer, p.id, review), rejection('FORBIDDEN'));
  await db.query("INSERT INTO staff_permissions(user_id,permission) VALUES ('creator','finance')");
  await db.query("DELETE FROM staff_permissions WHERE user_id='ops' AND permission='finance'");
  await assert.rejects(s.commercial.review(reviewer, p.id, review), rejection('APPROVAL_STALE'));
  assert.equal((await s.commercial.dashboard(reviewer)).policy.version, 1);
});
test('credit approval invalidates outstanding quotes and cannot rewrite quotes or historical orders', async () => {
  const old = await quote();
  const p = await proposal('disable_credits');
  await s.commercial.review(reviewer, p.id, review);
  await assert.rejects(
    s.commerce.checkout(buyer, { quote_id: old.id }, id()),
    rejection('POLICY_STALE'),
  );
  const q = await quote();
  assert.equal(q.credit_units, 0);
  assert.equal(q.commercial_policy_version, 2);
  const order = await s.commerce.checkout(buyer, { quote_id: q.id }, id());
  const record = await one(db, 'SELECT * FROM orders WHERE id=$1', [order.id]);
  assert.deepEqual(record!.commercial_snapshot, q.commercial_snapshot);
  await assert.rejects(
    db.query('UPDATE orders SET commercial_snapshot=$2 WHERE id=$1', [order.id, '{}']),
  );
  await assert.rejects(
    db.query('UPDATE quotes SET commercial_policy_version=1 WHERE id=$1', [q.id]),
  );
  await assert.rejects(
    db.query('UPDATE commercial_policy_versions SET snapshot=$1 WHERE version=1', ['{}']),
  );
  await assert.rejects(db.query('DELETE FROM commercial_decisions WHERE id=$1', [p.id]));
  await assert.rejects(s.commercial.review(reviewer, p.id, review), rejection('DECISION_CLOSED'));
});
test('pause blocks new checkout but preserves committed replay, payment, refunds, title and original credits', async () => {
  const q = await quote(),
    uncommitted = await quote(),
    key = id(),
    input = { quote_id: q.id };
  const order = await s.commerce.checkout(buyer, input, key);
  const p = await proposal('pause_sales', 'jurisdiction_age');
  await s.commercial.review(reviewer, p.id, review);
  await assert.rejects(quote(), rejection('COMMERCIAL_PAUSED'));
  await assert.rejects(
    s.commerce.checkout(buyer, { quote_id: uncommitted.id }, id()),
    rejection('COMMERCIAL_PAUSED'),
  );
  assert.deepEqual(await s.commerce.checkout(buyer, input, key), order);
  assert.deepEqual(await s.commerce.checkout(buyer, input, id()), order);
  await s.commerce.pay(buyer, order.id, true);
  await s.commerce.refund(buyer, order.id);
  const restored = await one(db, 'SELECT * FROM orders WHERE id=$1', [order.id]);
  assert.equal(restored!.status, 'refunded');
  assert.equal(restored!.commercial_policy_version, 1);
  assert.equal(restored!.commercial_snapshot.credit_scope, 'pixup_owned');
  assert.equal(
    (await one(db, "SELECT sum(available)::int AS n FROM credit_lots WHERE user_id='collector'"))!
      .n,
    1200,
  );
});
test('competing approvals produce one new version, stale decisions can be rejected, rejection changes no policy', async () => {
  const a = await proposal(),
    b = await proposal();
  const results = await Promise.allSettled([
    s.commercial.review(reviewer, a.id, review),
    s.commercial.review(reviewer, b.id, review),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const d = await s.commercial.dashboard(ops);
  assert.equal(d.policy.version, 2);
  const pending = d.decisions.find((row) => row.state === 'pending')!;
  await s.commercial.review(reviewer, pending.id, {
    decision: 'reject',
    note: 'Superseded by another independent pilot review.',
  });
  assert.equal((await s.commercial.dashboard(ops)).policy.version, 2);
});
test('expired approval and unsupported commercial activation fail closed', async () => {
  // Insert an expired fixture directly rather than weakening immutable expiry in production.
  await db.query(`INSERT INTO commercial_decisions(id,topic,action,base_version,statement,evidence,requested_by,expires_at)
    VALUES ('expired','taxation','record_review',1,'Synthetic expired proposal for review','Fixture tax memo','ops',now()-interval '1 hour')`);
  await assert.rejects(
    s.commercial.review(reviewer, 'expired', review),
    rejection('DECISION_EXPIRED'),
  );
  for (const input of [
    { topic: 'taxation', action: 'enable_tax' },
    { topic: 'creator_entitlements', action: 'disable_credits' },
    { topic: 'jurisdiction_age', action: 'record_review', minimum_age: 16 },
    { topic: 'credit_redemption', action: 'record_review', credit_scope: 'all_sellers' },
  ])
    assert.equal(
      commercialProposal.safeParse({
        base_version: 1,
        statement: 'Synthetic unsupported commercial change',
        evidence: 'Fixture only memo',
        ...input,
      }).success,
      false,
    );
});
test('a historical quote is not treated as buyer assent and must be refreshed', async () => {
  await db.query(`INSERT INTO quotes(id,buyer_id,listing_id,price_cents,fee_cents,credit_units,fulfillment,shipping_cents,expires_at)
    VALUES ('legacy-quote','collector','listing-court-01',1000,50,0,'vault',0,now()+interval '10 minutes')`);
  await assert.rejects(
    s.commerce.checkout(buyer, { quote_id: 'legacy-quote' }, id()),
    rejection('POLICY_STALE'),
  );
  assert.equal(
    (await one(db, "SELECT commercial_snapshot FROM quotes WHERE id='legacy-quote'"))!
      .commercial_snapshot,
    null,
  );
});
test('restoring pilot controls requires fresh independent approval and does not approve production terms', async () => {
  for (const [action, topic] of [
    ['disable_credits', 'credit_redemption'],
    ['pause_sales', 'jurisdiction_age'],
    ['resume_pilot_sales', 'jurisdiction_age'],
    ['restore_pilot_credits', 'credit_redemption'],
  ]) {
    const p = await proposal(action, topic);
    await s.commercial.review(reviewer, p.id, review);
  }
  assert.ok((await quote()).credit_units > 0);
  const d = await s.commercial.dashboard(ops);
  assert.equal(d.policy.version, 5);
  assert.equal(d.policy.production_launch_approved, false);
  assert.equal(d.policy.scope, 'local_pilot');
});

test('commercial HTTP routes enforce sessions, finance scope, CSRF and strict proposal input', async () => {
  const server = createApp(s).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1/ops/commercial`;
  try {
    assert.equal((await fetch(base)).status, 401);
    const buyerLogin = await s.auth.login(buyer.email, 'PixupDemo2026!');
    assert.equal(
      (await fetch(base, { headers: { cookie: `pixup_session=${buyerLogin.token}` } })).status,
      403,
    );
    const login = await s.auth.login(ops.email, 'PixupDemo2026!');
    const headers = { cookie: `pixup_session=${login.token}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(base, { headers })).status, 200);
    const body = JSON.stringify({
      topic: 'taxation',
      action: 'record_review',
      base_version: 1,
      statement: 'A synthetic review preserves test-only taxation.',
      evidence: 'Synthetic tax evidence reference.',
    });
    assert.equal((await fetch(base + '/decisions', { method: 'POST', headers, body })).status, 403);
    const authenticated = { ...headers, 'X-CSRF-Token': login.user!.csrf };
    assert.equal(
      (
        await fetch(base + '/decisions', {
          method: 'POST',
          headers: authenticated,
          body: JSON.stringify({ ...JSON.parse(body), production_launch_approved: true }),
        })
      ).status,
      400,
    );
    const response = await fetch(base + '/decisions', {
      method: 'POST',
      headers: authenticated,
      body,
    });
    assert.equal(response.status, 200);
    const p = (await response.json()) as { id: string };
    assert.equal(
      (
        await fetch(base + `/decisions/${p.id}/review`, {
          method: 'POST',
          headers: authenticated,
          body: JSON.stringify(review),
        })
      ).status,
      403,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
