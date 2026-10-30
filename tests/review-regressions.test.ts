import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { openDatabase, migrate, one, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services } from '../apps/api/src/app';
import { DomainError, id } from '../packages/domain/core';
import { staffPermissions } from '../packages/domain/contracts';
import type { Actor } from '../apps/api/src/auth';

const actor = (uid: string): Actor => ({
  id: uid,
  email: `${uid}@pixup.demo`,
  name: uid,
  is_staff: uid === 'ops',
  staff_permissions: uid === 'ops' ? [...staffPermissions] : [],
  csrf: 'test',
  organizations: [],
});
const buyer = actor('collector'),
  other = actor('seller'),
  platform = actor('platform'),
  ops = actor('ops');
const rejection = (code: string) => (error: unknown) =>
  error instanceof DomainError && error.code === code;
let db: Database, s: Services;
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  s = new Services(db);
});
afterEach(async () => db.close());
async function privateStock() {
  await db.query(
    "INSERT INTO collections(id,org_id,title,description,category,edition_size,status) VALUES ('private-stock','platform-org','Private approved stock','Not yet published to the public','Sports',1,'stock_ready')",
  );
  await db.query("UPDATE assets SET collection_id='private-stock' WHERE id='court-01'");
}
async function resale() {
  const q = await s.commerce.quote(buyer, { listing_id: 'listing-court-01', fulfillment: 'vault' });
  const order = await s.commerce.checkout(buyer, { quote_id: q.id }, id());
  await s.commerce.pay(buyer, order.id, true);
  const listing = await s.catalog.list(buyer, 'court-01', 13000);
  return { order, listing };
}
async function toolKey() {
  for (const kind of ['cvm', 'liveup', 'goup', 'waxup', 'ai'])
    await s.channels.setGate(ops, kind, true, 'Synthetic review regression activation');
  return s.tools.create(other, {
    org_id: 'seller-org',
    name: 'Review discovery fixture',
    scopes: ['query', 'route'],
    daily_limit: 20,
  });
}

test('unpublished collection stock cannot bypass publishing through individual listings or checkout', async () => {
  await privateStock();
  await assert.rejects(
    s.commerce.quote(buyer, { listing_id: 'listing-court-01', fulfillment: 'vault' }),
    rejection('INELIGIBLE'),
  );
  await db.query("UPDATE listings SET status='withdrawn' WHERE id='listing-court-01'");
  await assert.rejects(
    s.catalog.list(platform, 'court-01', 13000),
    rejection('COLLECTION_NOT_PUBLISHED'),
  );
});

test('draft stock and its artwork stay private even when an old active listing exists', async () => {
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#4488aa' } })
    .png()
    .toBuffer();
  const media = await s.media.upload(platform, bytes);
  await db.query("UPDATE assets SET artwork=$1 WHERE id='court-01'", [media.artwork]);
  await s.catalog.save(buyer, 'court-01', true);
  await privateStock();
  await assert.rejects(s.catalog.item('court-01'), rejection('NOT_FOUND'));
  await assert.rejects(s.media.read(media.id, null), rejection('NOT_FOUND'));
  assert.equal((await s.catalog.portfolio(buyer)).saved.length, 0);
  await s.catalog.save(buyer, 'court-01', false);
  assert.equal((await s.catalog.item('court-01', platform)).is_owner, true);
  assert.ok(await s.media.read(media.id, platform));
});

test('saved public stock omits other owners and delegated inventory workspace identifiers', async () => {
  await s.catalog.save(buyer, 'court-01', true);
  const saved = (await s.catalog.portfolio(buyer)).saved[0];
  assert.equal(saved.owner_id, undefined);
  assert.equal(saved.inventory_org_id, undefined);
});

test('channel catalog hides unpublished legacy allocations without reallocating GOUP shipping', async () => {
  await toolKey();
  const c = await s.channels.create(ops, {
    kind: 'goup',
    org_id: 'ops-org',
    name: 'Publication boundary group',
    terms: {
      description: 'Synthetic group for publication review',
      target_units: 2,
      shipping_total_cents: 801,
    },
    deadline: new Date(Date.now() + 3600000).toISOString(),
  });
  await s.channels.assign(ops, c.id, { listing_id: 'listing-court-01', slot: '1' });
  await s.channels.assign(ops, c.id, { listing_id: 'listing-orbit-01', slot: '2' });
  const before = await s.channels.detail(c.id);
  assert.equal(before.items.length, 2);
  await privateStock();
  const after = await s.channels.detail(c.id);
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].asset_id, 'orbit-01');
  assert.equal(after.items[0].shipping_cents, 400);
  assert.equal(after.items[0].published, undefined);
});

test('reconciliation exceptions block resale quote, checkout, listing and scoped discovery', async () => {
  const { order, listing } = await resale();
  const key = await toolKey();
  const q = await s.commerce.quote(other, { listing_id: listing.id, fulfillment: 'vault' });
  await db.query(
    "INSERT INTO payment_exceptions(order_id,code,state) VALUES ($1,'PROVIDER_RECONCILIATION','open')",
    [order.id],
  );
  const routed = await s.tools.execute(`Bearer ${key.secret}`, 'route', {
    request_id: id(),
    asset_id: 'court-01',
  });
  assert.deepEqual(routed.items, []);
  await assert.rejects(
    s.commerce.quote(other, { listing_id: listing.id, fulfillment: 'vault' }),
    rejection('INELIGIBLE'),
  );
  await assert.rejects(
    s.commerce.checkout(other, { quote_id: q.id }, id()),
    rejection('INELIGIBLE'),
  );
  await s.catalog.withdrawListing(buyer, listing.id);
  await assert.rejects(s.catalog.list(buyer, 'court-01', 13000), rejection('REFUND_PENDING'));
  await db.query("UPDATE payment_exceptions SET state='resolved' WHERE order_id=$1", [order.id]);
  assert.ok((await s.catalog.list(buyer, 'court-01', 13000)).id);
});

test('a queued signed dispute blocks a reserved resale before provider reconciliation completes', async () => {
  const { order, listing } = await resale();
  const q = await s.commerce.quote(other, { listing_id: listing.id, fulfillment: 'vault' });
  const reserved = await s.commerce.checkout(other, { quote_id: q.id }, id());
  await db.query(
    "INSERT INTO payment_attempts(id,order_id,account_id,payment_intent_id) VALUES ($1,$2,'acct_review','pi_review')",
    [id(), order.id],
  );
  await db.query(
    "INSERT INTO payment_control_events(account_id,event_id,event_type,object_id,payment_intent_id,payload_hash) VALUES ('acct_review','evt_review','charge.dispute.created','dp_review','pi_review','synthetic')",
  );
  await assert.rejects(s.commerce.pay(other, reserved.id, true), rejection('INVENTORY_CONFLICT'));
  assert.equal(
    (await one(db, "SELECT owner_id FROM assets WHERE id='court-01'"))!.owner_id,
    buyer.id,
  );
  await db.query(
    "UPDATE payment_control_events SET processed_at=now() WHERE event_id='evt_review'",
  );
  assert.equal((await s.commerce.pay(other, reserved.id, true)).status, 'fulfilled');
});
