import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { openDatabase, migrate, one, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services, createApp } from '../apps/api/src/app';
import { type Actor } from '../apps/api/src/auth';
import { id, DomainError } from '../packages/domain/core';
import { staffPermissions } from '../packages/domain/contracts';
import {
  digest,
  S3Store,
  ClamScanner,
  type ObjectStore,
  type Scanner,
  evidenceConfiguration,
} from '../apps/api/src/evidence-providers';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  buyer = actor('collector'),
  seller = actor('seller');
const reject = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
class FakeStore implements ObjectStore {
  objects = new Map<string, Buffer>();
  lose = false;
  async put(k: string, b: Buffer) {
    const old = this.objects.get(k);
    if (old) assert.equal(digest(old), digest(b));
    this.objects.set(k, Buffer.from(b));
    if (this.lose) {
      this.lose = false;
      throw new Error('lost fixture response');
    }
  }
  async get(k: string) {
    const b = this.objects.get(k);
    assert(b);
    return b;
  }
  async delete(k: string) {
    this.objects.delete(k);
  }
}
let db: Database,
  s: Services,
  store: FakeStore,
  scan: { clean: boolean; fail: boolean },
  scanner: Scanner;
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  store = new FakeStore();
  scan = { clean: true, fail: false };
  scanner = {
    scan: async () => {
      if (scan.fail) throw new Error('fixture scanner offline');
      return { clean: scan.clean, engine: 'fixture scanner' };
    },
  };
  s = new Services(db, {}, {}, { store, scanner, managedArtwork: true, requireCapture: true });
});
afterEach(async () => {
  await db.close();
});
async function photo(color = 'red') {
  return sharp({ create: { width: 12, height: 12, channels: 3, background: color } })
    .png()
    .toBuffer();
}
async function file(
  asset = 'owned-01',
  purpose: 'intake' | 'shipment' | 'incident' = 'intake',
  owner = buyer,
  color = 'red',
) {
  const bytes = await photo(color),
    f = await s.evidence.reserve(owner, {
      client_key: id(),
      purpose,
      asset_id: asset,
      mime: 'image/png',
      size: bytes.length,
      hash: digest(bytes),
    });
  await s.evidence.upload(owner, f.id, bytes);
  await s.evidence.process(f.id);
  await s.evidence.review(ops, f.id, true, 'Reviewed synthetic evidence for this exact item');
  return f.id;
}
async function purchase() {
  const q = await s.commerce.quote(buyer, { listing_id: 'listing-court-01', fulfillment: 'ship' });
  const o = await s.commerce.checkout(
    buyer,
    { quote_id: q.id, shipping_address: '123 Fictional Lane, Demo City' },
    id(),
  );
  await s.commerce.pay(buyer, o.id, true);
  return o;
}
test('private object uploads recover lost writes, reject changed bytes, and fail closed on scanner outages or malware', async () => {
  const bytes = await photo(),
    input = {
      client_key: id(),
      purpose: 'intake' as const,
      asset_id: 'owned-01',
      mime: 'image/png' as const,
      size: bytes.length,
      hash: digest(bytes),
    };
  const f = await s.evidence.reserve(buyer, input);
  assert.equal((await s.evidence.reserve(buyer, input)).id, f.id);
  await assert.rejects(
    s.evidence.reserve(buyer, { ...input, hash: '0'.repeat(64) }),
    reject('UPLOAD_CONFLICT'),
  );
  await assert.rejects(
    s.evidence.upload(buyer, f.id, Buffer.from('different')),
    reject('UPLOAD_HASH'),
  );
  store.lose = true;
  await assert.rejects(s.evidence.upload(buyer, f.id, bytes));
  assert.equal(store.objects.size, 1);
  await s.evidence.upload(buyer, f.id, bytes);
  assert.equal(store.objects.size, 1);
  scan.fail = true;
  await s.evidence.process(f.id);
  assert.equal(
    (await one(db, 'SELECT state FROM stored_files WHERE id=$1', [f.id]))!.state,
    'scan_failed',
  );
  await assert.rejects(s.evidence.read(buyer, f.id), reject('FILE_QUARANTINED'));
  await assert.rejects(
    s.evidence.review(ops, f.id, true, 'Cannot bypass unavailable malware scanner'),
    reject('SCAN_REQUIRED'),
  );
  scan.fail = false;
  scan.clean = false;
  await s.evidence.process(f.id);
  assert.equal(
    (await one(db, 'SELECT state FROM stored_files WHERE id=$1', [f.id]))!.state,
    'blocked',
  );
  await assert.rejects(
    s.evidence.review(ops, f.id, true, 'Cannot approve malware blocked content'),
    reject('SCAN_REQUIRED'),
  );
  assert.equal((await one(db, 'SELECT data FROM stored_files WHERE id=$1', [f.id]))!.data, null);
  await assert.rejects(
    db.query('UPDATE stored_files SET hash=$2 WHERE id=$1', [f.id, '0'.repeat(64)]),
  );
});
test('managed artwork requires independent moderation and takedown prevents public serving', async () => {
  const bytes = await photo(),
    f = await s.media.upload(buyer, bytes);
  await s.evidence.process(f.id);
  await assert.rejects(s.media.read(f.id, buyer), reject('NOT_FOUND'));
  await assert.rejects(
    s.evidence.review(
      { ...buyer, is_staff: true, staff_permissions: ['rights'] },
      f.id,
      true,
      'An author cannot approve their own upload',
    ),
    reject('SELF_REVIEW'),
  );
  await s.evidence.review(ops, f.id, true, 'Approved synthetic artwork for display');
  const result = await s.media.read(f.id, buyer);
  assert.equal((await sharp(result.data).metadata()).format, 'webp');
  await db.query("UPDATE assets SET artwork=$1 WHERE id='court-01'", [`media:${f.id}`]);
  assert((await s.media.read(f.id, null)).data);
  await assert.rejects(s.evidence.read(seller, f.id), reject('NOT_FOUND'));
  await s.evidence.review(ops, f.id, false, 'Withdrawn after content review correction');
  await assert.rejects(s.media.read(f.id, null), reject('NOT_FOUND'));
});
test('documents remain private, current scope is checked, and stored bytes are integrity verified', async () => {
  const bytes = Buffer.from('%PDF-1.7\nSynthetic test document\n%%EOF');
  const f = await s.evidence.reserve(buyer, {
    client_key: id(),
    purpose: 'intake',
    asset_id: 'owned-01',
    mime: 'application/pdf',
    size: bytes.length,
    hash: digest(bytes),
  });
  await s.evidence.upload(buyer, f.id, bytes);
  await s.evidence.process(f.id);
  await s.evidence.review(ops, f.id, true, 'Synthetic document checked for correct scope');
  assert.equal((await s.evidence.read(buyer, f.id)).mime, 'application/pdf');
  await assert.rejects(s.evidence.read(seller, f.id), reject('NOT_FOUND'));
  store.objects.set(`pixup/${f.id}/original`, Buffer.from('tamper'));
  await assert.rejects(s.evidence.read(buyer, f.id), reject('FILE_INTEGRITY'));
  await db.query("UPDATE assets SET owner_id='seller' WHERE id='owned-01'");
  await assert.rejects(s.evidence.read(buyer, f.id), reject('NOT_FOUND'));
  await assert.rejects(s.evidence.read(seller, f.id), reject('NOT_FOUND'));
});
test('identity capture binds approved front/back photos, seal and serial and requires separate VIA assessor', async () => {
  const i = await s.operations.intake(buyer, {
    asset_id: 'owned-01',
    kind: 'repool',
    evidence: 'Synthetic physical intake record',
    accepted_terms: true,
  });
  await assert.rejects(
    s.operations.intakeAction(ops, i.id, {
      action: 'receive',
      note: 'Physical package receipt note',
    }),
    reject('CAPTURE_REQUIRED'),
  );
  const front = await file(),
    back = await file('owned-01', 'intake', buyer, 'blue'),
    a = (await one(db, "SELECT serial FROM assets WHERE id='owned-01'"))!;
  const input = {
    observed_serial: a.serial,
    seal: 'SEAL-0001',
    bin: 'BIN-A01',
    front_file: front,
    back_file: back,
    note: 'Compared both faces and recorded intact seal',
  };
  await assert.rejects(
    s.logistics.capture(ops, i.id, { ...input, observed_serial: 'WRONG-SERIAL' }),
    reject('IDENTITY_MISMATCH'),
  );
  const c = await s.logistics.capture(ops, i.id, input);
  assert.equal((await s.logistics.capture(ops, i.id, input)).id, c.id);
  await assert.rejects(
    db.query('UPDATE physical_captures SET bin=$2 WHERE id=$1', [c.id, 'OTHER']),
  );
  await s.operations.intakeAction(ops, i.id, {
    action: 'receive',
    note: 'Received matching sealed physical package',
  });
  await assert.rejects(
    s.operations.intakeAction(ops, i.id, {
      action: 'accept',
      grade: '9',
      note: 'Same capture operator cannot assess',
    }),
    reject('SELF_REVIEW'),
  );
  await s.operations.intakeAction(reviewer, i.id, {
    action: 'accept',
    grade: '9',
    note: 'Independent synthetic VIA assessment completed',
  });
  assert.equal((await one(db, "SELECT custody FROM assets WHERE id='owned-01'"))!.custody, 'vault');
  await assert.rejects(
    s.evidence.purge(ops, front, 'Cannot delete linked assessment capture'),
    reject('RETENTION_HOLD'),
  );
});
test('label creation preserves vault custody, dispatch is distinct from delivery, events replay once and exceptions hold finance', async () => {
  const o = await purchase(),
    evidence = await file('court-01', 'shipment');
  const sh = await s.logistics.createShipment(ops, o.id, {
    seal: 'PKG-123',
    evidence_id: evidence,
  });
  assert.equal((await one(db, 'SELECT status FROM orders WHERE id=$1', [o.id]))!.status, 'paid');
  assert.equal((await one(db, "SELECT custody FROM assets WHERE id='court-01'"))!.custody, 'vault');
  await assert.rejects(
    s.operations.fulfill(ops, o.id, 'old-bypass'),
    reject('TRACKED_SHIPMENT_REQUIRED'),
  );
  const event = {
    client_key: id(),
    expected_sequence: 0,
    kind: 'dispatched' as const,
    seal: 'PKG-123',
    evidence_id: evidence,
    note: 'Synthetic sealed handoff to carrier simulator',
  };
  await Promise.all([s.logistics.event(ops, sh.id, event), s.logistics.event(ops, sh.id, event)]);
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM shipment_events'))!.n, 1);
  await assert.rejects(
    s.logistics.event(ops, sh.id, { ...event, client_key: id(), kind: 'delivered' }),
    reject('SHIPMENT_VERSION'),
  );
  await assert.rejects(
    s.logistics.event(ops, sh.id, {
      ...event,
      client_key: id(),
      expected_sequence: 1,
      seal: 'WRONG-SEAL',
    }),
    reject('SEAL_MISMATCH'),
  );
  await s.logistics.event(ops, sh.id, {
    ...event,
    client_key: id(),
    expected_sequence: 1,
    kind: 'delivered',
  });
  assert.equal(
    (await one(db, 'SELECT status FROM orders WHERE id=$1', [o.id]))!.status,
    'fulfilled',
  );
  assert.equal((await s.logistics.order(buyer, o.id)).events.length, 2);
  await assert.rejects(s.logistics.order(seller, o.id), reject('NOT_FOUND'));
  await s.logistics.event(ops, sh.id, {
    ...event,
    client_key: id(),
    expected_sequence: 2,
    kind: 'damage',
  });
  const incident = (await one(db, 'SELECT * FROM physical_incidents'))!;
  await assert.rejects(s.commerce.refund(buyer, o.id), reject('PHYSICAL_HOLD'));
  const settlement = (await one(db, 'SELECT id FROM settlements WHERE order_id=$1', [o.id]))!;
  await assert.rejects(s.operations.releaseSettlement(ops, settlement.id), reject('PHYSICAL_HOLD'));
  await assert.rejects(
    s.logistics.resolve(ops, incident.id, 1, 'Cannot resolve a self-reported incident'),
    reject('SELF_REVIEW'),
  );
  await s.logistics.resolve(
    reviewer,
    incident.id,
    1,
    'Independent review requires return and reassessment',
  );
  assert.equal(
    (await one(db, "SELECT custody FROM assets WHERE id='court-01'"))!.custody,
    'quarantine',
  );
  await assert.rejects(s.commerce.refund(buyer, o.id), reject('RETURN_REQUIRED'));
  await assert.rejects(
    s.operations.releaseSettlement(ops, settlement.id),
    reject('DELIVERY_REQUIRED'),
  );
  await s.logistics.event(ops, sh.id, {
    ...event,
    client_key: id(),
    expected_sequence: 3,
    kind: 'returned',
  });
  assert.equal(
    (await one(db, 'SELECT state FROM shipments WHERE id=$1', [sh.id]))!.state,
    'returned',
  );
  assert.equal(
    (await one(
      db,
      "SELECT count(*)::int AS n FROM journal_entries WHERE reference LIKE 'refund:%'",
    ))!.n,
    0,
  );
});
test('retention holds and attached business evidence prevent purge; interrupted deletion resumes without erasing metadata', async () => {
  const fid = await file();
  // Simulate an expired policy at creation, rather than shortening retention (which the DB prohibits).
  await db.exec('ALTER TABLE stored_files DISABLE TRIGGER file_identity');
  await db.query("UPDATE stored_files SET retain_until=now()-interval '1 day' WHERE id=$1", [fid]);
  await db.exec('ALTER TABLE stored_files ENABLE TRIGGER file_identity');
  await s.evidence.hold(ops, fid, true, 'Preserve evidence for an open review');
  await assert.rejects(
    s.evidence.purge(ops, fid, 'Expired file has an explicit legal hold'),
    reject('RETENTION_HOLD'),
  );
  await s.evidence.hold(ops, fid, false, 'Independent policy review permits expiry');
  const original = store.delete.bind(store);
  let fail = true;
  store.delete = async (k) => {
    await original(k);
    if (fail) {
      fail = false;
      throw new Error('lost delete response');
    }
  };
  await assert.rejects(s.evidence.purge(ops, fid, 'Purge expired unreferenced test evidence'));
  assert.equal(
    (await one(db, 'SELECT state FROM stored_files WHERE id=$1', [fid]))!.state,
    'purging',
  );
  await s.evidence.purge(ops, fid, 'Retry original expired object deletion');
  assert.equal(
    (await one(db, 'SELECT state FROM stored_files WHERE id=$1', [fid]))!.state,
    'purged',
  );
  await assert.rejects(s.evidence.read(buyer, fid), reject('FILE_QUARANTINED'));
});
test('private evidence HTTP requires authentication and CSRF and downloads use attachment/no-store', async () => {
  const fid = await file(),
    server = createApp(s).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const port = (server.address() as any).port,
    base = `http://127.0.0.1:${port}/v1`;
  try {
    assert.equal((await fetch(`${base}/evidence/${fid}/download`)).status, 401);
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'collector@pixup.demo', password: 'PixupDemo2026!' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const denied = await fetch(`${base}/evidence/${fid}/bytes`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'image/png' },
      body: (await photo()) as any,
    });
    assert.equal(denied.status, 403);
    const download = await fetch(`${base}/evidence/${fid}/download`, { headers: { cookie } });
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition')!, /^attachment/);
    assert.match(download.headers.get('cache-control')!, /no-store/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
test('a delayed scan cannot resurrect purged evidence or leave a late artwork derivative', async () => {
  let release!: (value: { clean: boolean; engine: string }) => void, started!: () => void;
  const began = new Promise<void>((r) => {
    started = r;
  });
  scanner.scan = async () => {
    started();
    return new Promise((r) => {
      release = r;
    });
  };
  const bytes = await photo(),
    f = await s.evidence.reserve(buyer, {
      client_key: id(),
      purpose: 'artwork',
      mime: 'image/png',
      size: bytes.length,
      hash: digest(bytes),
    });
  await s.evidence.upload(buyer, f.id, bytes);
  const processing = s.evidence.process(f.id);
  await began;
  await db.exec('ALTER TABLE stored_files DISABLE TRIGGER file_identity');
  await db.query("UPDATE stored_files SET retain_until=now()-interval '1 day' WHERE id=$1", [f.id]);
  await db.exec('ALTER TABLE stored_files ENABLE TRIGGER file_identity');
  await s.evidence.purge(ops, f.id, 'Purge expired unreferenced artwork during delayed scan');
  release({ clean: true, engine: 'delayed fixture scanner' });
  await processing;
  assert.equal(
    (await one(db, 'SELECT state FROM stored_files WHERE id=$1', [f.id]))!.state,
    'purged',
  );
  assert.equal(store.objects.has(`pixup/${f.id}/preview`), false);
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM media WHERE file_id=$1', [f.id]))!.n,
    0,
  );
});
test('S3 adapter signs payloads, uses conditional writes and verifies replay conflicts', async () => {
  let saved = Buffer.alloc(0),
    writes = 0;
  const adapter = new S3Store(
    {
      endpoint: 'https://objects.example.invalid',
      bucket: 'private-evidence',
      region: 'us-east-1',
      accessKey: 'fixture-key',
      secretKey: 'fixture-secret',
    },
    (async (url: any, init: any) => {
      assert.match(String(url), /^https:\/\/objects\.example\.invalid\/private-evidence\/pixup\//);
      assert.match(init.headers.authorization, /AWS4-HMAC-SHA256 Credential=fixture-key/);
      assert.equal(init.redirect, 'error');
      if (init.method === 'PUT') {
        assert.equal(init.headers['if-none-match'], '*');
        assert.equal(init.headers['x-amz-content-sha256'], digest(init.body));
        writes++;
        if (writes === 1) {
          saved = init.body;
          return new Response(null, { status: 200 });
        }
        return new Response(null, { status: 412 });
      }
      return new Response(new Uint8Array(saved));
    }) as typeof fetch,
  );
  const key = `pixup/${id()}/original`,
    b = Buffer.from('synthetic object');
  await adapter.put(key, b);
  await adapter.put(key, b);
  await assert.rejects(adapter.put(key, Buffer.from('changed')), reject('STORAGE_CONFLICT'));
  assert.throws(() => evidenceConfiguration({ EVIDENCE_STORAGE: 's3' }), reject('STORAGE_CONFIG'));
});
test('ClamAV INSTREAM adapter frames bytes and fails closed for protocol errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pixup-clam-')),
    path = join(dir, 'clam.sock');
  let reply = 'stream: OK\0',
    received = Buffer.alloc(0);
  const server = createServer((socket) => {
    let all = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      all = Buffer.concat([all, Buffer.from(chunk)]);
      if (all.length < 10) return;
      assert.equal(all.subarray(0, 10).toString(), 'zINSTREAM\0');
      let offset = 10;
      const parts: Buffer[] = [];
      while (offset + 4 <= all.length) {
        const n = all.readUInt32BE(offset);
        offset += 4;
        if (!n) {
          received = Buffer.concat(parts);
          socket.end(reply);
          return;
        }
        if (offset + n > all.length) return;
        parts.push(all.subarray(offset, offset + n));
        offset += n;
      }
    });
  });
  await new Promise<void>((r) => server.listen(path, r));
  try {
    const c = new ClamScanner(path),
      bytes = Buffer.alloc(90000, 42);
    assert.equal((await c.scan(bytes)).clean, true);
    assert.deepEqual(received, bytes);
    reply = 'stream: Fixture FOUND\0';
    assert.equal((await c.scan(bytes)).clean, false);
    reply = 'stream: size limit exceeded ERROR\0';
    await assert.rejects(c.scan(bytes), reject('SCANNER_UNAVAILABLE'));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
