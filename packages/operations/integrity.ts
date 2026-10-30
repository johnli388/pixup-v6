import { createHash } from 'node:crypto';
import { one, type SQL } from '../database/index';
import { check } from '../domain/core';
export async function verifyIntegrity(db: SQL) {
  const bad = (await one(
    db,
    `SELECT
 (SELECT count(*) FROM (SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING sum(amount)<>0) x)::int AS journals,
 (SELECT count(*) FROM credit_lots WHERE available<0 OR held<0 OR available+held>issued)::int AS credits,
 (SELECT count(*) FROM (SELECT asset_id FROM listings WHERE status IN ('active','reserved') GROUP BY asset_id HAVING count(*)>1) x)::int AS stock`,
  ))!;
  check(
    Object.values(bad).every((v) => v === 0),
    'INTEGRITY_FAILED',
    'Journal, credit or stock invariant failed.',
    500,
  );
  const events = (await db.query('SELECT * FROM provenance_events ORDER BY asset_id,sequence'))
    .rows;
  const prior = new Map<string, { hash: string; sequence: number }>();
  for (const e of events) {
    const p = prior.get(e.asset_id) || { hash: 'genesis', sequence: 0 };
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          asset: e.asset_id,
          sequence: e.sequence,
          type: e.type,
          description: e.description,
          actor: e.actor_id,
          previous: e.previous_hash,
          time: new Date(e.created_at).toISOString(),
        }),
      )
      .digest('hex');
    check(
      e.previous_hash === p.hash && e.sequence === p.sequence + 1 && e.hash === digest,
      'PROVENANCE_FAILED',
      'Provenance chain verification failed.',
      500,
    );
    prior.set(e.asset_id, { hash: e.hash, sequence: e.sequence });
  }
  return {
    journals_balanced: true,
    credits_valid: true,
    stock_unique: true,
    provenance_events_verified: events.length,
  };
}
export async function fingerprints(db: SQL) {
  await db.query("SET LOCAL TIME ZONE 'UTC'");
  const result: Record<string, { rows: number; digest: string }> = {};
  const tables = (
    await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows;
  for (const { tablename } of tables) {
    check(/^[a-z_][a-z_0-9]*$/.test(tablename), 'TABLE_NAME', 'Unexpected table name.', 500);
    const row = await one(
      db,
      `SELECT count(*)::int AS rows,md5(COALESCE(string_agg(md5(t::text),'' ORDER BY md5(t::text)),'')) AS digest FROM "${tablename}" t`,
    );
    result[tablename] = row as { rows: number; digest: string };
  }
  return result;
}
