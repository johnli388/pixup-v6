import { z } from 'zod';
import { one, type SQL } from '../database/index';
import { check, id } from './core';
export const planLimits = z
  .object({
    seats: z.number().int().min(1).max(1000),
    asset_registrations: z.number().int().min(0).max(100000),
    collection_drafts: z.number().int().min(0).max(10000),
    listing_creations: z.number().int().min(0).max(100000),
    tool_calls: z.number().int().min(0).max(1000000),
  })
  .strict();
export const planInput = z
  .object({
    name: z.string().trim().min(3).max(100),
    audience: z.enum(['demand', 'distribution', 'supply']),
    amount_cents: z.number().int().min(100).max(1000000),
    trial_days: z.number().int().min(0).max(30),
    grace_days: z.number().int().min(0).max(14),
    limits: planLimits,
  })
  .strict();
export const pilotLimits = {
  seats: 5,
  asset_registrations: 50,
  collection_drafts: 5,
  listing_creations: 20,
  tool_calls: 100,
};
export type Metric = Exclude<keyof typeof pilotLimits, 'seats'>;
export async function workspaceMember(
  tx: SQL,
  user: string,
  org: string,
  write = false,
  owner = false,
) {
  const m = await one(
    tx,
    'SELECT m.role,o.kind FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.user_id=$1 AND m.org_id=$2 FOR SHARE OF m',
    [user, org],
  );
  check(
    m &&
      (!write || ['owner', 'publisher', 'operator'].includes(m.role)) &&
      (!owner || m.role === 'owner'),
    'FORBIDDEN',
    'Current workspace permission is required.',
    403,
  );
  return m;
}
export async function personalWorkspace(tx: SQL, user: string) {
  const m = await one(
    tx,
    "SELECT o.id FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=$1 AND m.role='owner' ORDER BY CASE WHEN o.kind='personal' THEN 0 ELSE 1 END,o.id LIMIT 1",
    [user],
  );
  check(m, 'WORKSPACE_REQUIRED', 'Choose a current workspace.');
  return m.id as string;
}
export async function entitlement(tx: SQL, org: string) {
  const s = await one(
    tx,
    `SELECT s.*,p.limits,p.grace_days,p.name FROM subscriptions s JOIN billing_accounts a ON a.id=s.account_id JOIN plan_versions p ON p.id=s.plan_id WHERE a.org_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 1`,
    [org],
  );
  const now = Date.now();
  const grace =
    !!s &&
    s.state === 'past_due' &&
    !!s.last_paid_at &&
    !!s.past_due_since &&
    now < Date.parse(s.past_due_since) + s.grace_days * 86400000;
  const entitled =
    !!s &&
    ((['active', 'trial'].includes(s.state) &&
      Date.parse(s.state === 'trial' ? s.trial_end : s.period_end) > now) ||
      grace);
  return {
    state: grace
      ? 'grace'
      : s && ['active', 'trial'].includes(s.state) && !entitled
        ? 'expired'
        : s?.state || 'pilot',
    plan: entitled ? s!.name : 'Local pilot',
    limits: entitled ? s.limits : pilotLimits,
    paid_entitlement: entitled,
    period_end: s?.period_end || null,
  };
}
// Call inside the shared transaction lock. Failed business actions roll back their usage too.
export async function consumeUsage(
  tx: SQL,
  org: string,
  metric: Metric,
  resource: string,
  quantity = 1,
) {
  const old = await one(
    tx,
    'SELECT quantity FROM usage_events WHERE org_id=$1 AND metric=$2 AND resource_id=$3',
    [org, metric, resource],
  );
  if (old) {
    check(old.quantity === quantity, 'USAGE_CONFLICT', 'Usage identifier has different quantity.');
    return;
  }
  const e = await entitlement(tx, org),
    used = (await one(
      tx,
      "SELECT COALESCE(sum(quantity),0)::int AS n FROM usage_events WHERE org_id=$1 AND metric=$2 AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
      [org, metric],
    ))!.n;
  check(
    used + quantity <= e.limits[metric],
    'PLAN_LIMIT',
    'Workspace monthly usage limit reached. Existing records and recovery remain available.',
    403,
  );
  await tx.query(
    'INSERT INTO usage_events(id,org_id,metric,resource_id,quantity) VALUES ($1,$2,$3,$4,$5)',
    [id(), org, metric, resource, quantity],
  );
}
export async function requireSeat(tx: SQL, org: string, includingPending = true) {
  const e = await entitlement(tx, org),
    n = (await one(
      tx,
      `SELECT (SELECT count(*) FROM memberships WHERE org_id=$1)+(CASE WHEN $2 THEN (SELECT count(*) FROM organization_invitations WHERE org_id=$1 AND status='pending' AND expires_at>now()) ELSE 0 END) AS n`,
      [org, includingPending],
    ))!.n;
  check(
    Number(n) < e.limits.seats,
    'PLAN_LIMIT',
    'Workspace seat limit reached; remove an invitation/member or change plan.',
    403,
  );
}
