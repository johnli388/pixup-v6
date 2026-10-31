import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database, SQL } from './index';
const actors = new AsyncLocalStorage<string>();
export function withDatabaseActor<T>(actor: string, fn: () => T): T {
  return actors.run(actor, fn);
}
export function contextualDatabase(base: Database): Database {
  async function transaction<T>(fn: (tx: SQL) => Promise<T>): Promise<T> {
    return base.transaction(async (tx) => {
      const actor = actors.getStore();
      if (actor !== undefined)
        await tx.query("SELECT set_config('pixup.actor_id',$1,true)", [actor]);
      return fn(tx);
    });
  }
  return {
    query: (sql, params) =>
      actors.getStore() === undefined
        ? base.query(sql, params)
        : transaction((tx) => tx.query(sql, params)),
    exec: (sql) =>
      actors.getStore() === undefined ? base.exec(sql) : transaction((tx) => tx.exec(sql)),
    transaction,
    close: () => base.close(),
  };
}
export async function assertRuntimeRole(db: Database, worker: boolean) {
  const policies = (
    await db.query(
      "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('collections','organization_invitations','owner_transfers','community_entries','community_reports','community_revisions') AND c.relrowsecurity",
    )
  ).rows[0];
  const privilege = (
    await db.query(
      "SELECT has_schema_privilege(current_user,'public','CREATE') AS schema_create,has_table_privilege(current_user,'journal_lines','TRUNCATE') AS truncate_journal",
    )
  ).rows[0];
  if (policies?.n !== 6 || privilege?.schema_create || privilege?.truncate_journal)
    throw new Error('Runtime policies or DDL privileges are not configured safely.');
  const r = (
    await db.query(
      "SELECT r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,EXISTS(SELECT 1 FROM pg_roles x WHERE (x.rolsuper OR x.rolbypassrls OR x.rolcreatedb OR x.rolcreaterole) AND pg_has_role(current_user,x.oid,'member')) AS privileged_membership,EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND pg_has_role(current_user,c.relowner,'member')) AS owns_tables,EXISTS(SELECT 1 FROM pg_roles p WHERE p.rolname='pixup_worker' AND pg_has_role(current_user,p.oid,'member')) AS worker,EXISTS(SELECT 1 FROM pg_roles p WHERE p.rolname='pixup_runtime' AND pg_has_role(current_user,p.oid,'member')) AS runtime FROM pg_roles r WHERE r.rolname=current_user",
    )
  ).rows[0];
  if (
    !r ||
    r.rolsuper ||
    r.rolbypassrls ||
    r.rolcreatedb ||
    r.rolcreaterole ||
    r.owns_tables ||
    r.privileged_membership ||
    r.worker !== worker ||
    r.runtime === worker
  )
    throw new Error('Database runtime role violates the configured API/worker privilege boundary.');
}
