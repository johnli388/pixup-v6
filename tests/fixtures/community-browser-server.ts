// Browser-only provisioning in a freshly created temporary database. No production seed grants.
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { openDatabase, migrate } from '../../packages/database/index';
import { seed } from '../../packages/database/seed';
import { Services } from '../../apps/api/src/app';
assert(process.env.DATA_DIR && basename(process.env.DATA_DIR).startsWith('pixup-e2e-'));
assert(process.env.DATABASE_URL === '' && process.env.APP_MODE === 'demo');
const db = await openDatabase(undefined, process.env.DATA_DIR);
try {
  await migrate(db);
  await seed(db);
  const s = new Services(db);
  for (const name of ['moderator', 'reviewer']) {
    const account = await s.auth.register(
      `Community ${name}`,
      `community-${name}@example.test`,
      'Community-browser-2026!',
    );
    await db.query('UPDATE users SET is_staff=true WHERE id=$1', [account.user!.id]);
    await db.query(
      "INSERT INTO staff_permissions(user_id,permission) VALUES($1,'community_moderation')",
      [account.user!.id],
    );
  }
} finally {
  await db.close();
}
await import('../../apps/api/src/main');
