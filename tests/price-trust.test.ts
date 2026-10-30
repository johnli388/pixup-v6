import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openDatabase, migrate, one, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services, createApp } from '../apps/api/src/app';
import { TrustService } from '../apps/api/src/trust';
import { DomainError, id, provenance } from '../packages/domain/core';
import { signingBytes, verifyProof, type TrustKey } from '../packages/domain/trust';
import { summarizePrices } from '../packages/domain/price-methodology';
import { staffPermissions } from '../packages/domain/contracts';
import type { Actor } from '../apps/api/src/auth';
let db: Database, s: Services, dir: string, trust: TrustService, keys: TrustKey[];
const pair = generateKeyPairSync('ed25519'),
  witness = generateKeyPairSync('ed25519');
const actor = (uid: string, staff = false): Actor => ({
  id: uid,
  name: uid,
  email: `${uid}@pixup.demo`,
  csrf: 'fixture',
  is_staff: staff,
  organizations: [],
  staff_permissions: staff ? [...staffPermissions] : [],
});
const ops = actor('ops', true),
  reviewer = actor('creator', true),
  buyer = actor('collector');
const error = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  s = new Services(db);
  dir = await mkdtemp(join(tmpdir(), 'pixup-trust-test-'));
  keys = (
    [
      {
        id: 'assessment-1',
        purpose: 'certificate',
        public_key: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
      {
        id: 'witness-1',
        purpose: 'checkpoint',
        public_key: witness.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
    ] as const
  ).map((k) => ({
    ...k,
    not_before: '2020-01-01T00:00:00.000Z',
    not_after: '2100-01-01T00:00:00.000Z',
    revoked: false,
  }));
  await writeFile(join(dir, 'public.json'), JSON.stringify({ keys }));
  trust = new TrustService(db, join(dir, 'public.json'));
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
async function cohort() {
  const a = (await one(db, "SELECT grade FROM assets WHERE id='orbit-01'"))!;
  return s.pricing.cohort(ops, {
    label: 'Orbit equivalent edition',
    definition: 'Same Orbit variant, edition and grade; synthetic calibration specimen.',
    grade: a.grade,
    asset_ids: ['orbit-01'],
  });
}
async function external(cid: string, amount = 10000, reference = id()) {
  return s.pricing.observe(ops, {
    cohort_id: cid,
    source: 'permitted-fixture-source',
    source_reference: reference,
    permission_evidence: 'Synthetic test source permission only',
    evidence: 'Synthetic completed comparable sale; no real sale claimed',
    amount_cents: amount,
    occurred_at: new Date(Date.now() - 1000).toISOString(),
    final_sale: true,
    related_party: false,
  });
}
test('curated price observations require independent review, deduplicate, retain corrections and never mix lanes', async () => {
  const c = await cohort();
  await assert.rejects(s.pricing.dashboard(buyer), error('FORBIDDEN'));
  const ids = [];
  for (const amount of [9000, 9500, 10000, 10500, 1000000]) {
    const o = await external(c.id, amount);
    ids.push(o.id);
    await s.pricing.review(reviewer, o.id, 'include', 'Independent synthetic evidence review');
  }
  await assert.rejects(
    s.pricing.review(ops, ids[0], 'include', 'Self review is not permitted'),
    error('SELF_REVIEW'),
  );
  const raw = (await one(db, 'SELECT source_reference FROM price_observations WHERE id=$1', [
    ids[0],
  ]))!;
  await assert.rejects(external(c.id, 10000, raw.source_reference), error('DUPLICATE_OBSERVATION'));
  const snapshot = await s.pricing.snapshot(ops, c.id, 'external');
  assert.equal(snapshot.median_cents, 10000);
  assert.equal(snapshot.sample_count, 5);
  let ref = await s.pricing.reference('orbit-01');
  assert.equal(ref.lanes.find((l) => l.lane === 'external')!.state, 'available');
  assert.equal(ref.lanes.find((l) => l.lane === 'simulation')!.state, 'not_published');
  const publicText = JSON.stringify(ref);
  assert(!publicText.includes('source_reference'));
  assert(!publicText.includes(ids[0]));
  await s.pricing.review(reviewer, ids[0], 'exclude', 'Source reported a completed refund');
  ref = await s.pricing.reference('orbit-01');
  assert.equal(ref.lanes.find((l) => l.lane === 'external')!.state, 'superseded_inputs');
  assert.equal((await s.pricing.snapshot(ops, c.id, 'external')).state, 'insufficient_data');
  assert.equal(
    (await one(db, 'SELECT result FROM price_snapshots WHERE id=$1', [snapshot.id]))!.result
      .median_cents,
    10000,
  );
  await assert.rejects(db.query('DELETE FROM price_observations WHERE id=$1', [ids[0]]));
  await assert.rejects(db.query('DELETE FROM price_snapshots WHERE id=$1', [snapshot.id]));
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM orders'))!.n, 0);
});
test('simulation capture is idempotent and reversals, credits and affiliation cannot masquerade as prices', async () => {
  const c = await cohort();
  const q = await s.commerce.quote(buyer, { listing_id: 'listing-orbit-01', fulfillment: 'vault' });
  const order = await s.commerce.checkout(buyer, { quote_id: q.id, shipping_address: '' }, id());
  await s.commerce.pay(buyer, order.id, true);
  const first = await s.pricing.snapshot(ops, c.id, 'simulation');
  assert.equal(first.sample_count, 1);
  await s.pricing.snapshot(ops, c.id, 'simulation');
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM price_observations'))!.n, 1);
  await s.commerce.refund(buyer, order.id);
  const next = await s.pricing.snapshot(ops, c.id, 'simulation');
  assert.equal(next.sample_count, 0);
  assert.equal(next.exclusions.refund, 1);
  assert.equal(
    (await s.pricing.reference('orbit-01')).lanes.find((l) => l.lane === 'external')!.state,
    'not_published',
  );
  const grade = (await one(db, "SELECT grade FROM assets WHERE id='court-01'"))!.grade;
  const other = await s.pricing.cohort(ops, {
    label: 'Court credit exclusion',
    definition: 'Same Court variant and exact grade; synthetic credit exclusion fixture.',
    grade,
    asset_ids: ['court-01'],
  });
  const cq = await s.commerce.quote(buyer, {
    listing_id: 'listing-court-01',
    fulfillment: 'vault',
    use_credits: true,
  });
  const co = await s.commerce.checkout(buyer, { quote_id: cq.id, shipping_address: '' }, id());
  await s.commerce.pay(buyer, co.id, true);
  assert.equal(
    (await s.pricing.snapshot(ops, other.id, 'simulation')).exclusions.credit_consideration,
    1,
  );
  await db.query(
    "INSERT INTO memberships(user_id,org_id,role) VALUES ('collector','platform-org','viewer')",
  );
  assert.equal((await s.pricing.snapshot(ops, other.id, 'simulation')).exclusions.related_party, 1);
});
test('price rules withhold sparse, stale, dispersed, future and excluded samples with deterministic robust summaries', () => {
  const now = new Date().toISOString();
  const inputs = (values: number[], days = 0) =>
    values.map((amount_cents, i) => ({
      id: String(i),
      amount_cents,
      occurred_at: new Date(Date.parse(now) - days * 86400000).toISOString(),
      reason: null,
    }));
  assert.equal(summarizePrices(inputs([100, 100, 100, 100, 100000]), now).result.median_cents, 100);
  assert.equal(
    summarizePrices(inputs([100, 100, 100, 100]), now).result.state,
    'insufficient_data',
  );
  assert.equal(summarizePrices(inputs([100, 100, 100, 100, 100], 31), now).result.state, 'stale');
  assert.equal(summarizePrices(inputs([1, 2, 3, 100, 10000]), now).result.state, 'dispersed');
  assert.equal(
    summarizePrices(inputs([100, 100, 100, 100, 100], 91), now).result.exclusions.out_of_window,
    5,
  );
  assert.equal(summarizePrices(inputs([100], -1), now).result.exclusions.future, 1);
});
test('creator attribution remains scoped, separates excluded circulation and never manufactures agency payables', async () => {
  await assert.rejects(s.catalog.creator(buyer, 'creator-org'), error('FORBIDDEN'));
  const { attributeSales } = await import('../packages/domain/attribution');
  const report = attributeSales([
    {
      collection_id: 'agency',
      collection_title: 'Agency fixture',
      issuance_mode: 'agency',
      status: 'paid',
      related_party: false,
      refund: false,
    },
    {
      collection_id: 'agency',
      collection_title: 'Agency fixture',
      issuance_mode: 'agency',
      status: 'refunded',
      related_party: false,
      refund: true,
    },
  ]);
  assert.equal(report.collections[0].qualifying, 1);
  assert.equal(report.collections[0].excluded, 1);
  assert.equal(report.collections[0].payment_state, 'agency_excluded');
  assert.equal(report.collections[0].payable_cents, null);
  assert.equal(report.methodology.payments_enabled, false);
  assert.equal(
    (await s.catalog.creator(reviewer, 'creator-org')).attribution.methodology.version,
    'ifci-observations-pilot-v1',
  );
});
test('certificate signing enforces reviewer separation, trusted purpose, replay integrity and revocation without changing assessment validity', async () => {
  const cid = 'VIA-000001';
  await assert.rejects(trust.request(ops, 'certificate', cid), error('SELF_SIGNING'));
  const request = await trust.request(reviewer, 'certificate', cid);
  const signature = sign(null, signingBytes(request.payload), pair.privateKey).toString('base64');
  await assert.rejects(
    trust.accept(reviewer, request.request_id, 'witness-1', signature),
    error('SIGNATURE_INVALID'),
  );
  await assert.rejects(
    trust.accept(ops, request.request_id, 'assessment-1', signature),
    error('SELF_SIGNING'),
  );
  const accepted = await trust.accept(reviewer, request.request_id, 'assessment-1', signature);
  assert.deepEqual(
    await trust.accept(reviewer, request.request_id, 'assessment-1', signature),
    accepted,
  );
  const verified = await trust.verification(cid);
  assert.equal(verified.signed, true);
  assert(!JSON.stringify(verified).includes('Demo assessment only'));
  keys[0].revoked = true;
  await writeFile(join(dir, 'public.json'), JSON.stringify({ keys }));
  assert.equal((await trust.verification(cid)).signed, false);
  assert.equal((await s.catalog.verify(cid)).valid, true);
  await assert.rejects(db.query('DELETE FROM trust_signatures'));
});
test('offline signing artifact verifies end to end and rejects changed payloads and inactive certificates', async () => {
  const request = await trust.request(reviewer, 'certificate', 'VIA-000001');
  const path = join(dir, 'request.json'),
    out = join(dir, 'signature.json'),
    keyFile = join(dir, 'private.pem');
  await writeFile(path, JSON.stringify(request));
  await writeFile(keyFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
  });
  await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'scripts/trust-sign.ts', path, out],
    {
      env: {
        ...process.env,
        PIXUP_SIGNING_KEY_FILE: keyFile,
        PIXUP_SIGNING_KEY_ID: 'assessment-1',
      },
    },
  );
  const artifact = JSON.parse(await readFile(out, 'utf8'));
  await trust.accept(reviewer, artifact.request_id, artifact.key_id, artifact.signature);
  const second = await trust.request(reviewer, 'certificate', 'VIA-000002');
  const bad = sign(
    null,
    signingBytes({ ...second.payload, grade: 'fabricated' }),
    pair.privateKey,
  ).toString('base64');
  await assert.rejects(
    trust.accept(reviewer, second.request_id, 'assessment-1', bad),
    error('SIGNATURE_INVALID'),
  );
  await db.query("UPDATE certificates SET status='revoked' WHERE id='VIA-000002'");
  await assert.rejects(
    trust.accept(
      reviewer,
      second.request_id,
      'assessment-1',
      sign(null, signingBytes(second.payload), pair.privateKey).toString('base64'),
    ),
    error('CERTIFICATE_INACTIVE'),
  );
});
test('independent checkpoints chain roots, reject competing advancement and expose only one specimen proof', async () => {
  const r = await trust.request(ops, 'checkpoint', ''),
    competing = await trust.request(ops, 'checkpoint', '');
  const signature = sign(null, signingBytes(r.payload), witness.privateKey).toString('base64');
  const requestFile = join(dir, 'checkpoint.json'),
    keyFile = join(dir, 'witness.pem');
  await writeFile(requestFile, JSON.stringify(r));
  await writeFile(keyFile, witness.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
  });
  const env = {
    ...process.env,
    PIXUP_SIGNING_KEY_FILE: keyFile,
    PIXUP_SIGNING_KEY_ID: 'witness-1',
    PIXUP_CHECKPOINT_ARCHIVE_DIR: dir,
  };
  await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'scripts/trust-sign.ts', requestFile, join(dir, 'signed-checkpoint.json')],
    { env },
  );
  await writeFile(requestFile, JSON.stringify(competing));
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'scripts/trust-sign.ts', requestFile, join(dir, 'fork.json')],
      { env },
    ),
    /checkpoint fork/,
  );
  await trust.accept(ops, r.request_id, 'witness-1', signature);
  await assert.rejects(
    trust.accept(
      ops,
      competing.request_id,
      'witness-1',
      sign(null, signingBytes(competing.payload), witness.privateKey).toString('base64'),
    ),
    error('CHECKPOINT_CONFLICT'),
  );
  const v = await trust.verification('VIA-000001');
  const cp = v.checkpoint as any;
  assert(cp);
  assert(verifyProof(cp.head, cp.proof, cp.payload.root));
  assert(!verifyProof({ ...cp.head, sequence: 999 }, cp.proof, cp.payload.root));
  assert.equal(cp.current_head, true);
  assert(!JSON.stringify(v).includes('entries'));
  await db.transaction((tx) =>
    provenance(tx, cp.head.asset_id, 'ops', 'test_update', 'New history after checkpoint.'),
  );
  assert.equal((await trust.verification('VIA-000001')).checkpoint!.current_head, false);
  const next = await trust.request(ops, 'checkpoint', '');
  assert.equal((next.payload as any).sequence, 2);
  assert.notEqual((next.payload as any).previous_digest, 'genesis');
  keys[1].revoked = true;
  await writeFile(join(dir, 'public.json'), JSON.stringify({ keys }));
  assert.equal((await trust.verification('VIA-000001')).checkpoint, null);
});
test('HTTP price/trust routes enforce finance/audit permission, CSRF and strict artifacts', async () => {
  const server = createApp(s).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1`;
  try {
    assert.equal((await fetch(base + '/ops/pricing')).status, 401);
    const session = await s.auth.login('collector@pixup.demo', 'PixupDemo2026!');
    assert.equal(
      (await fetch(base + '/ops/trust', { headers: { cookie: `pixup_session=${session.token}` } }))
        .status,
      403,
    );
    const staff = await s.auth.login('ops@pixup.demo', 'PixupDemo2026!');
    const post = (body: unknown, csrf = false) =>
      fetch(base + '/ops/trust/signatures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `pixup_session=${staff.token}`,
          ...(csrf ? { 'X-CSRF-Token': staff.user!.csrf } : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal((await post({})).status, 403);
    assert.equal((await post({ private_key: 'Never accepted' }, true)).status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
