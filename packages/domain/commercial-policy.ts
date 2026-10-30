import { z } from 'zod';
import { one, type SQL } from '../database/index';
import { check } from './core';

export const commercialTopics = [
  'credit_redemption',
  'creator_entitlements',
  'seller_protection',
  'title_payout',
  'refund_windows',
  'taxation',
  'jurisdiction_age',
] as const;
export const commercialOwners: Record<(typeof commercialTopics)[number], string> = {
  credit_redemption: 'D2 · Finance, product and payments counsel',
  creator_entitlements: 'D4 · Product, finance and IP counsel',
  seller_protection: 'D3 / D7 · Product, operations and governance',
  title_payout: 'D13 / D14 · Finance and channel operations',
  refund_windows: 'D7 / D9 · Product, operations and counsel',
  taxation: 'D9 / D14 · Finance and tax counsel',
  jurisdiction_age: 'D9 · Product and counsel',
};
export const commercialProposal = z
  .object({
    topic: z.enum(commercialTopics),
    action: z.enum([
      'record_review',
      'disable_credits',
      'restore_pilot_credits',
      'pause_sales',
      'resume_pilot_sales',
    ]),
    base_version: z.number().int().positive(),
    statement: z.string().trim().min(20).max(4000),
    evidence: z.string().trim().min(10).max(2000),
  })
  .strict()
  .refine(
    (d) =>
      d.action === 'record_review' ||
      (d.topic === 'credit_redemption' &&
        ['disable_credits', 'restore_pilot_credits'].includes(d.action)) ||
      (d.topic === 'jurisdiction_age' && ['pause_sales', 'resume_pilot_sales'].includes(d.action)),
    'This action is not supported for that decision topic.',
  );
export const commercialReview = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().min(10).max(2000),
  })
  .strict();

// Checkout holds this share lock through reservation. Approval takes the matching update lock.
export async function commercialPolicy(tx: SQL, lock = false) {
  const current = await one(
    tx,
    `SELECT version FROM commercial_policy_current WHERE singleton=true${lock ? ' FOR SHARE' : ''}`,
  );
  check(current, 'POLICY_UNAVAILABLE', 'Commercial policy is unavailable.', 503);
  const row = await one(tx, 'SELECT * FROM commercial_policy_versions WHERE version=$1', [
    current.version,
  ]);
  check(row, 'POLICY_UNAVAILABLE', 'Commercial policy is unavailable.', 503);
  return { ...row.snapshot, version: row.version };
}
export function requirePilotSales(policy: any) {
  check(
    policy.scope === 'local_pilot' &&
      policy.production_launch_approved === false &&
      policy.new_sales_enabled,
    'COMMERCIAL_PAUSED',
    'New pilot checkout is paused for commercial review. Existing orders remain available.',
  );
}
