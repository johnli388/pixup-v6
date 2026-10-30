import { randomUUID } from 'node:crypto';
import { one, type SQL } from '../database/index';
import { hash } from './security';

export const id = () => randomUUID();
export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function check(
  condition: unknown,
  code: string,
  message: string,
  status = 409,
): asserts condition {
  if (!condition) throw new DomainError(status, code, message);
}
export async function journal(
  tx: SQL,
  reference: string,
  unit: 'USD' | 'CREDIT',
  description: string,
  lines: [string, number][],
) {
  const nonzero = lines.filter(([, amount]) => amount !== 0);
  check(
    nonzero.length >= 2 &&
      nonzero.every(([, a]) => Number.isSafeInteger(a)) &&
      nonzero.reduce((sum, [, a]) => sum + a, 0) === 0,
    'UNBALANCED_JOURNAL',
    'Journal entries must balance.',
    500,
  );
  const entry = id();
  await tx.query(
    'INSERT INTO journal_entries(id,reference,unit,description) VALUES ($1,$2,$3,$4)',
    [entry, reference, unit, description],
  );
  for (const [account, amount] of nonzero)
    await tx.query('INSERT INTO journal_lines(id,entry_id,account,amount) VALUES ($1,$2,$3,$4)', [
      id(),
      entry,
      account,
      amount,
    ]);
}
export async function provenance(
  tx: SQL,
  asset: string,
  actor: string,
  type: string,
  description: string,
) {
  await tx.query('SELECT id FROM assets WHERE id=$1 FOR UPDATE', [asset]);
  const previous = await one(
    tx,
    'SELECT hash,sequence FROM provenance_events WHERE asset_id=$1 ORDER BY sequence DESC LIMIT 1',
    [asset],
  );
  const event = {
    asset,
    sequence: (previous?.sequence || 0) + 1,
    type,
    description,
    actor,
    previous: previous?.hash || 'genesis',
    time: new Date().toISOString(),
  };
  await tx.query(
    'INSERT INTO provenance_events(id,asset_id,sequence,type,description,actor_id,previous_hash,hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      id(),
      asset,
      event.sequence,
      type,
      description,
      actor,
      event.previous,
      hash(JSON.stringify(event)),
      event.time,
    ],
  );
}
export async function audit(
  tx: SQL,
  actor: string,
  action: string,
  resource: string,
  details: object = {},
) {
  await tx.query(
    'INSERT INTO audit_log(id,actor_id,action,resource_id,details) VALUES ($1,$2,$3,$4,$5)',
    [id(), actor, action, resource, JSON.stringify(details)],
  );
}
export async function notify(
  tx: SQL,
  user: string,
  title: string,
  body: string,
  aggregate: string,
) {
  await tx.query('INSERT INTO outbox(id,type,aggregate_id,payload) VALUES ($1,$2,$3,$4)', [
    id(),
    'notification',
    aggregate,
    JSON.stringify({ user, title, body }),
  ]);
}
