import 'dotenv/config';
import { openDatabase, one } from '../packages/database/index';
import { check, audit } from '../packages/domain/core';
// Offline initialization only: no bypass endpoint, no guessed users, no MFA reset.
const users = process.argv.slice(2);
check(
  users.length === 2 && new Set(users).size === 2,
  'BOOTSTRAP_INPUT',
  'Supply exactly two distinct existing user IDs.',
  400,
);
const db = await openDatabase(
  process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL,
  process.env.DATA_DIR || '.data/pixup',
);
try {
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(770023)');
    check(
      !(await one(tx, "SELECT user_id FROM staff_permissions WHERE permission='identity_admin'")),
      'BOOTSTRAP_COMPLETE',
      'Identity administrators already exist; use independent access review.',
    );
    for (const uid of users) {
      check(
        await one(
          tx,
          'SELECT u.id FROM users u JOIN authenticators a ON a.user_id=u.id WHERE u.id=$1 AND u.closed_at IS NULL AND u.email_verified_at IS NOT NULL AND a.enabled_at IS NOT NULL',
          [uid],
        ),
        'BOOTSTRAP_NOT_READY',
        'Both accounts must have verified email and confirmed MFA.',
      );
      await tx.query('UPDATE users SET is_staff=true WHERE id=$1', [uid]);
      await tx.query(
        "INSERT INTO staff_permissions(user_id,permission) VALUES ($1,'identity_admin')",
        [uid],
      );
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [uid]);
      await audit(tx, uid, 'identity.administrator_bootstrapped', uid, {
        source: 'offline_operator',
        peer: users.find((u) => u !== uid),
      });
    }
  });
  console.log(
    'Two existing verified MFA accounts initialized as identity administrators; previous sessions revoked.',
  );
} finally {
  await db.close();
}
