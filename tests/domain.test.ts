import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate, one, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services } from '../apps/api/src/app';
import type { Actor } from '../apps/api/src/auth';
import { journal, id, DomainError } from '../packages/domain/core';
import sharp from 'sharp';
import { staffPermissions } from '../packages/domain/contracts';

let db: Database, s: Services;
const actor = (uid: string): Actor => ({
  id: uid,
  email: `${uid}@pixup.demo`,
  name: uid,
  is_staff: uid === 'ops',
  csrf: 'test',
  organizations: [],
  staff_permissions: uid === 'ops' ? [...staffPermissions] : [],
});
const buyer = actor('collector'),
  seller = actor('seller'),
  creator = actor('creator'),
  ops = actor('ops');
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  s = new Services(db);
});
afterEach(async () => {
  await db.close();
});
async function purchase(
  aid = 'court-01',
  options: { credits?: boolean; fulfillment?: string } = {},
) {
  const quote = await s.commerce.quote(buyer, {
    listing_id: `listing-${aid}`,
    fulfillment: options.fulfillment || 'vault',
    use_credits: !!options.credits,
  });
  const order = await s.commerce.checkout(
    buyer,
    {
      quote_id: quote.id,
      shipping_address:
        options.fulfillment === 'ship' ? '123 Fictional Lane, Demo City, CA 90000' : '',
    },
    id(),
  );
  await s.commerce.pay(buyer, order.id, true);
  return order;
}
const rejection = (code: string) => (error: unknown) =>
  error instanceof DomainError && error.code === code;

test('an earlier sale cannot be refunded after a collectible circulates back to the buyer', async () => {
  const original = await purchase();
  for (const [from, to] of [
    [buyer, seller],
    [seller, buyer],
  ]) {
    const listing = await s.catalog.list(from, 'court-01', 10000);
    const quote = await s.commerce.quote(to, { listing_id: listing.id, fulfillment: 'vault' });
    const order = await s.commerce.checkout(to, { quote_id: quote.id, shipping_address: '' }, id());
    await s.commerce.pay(to, order.id, true);
  }
  await assert.rejects(s.commerce.refund(buyer, original.id), rejection('LATER_SALE'));
  assert.equal(
    (await one(db, 'SELECT owner_id FROM assets WHERE id=$1', ['court-01']))!.owner_id,
    buyer.id,
  );
});

test('private creator records require membership and publishing entitlement', async () => {
  await assert.rejects(s.catalog.creator(buyer, 'creator-org'), rejection('FORBIDDEN'));
  assert.equal((await s.catalog.creator(creator, 'creator-org')).collections.length, 4);
  await assert.rejects(s.operations.dashboard(buyer), rejection('FORBIDDEN'));
});
test('two buyers competing for one specimen produce exactly one reservation', async () => {
  const a = await s.commerce.quote(buyer, { listing_id: 'listing-court-01', fulfillment: 'vault' });
  const b = await s.commerce.quote(seller, {
    listing_id: 'listing-court-01',
    fulfillment: 'vault',
  });
  const results = await Promise.allSettled([
    s.commerce.checkout(buyer, { quote_id: a.id, shipping_address: '' }, id()),
    s.commerce.checkout(seller, { quote_id: b.id, shipping_address: '' }, id()),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await one(db, "SELECT count(*)::int AS n FROM orders WHERE status='pending_payment'"))!.n,
    1,
  );
});
test('checkout replay returns the same order and rejects a changed request', async () => {
  const q = await s.commerce.quote(buyer, { listing_id: 'listing-court-01', fulfillment: 'vault' }),
    key = id(),
    body = { quote_id: q.id, shipping_address: '' };
  const first = await s.commerce.checkout(buyer, body, key),
    second = await s.commerce.checkout(buyer, body, key);
  assert.equal(first.id, second.id);
  await assert.rejects(
    s.commerce.checkout(buyer, { ...body, shipping_address: 'changed' }, key),
    rejection('IDEMPOTENCY_CONFLICT'),
  );
});
test('payment and refund retries do not duplicate ownership or accounting effects', async () => {
  const order = await purchase();
  await s.commerce.pay(buyer, order.id, true);
  assert.equal(
    (await one(db, 'SELECT owner_id FROM assets WHERE id=$1', ['court-01']))!.owner_id,
    'collector',
  );
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM journal_entries WHERE reference=$1', [
      `payment:${order.id}`,
    ]))!.n,
    1,
  );
  await s.commerce.refund(buyer, order.id);
  await s.commerce.refund(buyer, order.id);
  assert.equal(
    (await one(db, 'SELECT owner_id FROM assets WHERE id=$1', ['court-01']))!.owner_id,
    'platform',
  );
  const amounts = (
    await db.query(
      "SELECT account,sum(amount)::int AS amount FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.unit='USD' GROUP BY account",
    )
  ).rows;
  assert(amounts.every((a) => a.amount === 0));
});
test('credit reservations prevent overspending, release on failure, and restore on refund', async () => {
  const q1 = await s.commerce.quote(buyer, {
    listing_id: 'listing-court-01',
    fulfillment: 'vault',
    use_credits: true,
  });
  const q2 = await s.commerce.quote(buyer, {
    listing_id: 'listing-orbit-01',
    fulfillment: 'vault',
    use_credits: true,
  });
  const o1 = await s.commerce.checkout(buyer, { quote_id: q1.id, shipping_address: '' }, id());
  assert.equal((await s.commerce.credits(buyer)).held, 1200);
  await assert.rejects(
    s.commerce.checkout(buyer, { quote_id: q2.id, shipping_address: '' }, id()),
    rejection('INSUFFICIENT_CREDITS'),
  );
  await s.commerce.pay(buyer, o1.id, false);
  assert.equal((await s.commerce.credits(buyer)).available, 1200);
  const paid = await purchase('orbit-01', { credits: true });
  assert.equal((await s.commerce.credits(buyer)).available, 0);
  await s.commerce.refund(buyer, paid.id);
  assert.equal((await s.commerce.credits(buyer)).available, 1200);
});
test('credits cannot be applied to third-party seller goods', async () => {
  const q = await s.commerce.quote(buyer, {
    listing_id: 'listing-idol-01',
    fulfillment: 'vault',
    use_credits: true,
  });
  assert.equal(q.credit_units, 0);
  assert.equal(q.total_cents, 8500);
});
test('expired quotes and reservation expirations do not sell inventory', async () => {
  const q = await s.commerce.quote(buyer, { listing_id: 'listing-court-01', fulfillment: 'vault' });
  await db.query("UPDATE quotes SET expires_at=now()-interval '1 minute' WHERE id=$1", [q.id]);
  await assert.rejects(
    s.commerce.checkout(buyer, { quote_id: q.id, shipping_address: '' }, id()),
    rejection('QUOTE_EXPIRED'),
  );
  const q2 = await s.commerce.quote(buyer, {
    listing_id: 'listing-court-01',
    fulfillment: 'vault',
    use_credits: true,
  });
  const order = await s.commerce.checkout(buyer, { quote_id: q2.id, shipping_address: '' }, id());
  await db.query("UPDATE orders SET reservation_expires_at=now()-interval '1 minute' WHERE id=$1", [
    order.id,
  ]);
  await s.commerce.expire();
  assert.equal((await s.commerce.order(buyer, order.id)).status, 'canceled');
  assert.equal((await s.commerce.credits(buyer)).available, 1200);
  await assert.rejects(s.commerce.pay(buyer, order.id, true), rejection('INVALID_STATE'));
});
test('RePool grant requires receipt and independent assessment; repeated acceptance fails', async () => {
  const intake = await s.operations.intake(buyer, {
    asset_id: 'owned-01',
    kind: 'repool',
    evidence: 'Original demo specimen in vault',
    accepted_terms: true,
  });
  assert.equal((await s.commerce.credits(buyer)).available, 1200);
  await assert.rejects(
    s.operations.intakeAction(ops, intake.id, {
      action: 'accept',
      grade: '9.5',
      note: 'Validated demonstration item',
    }),
    rejection('RECEIPT_REQUIRED'),
  );
  await s.operations.intakeAction(ops, intake.id, {
    action: 'receive',
    note: 'Received in vault bay 1',
  });
  await s.operations.intakeAction(ops, intake.id, {
    action: 'accept',
    grade: '9.5',
    note: 'Identity and condition checked',
  });
  assert.equal((await s.commerce.credits(buyer)).available, 1700);
  assert.equal(
    (await one(db, "SELECT owner_id FROM assets WHERE id='owned-01'"))!.owner_id,
    'platform',
  );
  await assert.rejects(
    s.operations.intakeAction(ops, intake.id, {
      action: 'accept',
      grade: '9.5',
      note: 'A duplicated acceptance',
    }),
    rejection('OWNER_CHANGED'),
  );
});
test('unverified asset cannot list; completed VIA intake enables listing', async () => {
  const a = await s.catalog.createAsset(seller, {
    title: 'Independent sample',
    category: 'Sports',
    artwork: 'court',
    description: 'Original demonstration collectible.',
  });
  await assert.rejects(s.catalog.list(seller, a.id, 5000), rejection('INELIGIBLE'));
  const i = await s.operations.intake(seller, {
    asset_id: a.id,
    kind: 'vault',
    evidence: 'Serial and condition details',
    accepted_terms: true,
  });
  await s.operations.intakeAction(ops, i.id, {
    action: 'receive',
    note: 'Package and serial received',
  });
  await s.operations.intakeAction(ops, i.id, {
    action: 'accept',
    grade: '9',
    note: 'All identification checks passed',
  });
  const l = await s.catalog.list(seller, a.id, 5000);
  assert(l.id);
});
test('creator publication requires review and approved stock within edition cap', async () => {
  const c = await s.catalog.createCollection(creator, {
    org_id: 'creator-org',
    title: 'Test edition',
    description: 'An original demonstration collection.',
    category: 'Art',
    edition_size: 2,
    rights_evidence: 'Original artwork owned by the test studio.',
    artwork: 'orbit',
  });
  await assert.rejects(
    s.catalog.collectionAction(creator, c.id, 'publish', { price_cents: 6000 }),
    rejection('STOCK_NOT_READY'),
  );
  await s.catalog.collectionAction(creator, c.id, 'submit', {});
  await s.operations.reviewCollection(ops, c.id, {
    approve: true,
    note: 'Original rights evidence reviewed',
  });
  await assert.rejects(
    s.operations.receiveStock(ops, c.id, {
      quantity: 3,
      evidence: 'Three physical specimens received',
    }),
    rejection('EDITION_LIMIT'),
  );
  await s.operations.receiveStock(ops, c.id, {
    quantity: 2,
    evidence: 'Two specimens inspected and received',
  });
  await s.catalog.collectionAction(creator, c.id, 'publish', { price_cents: 6000 });
  assert.equal((await s.catalog.collection(c.id)).items.length, 2);
});
test('certificate revocation preserves evidence and removes a listing from sale', async () => {
  await s.operations.revoke(ops, 'court-01', 'A new physical authenticity concern');
  assert.equal((await s.catalog.verify('VIA-000001')).valid, false);
  await assert.rejects(
    s.commerce.quote(buyer, { listing_id: 'listing-court-01', fulfillment: 'vault' }),
    rejection('INVENTORY_CONFLICT'),
  );
  assert.equal(
    (await one(db, "SELECT count(*)::int AS n FROM assessments WHERE asset_id='court-01'"))!.n,
    2,
  );
});
test('shipment pending blocks resale and recirculation until resolved', async () => {
  const o = await purchase('court-01', { fulfillment: 'ship' });
  await assert.rejects(s.catalog.list(buyer, 'court-01', 20000), rejection('SHIPMENT_PENDING'));
  await assert.rejects(
    s.operations.intake(buyer, {
      asset_id: 'court-01',
      kind: 'repool',
      evidence: 'Requesting recirculation',
    }),
    rejection('SHIPMENT_PENDING'),
  );
  await s.operations.fulfill(ops, o.id, 'DEMO-TRACK-123');
  assert.equal((await s.commerce.order(buyer, o.id)).tracking, 'DEMO-TRACK-123');
});
test('settlement release respects fulfillment and support holds', async () => {
  const o = await purchase();
  const settlement = (await s.operations.dashboard(ops)).settlements[0];
  const c = await s.operations.support(buyer, {
    order_id: o.id,
    subject: 'Item concern',
    body: 'Please inspect this demonstration collectible.',
  });
  await assert.rejects(
    s.operations.releaseSettlement(ops, settlement.id),
    rejection('DISPUTE_OPEN'),
  );
  await s.operations.resolveCase(ops, c.id, 'Resolved with inspection evidence.');
  await s.operations.releaseSettlement(ops, settlement.id);
  await assert.rejects(s.commerce.refund(buyer, o.id), rejection('RECOVERY_REQUIRED'));
});
test('database rejects unbalanced journals, late unbalanced lines and historical edits', async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO journal_entries(id,reference,unit,description) VALUES ('bad','bad','USD','Invalid')",
      );
      await tx.query(
        "INSERT INTO journal_lines(id,entry_id,account,amount) VALUES ('badline','bad','cash',100)",
      );
    }),
    /balance/,
  );
  await assert.rejects(db.query('UPDATE journal_lines SET amount=1'), /Append-only/);
  const e = await one(db, "SELECT id FROM journal_entries WHERE reference='demo-welcome'");
  await assert.rejects(
    db.query('INSERT INTO journal_lines(id,entry_id,account,amount) VALUES ($1,$2,$3,50)', [
      id(),
      e!.id,
      'arbitrary',
    ]),
    /balance/,
  );
  await assert.rejects(
    db.query("DELETE FROM provenance_events WHERE asset_id='court-01'"),
    /Append-only/,
  );
});
test('outbox delivery is transactional and deduplicated', async () => {
  await purchase();
  await s.operations.worker();
  const first = (await s.operations.activity(buyer)).length;
  await db.query('UPDATE outbox SET processed_at=NULL');
  await s.operations.worker();
  assert.equal((await s.operations.activity(buyer)).length, first);
});

test('uploaded artwork is decoded, private by default, and cannot be attached by another user', async () => {
  const png = await sharp({ create: { width: 24, height: 36, channels: 3, background: '#5f8465' } })
    .png()
    .toBuffer();
  const image = await s.media.upload(creator, png);
  await assert.rejects(s.media.read(image.id, null), rejection('NOT_FOUND'));
  await assert.rejects(
    s.catalog.createAsset(buyer, {
      title: 'Unauthorized image',
      category: 'Art',
      description: 'This is an unauthorized image reference.',
      artwork: image.artwork,
    }),
    rejection('MEDIA_FORBIDDEN'),
  );
  const own = await s.media.read(image.id, creator);
  assert.equal(own.mime, 'image/webp');
  await assert.rejects(
    s.media.upload(creator, Buffer.from('<svg><script>alert(1)</script></svg>')),
    rejection('INVALID_IMAGE'),
  );
  const c = await s.catalog.createCollection(creator, {
    org_id: 'creator-org',
    title: 'Uploaded artwork edition',
    description: 'An original collection with uploaded art.',
    category: 'Art',
    edition_size: 1,
    rights_evidence: 'Original artwork with documented demo authorization.',
    artwork: image.artwork,
  });
  await s.catalog.collectionAction(creator, c.id, 'submit', {});
  await s.operations.reviewCollection(ops, c.id, {
    approve: true,
    note: 'Rights evidence independently reviewed.',
  });
  await s.operations.receiveStock(ops, c.id, {
    quantity: 1,
    evidence: 'Private production evidence: INTERNAL-ONLY',
  });
  await s.catalog.collectionAction(creator, c.id, 'publish', { price_cents: 6000 });
  assert((await s.media.read(image.id, null)).data.length > 0);
  const item = (await s.catalog.collection(c.id)).items[0];
  const detail = await s.catalog.item(item.id);
  assert(!JSON.stringify(detail).includes('INTERNAL-ONLY'));
  assert(!('owner_id' in detail));
});

test('organization invitations enforce owner, recipient, expiry and session revocation', async () => {
  await assert.rejects(
    s.organizations.invite(buyer, 'creator-org', seller.email, 'publisher'),
    rejection('FORBIDDEN'),
  );
  const invitation = await s.organizations.invite(creator, 'creator-org', buyer.email, 'publisher');
  await assert.rejects(s.organizations.accept(seller, invitation!.id), rejection('NOT_FOUND'));
  await s.organizations.accept(buyer, invitation!.id);
  await assert.rejects(
    s.organizations.accept(buyer, invitation!.id),
    rejection('INVITATION_UNAVAILABLE'),
  );
  assert.equal((await s.catalog.creator(buyer, 'creator-org')).collections.length, 4);
  const session = await s.auth.login(buyer.email, 'PixupDemo2026!');
  assert((await s.auth.session(session.token))!.organizations.some((o) => o.id === 'creator-org'));
  await s.organizations.revokeMember(creator, 'creator-org', buyer.id);
  assert.equal(await s.auth.session(session.token), null);
  await assert.rejects(s.catalog.creator(buyer, 'creator-org'), rejection('FORBIDDEN'));
  await assert.rejects(
    s.organizations.revokeMember(creator, 'creator-org', creator.id),
    rejection('OWNER_PROTECTED'),
  );
  const expired = await s.organizations.invite(creator, 'creator-org', seller.email, 'viewer');
  await db.query(
    "UPDATE organization_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired!.id],
  );
  await assert.rejects(
    s.organizations.accept(seller, expired!.id),
    rejection('INVITATION_UNAVAILABLE'),
  );
  const replacement = await s.organizations.invite(creator, 'creator-org', seller.email, 'viewer');
  await s.organizations.revokeInvitation(creator, 'creator-org', replacement!.id);
  await assert.rejects(
    s.organizations.accept(seller, replacement!.id),
    rejection('INVITATION_UNAVAILABLE'),
  );
});

test('viewer membership permits reading but never publication or invitations', async () => {
  const invitation = await s.organizations.invite(creator, 'creator-org', buyer.email, 'viewer');
  await s.organizations.accept(buyer, invitation!.id);
  assert.equal((await s.catalog.creator(buyer, 'creator-org')).collections.length, 4);
  await assert.rejects(
    s.catalog.createCollection(buyer, { org_id: 'creator-org' }),
    rejection('FORBIDDEN'),
  );
  await assert.rejects(
    s.organizations.invite(buyer, 'creator-org', seller.email, 'publisher'),
    rejection('FORBIDDEN'),
  );
  await assert.rejects(
    s.organizations.invite(creator, 'creator-org', seller.email, 'owner'),
    rejection('INVALID_ROLE'),
  );
});

test('warehouse permission cannot read finance or rights data or approve assessments', async () => {
  const warehouse: Actor = { ...ops, staff_permissions: ['warehouse'] };
  const dashboard = await s.operations.dashboard(warehouse);
  assert.deepEqual(dashboard.balances, []);
  assert.deepEqual(dashboard.collections, []);
  assert.deepEqual(dashboard.settlements, []);
  assert.deepEqual(dashboard.cases, []);
  assert.deepEqual(dashboard.audit, []);
  assert.equal(dashboard.integrity, null);
  await assert.rejects(s.operations.releaseSettlement(warehouse, 'any'), rejection('FORBIDDEN'));
  await assert.rejects(s.operations.reviewCollection(warehouse, 'any', {}), rejection('FORBIDDEN'));
  await assert.rejects(
    s.operations.intakeAction(warehouse, 'any', { action: 'accept' }),
    rejection('FORBIDDEN'),
  );
  await db.query("DELETE FROM staff_permissions WHERE user_id='ops' AND permission<>'warehouse'");
  const login = await s.auth.login(ops.email, 'PixupDemo2026!');
  assert.deepEqual(login.user!.staff_permissions, ['warehouse']);
  const order = await purchase();
  await assert.rejects(s.commerce.order(warehouse, order.id), rejection('NOT_FOUND'));
  await assert.rejects(s.commerce.refund(warehouse, order.id), rejection('NOT_FOUND'));
  await assert.rejects(
    s.commerce.refund({ ...ops, staff_permissions: ['support'] }, order.id),
    rejection('NOT_FOUND'),
  );
  const queue = await s.operations.dashboard(warehouse);
  assert(queue.orders.length > 0);
  assert.equal('seller_cents' in queue.orders[0], false);
  assert.equal('fee_cents' in queue.orders[0], false);
  await s.commerce.refund({ ...ops, staff_permissions: ['finance'] }, order.id);
});

async function receivedRePool() {
  const intake = await s.operations.intake(buyer, {
    asset_id: 'owned-01',
    kind: 'repool',
    evidence: 'Original physical demo specimen',
    accepted_terms: true,
  });
  await s.operations.intakeAction(ops, intake.id, {
    action: 'receive',
    note: 'Serial and physical condition received',
  });
  return intake.id;
}
const acceptInspection = (intakeId: string) =>
  s.operations.intakeAction(ops, intakeId, {
    action: 'accept',
    grade: '9',
    note: 'Independent assessment passed in demo',
  });

test('revised RePool terms require current consent and produce exactly one matching grant', async () => {
  const intakeId = await receivedRePool();
  await s.operations.reoffer(ops, intakeId, {
    expected_version: 1,
    credit_units: 725,
    note: 'Condition supports a revised demo offer',
  });
  await assert.rejects(acceptInspection(intakeId), rejection('OFFER_CONSENT_REQUIRED'));
  await assert.rejects(
    s.operations.decideOffer(buyer, intakeId, { expected_version: 1, accept: true }),
    rejection('VERSION_CONFLICT'),
  );
  await assert.rejects(
    s.operations.decideOffer(seller, intakeId, { expected_version: 2, accept: true }),
    rejection('NOT_FOUND'),
  );
  await assert.rejects(
    s.operations.reoffer(ops, intakeId, {
      expected_version: 1,
      credit_units: 800,
      note: 'Stale staff tab',
    }),
    rejection('VERSION_CONFLICT'),
  );
  await s.operations.decideOffer(buyer, intakeId, { expected_version: 2, accept: true });
  await s.operations.decideOffer(buyer, intakeId, { expected_version: 2, accept: true });
  const results = await Promise.allSettled([
    acceptInspection(intakeId),
    acceptInspection(intakeId),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await one(db, 'SELECT issued FROM credit_lots WHERE intake_id=$1', [intakeId]))!.issued,
    725,
  );
  const offer = await s.operations.offer(buyer, intakeId);
  assert.deepEqual(
    offer.versions.map((v) => v.credit_units),
    [500, 725],
  );
  assert.equal(
    (await one(db, "SELECT owner_id FROM assets WHERE id='owned-01'"))!.owner_id,
    'platform',
  );
  await assert.rejects(
    db.query('UPDATE repool_offer_versions SET credit_units=900 WHERE intake_id=$1', [intakeId]),
    /Append-only/,
  );
});

test('declined RePool offer preserves title, blocks listing and supports recorded return', async () => {
  const intakeId = await receivedRePool();
  await s.operations.reoffer(ops, intakeId, {
    expected_version: 1,
    credit_units: 300,
    note: 'Condition requires lower demo offer',
  });
  await s.operations.decideOffer(buyer, intakeId, { expected_version: 2, accept: false });
  await assert.rejects(acceptInspection(intakeId), rejection('OFFER_CONSENT_REQUIRED'));
  await assert.rejects(s.catalog.list(buyer, 'owned-01', 5000));
  assert.equal(
    (await one(db, "SELECT owner_id FROM assets WHERE id='owned-01'"))!.owner_id,
    'collector',
  );
  assert.equal(
    await one(db, 'SELECT id FROM credit_lots WHERE intake_id=$1', [intakeId]),
    undefined,
  );
  await s.operations.intakeAction({ ...ops, staff_permissions: ['warehouse'] }, intakeId, {
    action: 'return',
    note: 'Demo physical return to original owner',
  });
  const asset = await one(db, "SELECT custody,certification FROM assets WHERE id='owned-01'");
  assert.equal(asset!.custody, 'seller');
  assert.equal(asset!.certification, 'unverified');
  await assert.rejects(s.catalog.list(buyer, 'owned-01', 5000), rejection('INELIGIBLE'));
});

test('expired offer or revoked certificate cannot transfer RePool title or credits', async () => {
  const intakeId = await receivedRePool();
  await db.query("UPDATE intakes SET offer_expires_at=now()-interval '1 second' WHERE id=$1", [
    intakeId,
  ]);
  await assert.rejects(acceptInspection(intakeId), rejection('OFFER_EXPIRED'));
  await s.operations.reoffer(ops, intakeId, {
    expected_version: 1,
    credit_units: 500,
    note: 'Renewed provisional demo offer',
  });
  await s.operations.decideOffer(buyer, intakeId, { expected_version: 2, accept: true });
  await s.operations.revoke(ops, 'owned-01', 'Physical identity requires further review');
  await assert.rejects(acceptInspection(intakeId), rejection('CERTIFICATE_INELIGIBLE'));
  assert.equal(
    await one(db, 'SELECT id FROM credit_lots WHERE intake_id=$1', [intakeId]),
    undefined,
  );
});

test('additive migration preserves legacy offers and staff access and can be rerun', async () => {
  const legacy = await openDatabase();
  try {
    const { readFile } = await import('node:fs/promises');
    for (const file of ['001-initial.sql', '002-journal-invariants.sql', '003-media.sql'])
      await legacy.exec(
        await readFile(new URL(`../packages/database/${file}`, import.meta.url), 'utf8'),
      );
    await legacy.query(
      'CREATE TABLE migrations(version text PRIMARY KEY,applied_at timestamptz DEFAULT now())',
    );
    for (const version of ['001', '002', '003'])
      await legacy.query('INSERT INTO migrations(version) VALUES ($1)', [version]);
    await legacy.query(
      "INSERT INTO users(id,email,name,password_hash,is_staff) VALUES ('owner','owner@example.test','Owner','unused',false),('staff','staff@example.test','Staff','unused',true)",
    );
    await legacy.query(
      "INSERT INTO assets(id,owner_id,title,category,serial,artwork) VALUES ('legacy-asset','owner','Legacy item','Art','LEGACY-001','orbit')",
    );
    await legacy.query(
      "INSERT INTO intakes(id,asset_id,user_id,kind,status,offered_credits) VALUES ('legacy-intake','legacy-asset','owner','repool','received',500)",
    );
    await migrate(legacy);
    await migrate(legacy);
    const offer = await one(legacy, "SELECT * FROM intakes WHERE id='legacy-intake'");
    assert.equal(offer!.status, 'received');
    assert.equal(offer!.accepted_offer_version, 1);
    assert.equal(offer!.offered_credits, 500);
    assert.equal((await one(legacy, 'SELECT count(*)::int AS n FROM repool_offer_versions'))!.n, 1);
    assert.equal((await one(legacy, 'SELECT count(*)::int AS n FROM staff_permissions'))!.n, 6);
    assert.equal(
      (await one(legacy, "SELECT owner_id FROM assets WHERE id='legacy-asset'"))!.owner_id,
      'owner',
    );
  } finally {
    await legacy.close();
  }
});
