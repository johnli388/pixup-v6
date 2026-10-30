import { z } from 'zod';
const label = z.string().trim().min(1).max(200);
const note = z.string().trim().min(10).max(2000);
export const channelKind = z.enum(['cvm', 'liveup', 'goup', 'waxup']);
export const channelTerms = z
  .object({
    description: note,
    shipping_total_cents: z.number().int().min(0).max(100000).default(0),
    target_units: z.number().int().min(1).max(50).default(1),
    units_per_case: z.number().int().min(1).max(100).default(1),
    return_days: z.number().int().min(0).max(30).default(0),
    return_mode: z.enum(['none', 'consignment', 'buyback']).default('none'),
  })
  .strict();
export const contextInput = z
  .object({
    kind: channelKind,
    org_id: label,
    name: label,
    terms: channelTerms,
    deadline: z.iso.datetime().optional(),
    public_key: z.string().max(1000).optional(),
  })
  .strict();
export const allocationInput = z.object({ listing_id: label, slot: label }).strict();
export const packInput = z
  .object({
    title: label,
    category: z.enum(['Sports', 'K-pop']),
    supplier_reference: note,
    seal_reference: label,
    units: z.number().int().min(1).max(100),
    price_cents: z.number().int().min(100).max(10000000),
  })
  .strict();
export const deviceEvent = z.discriminatedUnion('type', [
  z.object({ event_id: label, type: z.literal('heartbeat') }).strict(),
  z
    .object({
      event_id: label,
      type: z.literal('vend'),
      command_id: label,
      outcome: z.enum(['delivered', 'not_dispensed', 'unknown']),
      evidence: note,
    })
    .strict(),
  z
    .object({ event_id: label, type: z.literal('deposit'), return_id: label, evidence: note })
    .strict(),
]);
export const revealInput = z
  .object({
    recording_reference: label,
    recording_offset_ms: z.number().int().min(0).max(86400000),
    evidence: note,
    contents: z
      .array(z.object({ title: label, description: note }).strict())
      .max(100)
      .default([]),
  })
  .strict();
export const toolInput = z
  .object({
    request_id: z.string().min(8).max(128),
    query: z.string().trim().max(200).default(''),
    category: z.enum(['Sports', 'K-pop', 'Art', 'Gaming']).optional(),
    max_price_cents: z.number().int().positive().optional(),
    asset_id: label.optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();
export const keyInput = z
  .object({
    org_id: label,
    name: label,
    scopes: z
      .array(z.enum(['query', 'match', 'route']))
      .min(1)
      .max(3),
    daily_limit: z.number().int().min(1).max(10000).default(100),
  })
  .strict();
export const channelSummary = z.object({
  id: z.string(),
  kind: channelKind,
  name: z.string(),
  org_id: z.string(),
  status: z.string(),
  terms: channelTerms,
  terms_version: z.number().int(),
  deadline: z.string().nullable(),
  online: z.boolean(),
});
export type ChannelSummary = z.infer<typeof channelSummary>;
export type ContextInput = z.infer<typeof contextInput>;
export type RevealInput = z.infer<typeof revealInput>;

export const toolResult = z
  .object({
    operation: z.enum(['query', 'match', 'route']),
    request_id: z.string(),
    as_of: z.iso.datetime(),
    valid_until: z.iso.datetime(),
    replayed: z.boolean(),
    usage: z.object({
      used_today: z.number().int().nonnegative(),
      daily_limit: z.number().int().positive(),
    }),
    notice: z.string(),
    items: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          category: z.string(),
          kind: z.enum(['specimen', 'sealed_pack']),
          certification: z.string(),
          custody: z.string(),
          price_cents: z.number().int(),
          channel: z.enum(['web', 'cvm', 'liveup', 'goup', 'waxup']),
          context_id: z.string().nullable(),
          allocation_id: z.string().nullable(),
          match_reason: z.string().optional(),
          path: z.string().optional(),
          requires_user_confirmation: z.literal(true).optional(),
        })
        .strict(),
    ),
  })
  .strict();
