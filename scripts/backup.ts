import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, appendFile, stat, open, mkdtemp, rm, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openDatabase, one } from '../packages/database/index';
import { fingerprints, verifyIntegrity } from '../packages/operations/integrity';
const magic = Buffer.from('PIXUPBK1');
function key() {
  const value = Buffer.from(process.env.PIXUP_BACKUP_KEY || '', 'base64');
  if (value.length !== 32)
    throw new Error('PIXUP_BACKUP_KEY must contain a base64 32-byte encryption key.');
  return value;
}
function pgEnv(url: string) {
  const u = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(u.protocol))
    throw new Error('An explicit PostgreSQL URL is required.');
  return {
    PATH: process.env.PATH,
    LANG: 'C',
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGSSLMODE: u.searchParams.get('sslmode') || 'prefer',
  };
}
function command(name: string, args: string[], url: string) {
  const child = spawn(
    join(process.env.PIXUP_PG_BIN || '/opt/homebrew/opt/postgresql@18/bin', name),
    args,
    { env: pgEnv(url), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Provider/tool diagnostics can contain credentials or SQL data; expose only tool name/exit code.
  child.stderr.resume();
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new Error(`${name} could not start`)));
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${name} failed with exit code ${code}`)),
    );
  });
  done.catch(() => {});
  return { child, done };
}
async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function backupDatabase(url: string, file: string) {
  const secret = key(),
    db = await openDatabase(url),
    nonce = randomBytes(12);
  let created = false;
  try {
    const handle = await open(file, 'wx', 0o600);
    created = true;
    await handle.write(Buffer.concat([magic, nonce]));
    await handle.close();
    const manifest = await db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const started = new Date().toISOString();
      const snapshot = (await one(tx, 'SELECT pg_export_snapshot() AS snapshot'))!.snapshot;
      const fingerprint = await fingerprints(tx),
        integrity = await verifyIntegrity(tx);
      const { child, done } = command(
          'pg_dump',
          ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshot}`],
          url,
        ),
        cipher = createCipheriv('aes-256-gcm', secret, nonce);
      try {
        await pipeline(child.stdout, cipher, createWriteStream(file, { flags: 'a', mode: 0o600 }));
        await done;
      } catch (e) {
        child.kill();
        await done.catch(() => {});
        throw e;
      }
      await appendFile(file, cipher.getAuthTag());
      const h = await open(file, 'r+');
      try {
        await h.sync();
      } finally {
        await h.close();
      }
      return {
        format: 'pixup-encrypted-pgdump-v1',
        snapshot_at: started,
        created_at: new Date().toISOString(),
        fingerprint,
        integrity,
      };
    });
    await writeFile(
      file + '.manifest.json',
      JSON.stringify({ ...manifest, sha256: await digest(file) }, null, 2),
      { flag: 'wx', mode: 0o600, flush: true },
    );
    const parent = await open(dirname(file), 'r');
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    return {
      file,
      encrypted: true,
      snapshot_at: manifest.snapshot_at,
      tables: Object.keys(manifest.fingerprint).length,
    };
  } catch (e) {
    if (created) await unlink(file).catch(() => {});
    throw e;
  } finally {
    await db.close();
  }
}
export async function restoreDatabase(url: string, file: string) {
  const secret = key(),
    db = await openDatabase(url),
    directory = await mkdtemp(join(tmpdir(), 'pixup-restore-')),
    started = performance.now();
  try {
    const empty = await one(
      db,
      "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','v','m','S','f','p')",
    );
    if (empty!.n !== 0)
      throw new Error(
        'Restore target must be an empty disposable database. Existing objects will not be overwritten.',
      );
    const manifest = JSON.parse(await readFile(file + '.manifest.json', 'utf8'));
    if (manifest.format !== 'pixup-encrypted-pgdump-v1' || manifest.sha256 !== (await digest(file)))
      throw new Error('Backup manifest checksum mismatch.');
    const size = (await stat(file)).size,
      handle = await open(file, 'r'),
      header = Buffer.alloc(20),
      tag = Buffer.alloc(16);
    try {
      await handle.read(header, 0, 20, 0);
      await handle.read(tag, 0, 16, size - 16);
    } finally {
      await handle.close();
    }
    if (!header.subarray(0, 8).equals(magic) || size < 37)
      throw new Error('Invalid encrypted backup format.');
    const decipher = createDecipheriv('aes-256-gcm', secret, header.subarray(8));
    decipher.setAuthTag(tag);
    const plain = join(directory, 'restore.dump');
    await pipeline(
      createReadStream(file, { start: 20, end: size - 17 }),
      decipher,
      createWriteStream(plain, { flags: 'wx', mode: 0o600 }),
    );
    // Nothing touches the target until GCM authenticates the entire archive.
    const { child, done } = command(
      'pg_restore',
      [
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        '--single-transaction',
        '--dbname',
        pgEnv(url).PGDATABASE,
        plain,
      ],
      url,
    );
    child.stdout.resume();
    await done;
    const restored = await db.transaction((tx) => fingerprints(tx));
    if (JSON.stringify(restored) !== JSON.stringify(manifest.fingerprint))
      throw new Error('Restored table fingerprints do not match the source snapshot.');
    const integrity = await verifyIntegrity(db);
    return {
      restored: true,
      tables: Object.keys(restored).length,
      restore_ms: Math.round(performance.now() - started),
      snapshot_at: manifest.snapshot_at,
      snapshot_age_seconds: Math.round((Date.now() - Date.parse(manifest.snapshot_at)) / 1000),
      integrity,
    };
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [mode, file] = process.argv.slice(2),
    url =
      mode === 'backup'
        ? process.env.PIXUP_BACKUP_DATABASE_URL
        : process.env.PIXUP_RESTORE_DATABASE_URL;
  if (!url || !file || !['backup', 'restore'].includes(mode))
    throw new Error(
      'Use backup|restore /absolute/artifact-path with explicit PIXUP_BACKUP_DATABASE_URL or PIXUP_RESTORE_DATABASE_URL. This script never loads .env.',
    );
  try {
    console.log(
      JSON.stringify(
        await (mode === 'backup'
          ? backupDatabase(url, resolve(file))
          : restoreDatabase(url, resolve(file))),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'Backup operation failed');
    process.exitCode = 1;
  }
}
