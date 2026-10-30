import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openDatabase, migrate } from '../../../packages/database/index';
import { seed } from '../../../packages/database/seed';
import { createApp, Services } from './app';
import { stripeConfiguration } from './stripe';
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
await migrate(db);
if (process.env.SEED_DEMO !== 'false') await seed(db);
const services = new Services(db, paymentOptions),
  app = createApp(services);
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await services.commerce.expire();
    await services.operations.worker();
    await services.payments.worker();
  } catch (error) {
    console.error('Worker failed; durable events will retry', error);
  } finally {
    running = false;
  }
}, 2000);
timer.unref();
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`PixUP demo API: http://127.0.0.1:${port}/v1 | OpenAPI: /v1/openapi.json`),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await new Promise<void>((r) => server.close(() => r()));
  while (running) await new Promise((r) => setTimeout(r, 50));
  await db.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
