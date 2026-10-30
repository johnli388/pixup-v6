import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import sharp from 'sharp';
import { openDatabase, migrate, one } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services, createApp } from '../apps/api/src/app';
import { privacyPolicy } from '../packages/domain/privacy';
import { id, notify } from '../packages/domain/core';
import { verifyIntegrity } from '../packages/operations/integrity';
import { backupDatabase, restoreDatabase } from './backup';
import type {
  StripeSession,
  StripeRefund,
  CheckoutProvider,
  SessionPayload,
} from '../apps/api/src/stripe';
import type { Actor } from '../apps/api/src/auth';
const source = process.env.PIXUP_VERIFY_DATABASE_URL,
  target = process.env.PIXUP_VERIFY_RESTORE_URL;
assert(
  source && target && source !== target,
  'Set distinct empty disposable PostgreSQL source and restore URLs. This script never loads .env.',
);
const duration = Number(process.env.PIXUP_LOAD_SECONDS || 20),
  rps = Number(process.env.PIXUP_LOAD_RPS || 20),
  concurrency = Number(process.env.PIXUP_LOAD_CONCURRENCY || 8);
assert(
  Number.isInteger(duration) &&
    duration >= 5 &&
    duration <= 300 &&
    Number.isInteger(rps) &&
    rps >= 1 &&
    rps <= 100 &&
    Number.isInteger(concurrency) &&
    concurrency >= 1 &&
    concurrency <= 100,
  'Invalid bounded load configuration.',
);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
class SlowProvider implements CheckoutProvider {
  sessions = new Map<string, StripeSession>();
  async create(p: SessionPayload, key: string) {
    await pause(200);
    const value: StripeSession = {
      id: `cs_test_${key.replaceAll(':', '_')}`,
      livemode: false,
      status: 'open',
      payment_status: 'unpaid',
      amount_total: Number(p['line_items[0][price_data][unit_amount]']),
      currency: 'usd',
      client_reference_id: p.client_reference_id,
      metadata: { order_id: p.client_reference_id },
      url: 'https://checkout.stripe.com/c/pay/test',
      payment_intent: null,
    };
    this.sessions.set(value.id, value);
    return structuredClone(value);
  }
  async retrieve(sid: string) {
    await pause(200);
    return structuredClone(this.sessions.get(sid)!);
  }
  async expire(sid: string) {
    this.sessions.get(sid)!.status = 'expired';
    return this.retrieve(sid);
  }
  async refund(): Promise<StripeRefund> {
    throw new Error('No external refunds in load fixture');
  }
  async retrieveRefund(): Promise<StripeRefund> {
    throw new Error('No external refunds in load fixture');
  }
}
const db = await openDatabase(source),
  restored = await openDatabase(target),
  directory = await mkdtemp(join(tmpdir(), 'pixup-readiness-'));
const loop = monitorEventLoopDelay({ resolution: 20 });
let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let worker = false;
let waitingMax = 0;
try {
  for (const connection of [db, restored])
    assert.equal(
      (await one(
        connection,
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
      ))!.n,
      0,
      'Refusing a nonempty database.',
    );
  await migrate(db);
  await seed(db);
  const provider = new SlowProvider(),
    s = new Services(db, { provider });
  await s.monitoring.heartbeat(true);
  await s.monitoring.evaluate();
  const clients: { actor: Actor; headers: Record<string, string> }[] = [];
  for (let n = 0; n < 10; n++) {
    const login = await s.auth.register(
      `Load participant ${n}`,
      `load-${n}@example.test`,
      'Disposable-fixture-2026!',
    );
    const actor = login.user!;
    const p = privacyPolicy();
    await s.privacy.consent(actor, {
      adult: true,
      terms_version: p.terms_version,
      privacy_version: p.privacy_version,
      marketing_opt_in: false,
    });
    clients.push({
      actor,
      headers: {
        'Content-Type': 'application/json',
        cookie: `pixup_session=${login.token}`,
        'X-CSRF-Token': actor.csrf,
      },
    });
  }
  const image = await sharp({
    create: { width: 20, height: 24, channels: 3, background: '#72915f' },
  })
    .png()
    .toBuffer();
  await s.media.upload(clients[0].actor, image);
  server = createApp(s).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1`;
  timer = setInterval(async () => {
    if (worker) return;
    worker = true;
    try {
      await s.operations.worker();
      await s.monitoring.heartbeat(true);
      await s.monitoring.flush();
      const locks = await one(
        db,
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
      );
      waitingMax = Math.max(waitingMax, locks!.n);
    } finally {
      worker = false;
    }
  }, 500);
  const samples: number[] = [],
    unexpected: number[] = [];
  let rejectedArrivals = 0;
  const jobs = new Set<Promise<void>>();
  let requests = 0;
  const start = performance.now();
  loop.enable();
  while (performance.now() - start < duration * 1000) {
    if (jobs.size < concurrency) {
      const index = requests++,
        client = clients[index % clients.length];
      const task = (async () => {
        const started = performance.now();
        const path = ['/catalog', '/assets/court-01', '/credits', '/orders', '/quotes'][index % 5];
        const response = await fetch(base + path, {
          method: path === '/quotes' ? 'POST' : 'GET',
          headers: client.headers,
          ...(path === '/quotes'
            ? { body: JSON.stringify({ listing_id: 'listing-orbit-01', fulfillment: 'vault' }) }
            : {}),
        });
        await response.arrayBuffer();
        samples.push(performance.now() - started);
        if (response.status !== 200) unexpected.push(response.status);
      })();
      jobs.add(task);
      void task.finally(() => jobs.delete(task));
    } else rejectedArrivals++;
    await pause(1000 / rps);
  }
  await Promise.all(jobs);
  const quotes = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      s.commerce.quote(clients[i % 10].actor, {
        listing_id: 'listing-court-01',
        fulfillment: 'vault',
      }),
    ),
  );
  const burstStarted = performance.now();
  const burst = await Promise.all(
    quotes.map(async (q, i) => {
      const started = performance.now();
      const response = await fetch(base + '/checkouts', {
        method: 'POST',
        headers: { ...clients[i % 10].headers, 'Idempotency-Key': id() },
        body: JSON.stringify({ quote_id: q.id, shipping_address: '' }),
      });
      return {
        status: response.status,
        body: await response.json(),
        latency_ms: performance.now() - started,
        client: clients[i % 10],
      };
    }),
  );
  const burstMs = Math.round(performance.now() - burstStarted);
  const winners = burst.filter((r) => r.status === 200);
  assert.equal(winners.length, 1, 'Exactly one scarce-stock reservation must win');
  assert(
    burst.filter((r) => r.status !== 200).every((r) => r.status === 409),
    'Losers must be stock conflicts, not server/rate errors',
  );
  const winner = winners[0];
  await s.payments.start(winner.client.actor, winner.body.id);
  const attempt = await one(
    db,
    'SELECT provider_session_id FROM payment_attempts WHERE order_id=$1',
    [winner.body.id],
  );
  const session = provider.sessions.get(attempt!.provider_session_id)!;
  session.status = 'complete';
  session.payment_status = 'paid';
  session.payment_intent = 'pi_readiness_fixture';
  session.url = null;
  await Promise.all(
    Array.from({ length: 10 }, () => s.payments.status(winner.client.actor, winner.body.id)),
  );
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM journal_entries WHERE reference=$1', [
      `payment:${winner.body.id}`,
    ]))!.n,
    1,
  );
  clearInterval(timer);
  while (worker) await pause(20);
  loop.disable();
  await s.monitoring.flush();
  await s.monitoring.evaluate();
  const integrity = await verifyIntegrity(db);
  const sorted = samples.sort((a, b) => a - b),
    percentile = (values: number[], p: number) =>
      Math.round(
        [...values].sort((a, b) => a - b)[
          Math.min(values.length - 1, Math.floor(values.length * p))
        ],
      );
  const load = {
    duration_seconds: duration,
    target_rps: rps,
    concurrency,
    requests,
    unexpected_statuses: unexpected,
    rejected_arrivals: rejectedArrivals,
    p50_ms: percentile(sorted, 0.5),
    p95_ms: percentile(sorted, 0.95),
    p99_ms: percentile(sorted, 0.99),
    scarce_requests: 100,
    scarce_winners: winners.length,
    scarce_conflicts: 99,
    scarce_burst_ms: burstMs,
    scarce_p99_ms: percentile(
      burst.map((r) => r.latency_ms),
      0.99,
    ),
    simulated_provider_latency_ms: 200,
    max_sampled_lock_waiters: waitingMax,
    event_loop_p99_ms: Math.round(loop.percentile(99) / 1e6),
    integrity,
  };
  assert.equal(unexpected.length, 0);
  assert.equal(rejectedArrivals, 0);
  assert(
    load.p95_ms < Number(process.env.PIXUP_LOAD_P95_MS || 750),
    'Mixed workload p95 exceeded configured budget',
  );
  assert(load.scarce_p99_ms < 5000, 'Scarce-stock p99 exceeded five seconds');
  // Inject a durable backlog to prove alert detection and post-restore event replay.
  const outbox = id();
  await db.transaction((tx) =>
    notify(tx, clients[0].actor.id, 'Restore drill', 'Synthetic queued notification', outbox),
  );
  await db.query("UPDATE outbox SET created_at=now()-interval '10 minutes' WHERE aggregate_id=$1", [
    outbox,
  ]);
  await s.monitoring.evaluate();
  assert.equal(
    (await one(db, "SELECT status FROM operational_alerts WHERE code='outbox_backlog'"))!.status,
    'active',
  );
  await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
  const oldKey = process.env.PIXUP_BACKUP_KEY;
  process.env.PIXUP_BACKUP_KEY = randomBytes(32).toString('base64');
  const backupPath = join(directory, 'drill.pxb');
  const backup = await backupDatabase(source, backupPath);
  const goodKey = process.env.PIXUP_BACKUP_KEY;
  process.env.PIXUP_BACKUP_KEY = randomBytes(32).toString('base64');
  await assert.rejects(restoreDatabase(target, backupPath));
  assert.equal(
    (await one(
      restored,
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
    ))!.n,
    0,
    'Wrong key must not alter restore target',
  );
  process.env.PIXUP_BACKUP_KEY = goodKey;
  const recovery = await restoreDatabase(target, backupPath);
  assert(
    recovery.restore_ms < 60000,
    'Local synthetic restore exceeded the 60-second exercise budget',
  );
  await assert.rejects(restoreDatabase(target, backupPath), /empty disposable/);
  const recovered = new Services(restored, { provider });
  await recovered.operations.worker();
  await recovered.operations.worker();
  assert.equal(
    (await one(restored, "SELECT count(*)::int AS n FROM activity WHERE title='Restore drill'"))!.n,
    1,
  );
  await recovered.monitoring.heartbeat(true);
  await recovered.monitoring.evaluate();
  assert.equal(
    (await one(restored, "SELECT status FROM operational_alerts WHERE code='outbox_backlog'"))!
      .status,
    'resolved',
  );
  if (oldKey === undefined) delete process.env.PIXUP_BACKUP_KEY;
  else process.env.PIXUP_BACKUP_KEY = oldKey;
  const report = {
    passed: true,
    checked_at: new Date().toISOString(),
    environment:
      'Disposable local PostgreSQL; synthetic users, fake delayed provider; no production approval',
    load,
    backup: { ...backup, key_retained: false },
    recovery,
    post_restore_notification_count: 1,
  };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, report_path: join(directory, 'report.json') }, null, 2));
} finally {
  clearInterval(timer);
  while (worker) await pause(20);
  loop.disable();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  await db.close();
  await restored.close();
}
