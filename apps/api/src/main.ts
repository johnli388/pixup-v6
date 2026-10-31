import { communityWorker } from './community';
import { assistantConfiguration } from './assistant-provider';
import { identityConfiguration } from './identity-providers';
import { assertRuntimeRole } from '../../../packages/database/context';
import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openDatabase, migrate } from '../../../packages/database/index';
import { seed } from '../../../packages/database/seed';
import { createApp, Services } from './app';
import { stripeConfiguration } from './stripe';
import { billingConfiguration } from './billing-provider';
import { evidenceConfiguration } from './evidence-providers';
if (
  (process.env.APP_MODE || 'demo') !== 'demo' ||
  (process.env.NODE_ENV === 'production' && process.env.APP_MODE !== 'demo')
)
  throw new Error(
    'Only explicit demo mode is supported. See docs/implementation-status.md before production deployment.',
  );
const paymentOptions = stripeConfiguration();
const dir = resolve(process.env.DATA_DIR || '.data/pixup');
await mkdir(resolve(dir, '..'), { recursive: true });
const db = await openDatabase(process.env.DATABASE_URL, dir);
const hardened = process.env.DATABASE_HARDENED === 'true';
if (hardened) {
  if (
    !process.env.DATABASE_URL ||
    !process.env.DATABASE_WORKER_URL ||
    process.env.SEED_DEMO !== 'false'
  )
    throw new Error(
      'Hardened database mode requires separate API/worker URLs, pre-applied migrations and SEED_DEMO=false.',
    );
  await assertRuntimeRole(db, false);
  const v = await db.query("SELECT version FROM migrations WHERE version='016'");
  if (!v.rows.length)
    throw new Error('Apply migration 016 with the migration role before starting.');
} else await migrate(db);
if (process.env.SEED_DEMO !== 'false') await seed(db);
const identityOptions = identityConfiguration();
const services = new Services(
    db,
    paymentOptions,
    billingConfiguration(),
    evidenceConfiguration(),
    identityOptions,
    assistantConfiguration(),
  ),
  app = createApp(services);
const workerDb = hardened ? await openDatabase(process.env.DATABASE_WORKER_URL) : db;
if (hardened) await assertRuntimeRole(workerDb, true);
const workers = hardened
  ? new Services(
      workerDb,
      paymentOptions,
      billingConfiguration(),
      evidenceConfiguration(),
      identityOptions,
    )
  : services;
let running = false,
  lastMonitor = 0;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    let healthy = true;
    for (const [name, task] of [
      ['reservations', () => workers.commerce.expire()],
      ['notifications', () => workers.operations.worker()],
      ['community', () => communityWorker(workers.db)],
      ['payments', () => workers.payments.worker()],
      ['channels', () => workers.channels.worker()],
      ['billing', () => workers.billing.worker()],
    ] as const) {
      try {
        await task();
      } catch {
        healthy = false;
        console.error(JSON.stringify({ event: 'worker_task_failed', task: name, retryable: true }));
      }
    }
    await services.monitoring.heartbeat(healthy);
    await services.monitoring.flush();
    if (Date.now() - lastMonitor > 15000) {
      await services.monitoring.evaluate();
      lastMonitor = Date.now();
    }
  } catch {
    console.error(JSON.stringify({ event: 'worker_or_monitoring_unavailable', retryable: true }));
  } finally {
    running = false;
  }
}, 2000);
timer.unref();
// Scanner/object-store latency must not stall reservation expiry or payment recovery.
let evidenceRunning = false;
const evidenceTimer = setInterval(async () => {
  if (evidenceRunning) return;
  evidenceRunning = true;
  try {
    await workers.evidence.worker();
  } catch {
    console.error(
      JSON.stringify({ event: 'worker_task_failed', task: 'evidence', retryable: true }),
    );
  } finally {
    evidenceRunning = false;
  }
}, 5000);
evidenceTimer.unref();
let paymentControlRunning = false;
const paymentControlTimer = setInterval(async () => {
  if (paymentControlRunning) return;
  paymentControlRunning = true;
  try {
    await workers.paymentControls.worker();
    await workers.connect.worker();
  } catch {
    console.error(
      JSON.stringify({ event: 'worker_task_failed', task: 'payment_controls', retryable: true }),
    );
  } finally {
    paymentControlRunning = false;
  }
}, 5000);
paymentControlTimer.unref();
// Identity delivery must continue independently of payment/scanner provider outages.
let identityRunning = false;
const identityTimer = setInterval(async () => {
  if (identityRunning) return;
  identityRunning = true;
  try {
    await workers.identity.worker();
  } catch {
    console.error(
      JSON.stringify({ event: 'worker_task_failed', task: 'identity', retryable: true }),
    );
  } finally {
    identityRunning = false;
  }
}, 5000);
identityTimer.unref();

const port = Number(process.env.PORT || 4000);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`PixUP demo API: http://127.0.0.1:${port}/v1 | OpenAPI: /v1/openapi.json`),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  clearInterval(evidenceTimer);
  clearInterval(paymentControlTimer);
  clearInterval(identityTimer);
  await new Promise<void>((r) => server.close(() => r()));
  while (running || evidenceRunning || paymentControlRunning || identityRunning)
    await new Promise((r) => setTimeout(r, 50));
  await services.monitoring
    .flush()
    .catch(() => console.error(JSON.stringify({ event: 'telemetry_flush_failed' })));
  if (workerDb !== db) await workerDb.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
