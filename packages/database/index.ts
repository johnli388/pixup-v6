import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';

export interface SQL {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}
export interface Database extends SQL {
  transaction<T>(fn: (tx: SQL) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function openDatabase(url?: string, directory?: string): Promise<Database> {
  if (url) {
    const pool = postgres(url, { max: 10 });
    return {
      query: async (sql, params) => ({ rows: (await pool.unsafe(sql, params as any)) as any }),
      exec: async (sql) => {
        await pool.unsafe(sql).simple();
      },
      transaction: async <T>(fn: (tx: SQL) => Promise<T>): Promise<T> =>
        pool.begin(async (tx) =>
          fn({
            query: async (sql, params) => ({ rows: (await tx.unsafe(sql, params as any)) as any }),
            exec: async (sql) => {
              await tx.unsafe(sql).simple();
            },
          }),
        ) as Promise<T>,
      close: () => pool.end(),
    };
  }
  const db = new PGlite(directory);
  await db.waitReady;
  return {
    query: (sql, params) => db.query(sql, params),
    exec: async (sql) => {
      await db.exec(sql);
    },
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: (sql, params) => tx.query(sql, params),
          exec: async (sql) => {
            await tx.exec(sql);
          },
        }),
      ),
    close: () => db.close(),
  };
}

export async function migrate(db: Database) {
  await db.query(
    'CREATE TABLE IF NOT EXISTS migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(770021)');
    for (const [version, file] of [
      ['001', '001-initial.sql'],
      ['002', '002-journal-invariants.sql'],
      ['003', '003-media.sql'],
      ['004', '004-plan-alignment.sql'],
      ['005', '005-stripe-checkout.sql'],
    ]) {
      const found = await tx.query('SELECT version FROM migrations WHERE version=$1', [version]);
      if (!found.rows.length) {
        const sql = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
        await tx.exec(sql);
        await tx.query('INSERT INTO migrations(version) VALUES ($1)', [version]);
      }
    }
  });
}

export async function one<T = Record<string, any>>(
  db: SQL,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}
