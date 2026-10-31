import { z } from 'zod';
export const communityGuidelinesVersion = 'community-pilot-v1';
export const communityGuidelines =
  'Be respectful. Share knowledge and personal experience with attribution. Do not post scams, harassment, private information, impersonation or material you do not have permission to share. Card discussions are member opinions, not certification or proof of ownership. Use private support for order disputes. Posts and comments are reviewed before appearing. You can report content and appeal moderation decisions.';
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const communityTypes = ['discussion', 'question', 'guide', 'story'] as const;
export const communityProfileInput = z
  .object({ display_name: text(2, 60), bio: text(0, 600), reply_notifications: z.boolean() })
  .strict();
export const communityAcceptInput = z
  .object({ version: z.literal(communityGuidelinesVersion), accepted: z.literal(true) })
  .strict();
export const communityPostInput = z
  .object({
    type: z.enum(communityTypes),
    title: text(3, 140),
    body: text(1, 20000),
    topics: z.array(text(1, 80)).min(1).max(3),
    asset_ids: z.array(text(1, 100)).max(5).default([]),
  })
  .strict();
export const communityEditInput = communityPostInput.extend({
  version: z.number().int().positive(),
});
export const communityVersionInput = z.object({ version: z.number().int().positive() }).strict();
export const communityCommentInput = z
  .object({ body: text(1, 3000), parent_id: text(1, 100).nullable().default(null) })
  .strict();
export const communityCommentEditInput = z
  .object({ body: text(1, 3000), version: z.number().int().positive() })
  .strict();
export const communityRelationInput = z
  .object({
    kind: z.enum(['like', 'save', 'follow', 'mute_topic', 'mute_user']),
    target: text(1, 100),
    enabled: z.boolean(),
  })
  .strict();
export const communityReportInput = z
  .object({
    entry_id: text(1, 100),
    category: z.enum(['spam', 'harassment', 'privacy', 'rights', 'inappropriate', 'other']),
    explanation: text(10, 2000),
  })
  .strict();
export const communityAppealInput = z
  .object({ action_id: text(1, 100), statement: text(10, 2000) })
  .strict();
export const communityDecisionInput = z
  .object({
    version: z.number().int().positive(),
    action: z.enum(['approve', 'hide', 'remove', 'lock', 'unlock', 'restrict', 'restore_posting']),
    reason: text(10, 2000),
    days: z.number().int().min(1).max(30).default(7),
  })
  .strict();
export const communityAppealDecisionInput = z
  .object({
    decision: z.enum(['uphold', 'overturn']),
    reason: text(10, 2000),
    version: z.number().int().positive(),
  })
  .strict();
export const communityTopicInput = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(60),
    name: text(2, 80),
    description: text(10, 600),
    active: z.boolean(),
  })
  .strict();
export const communitySuggestionInput = z
  .object({ name: text(2, 80), description: text(10, 600) })
  .strict();
export const communityFeedInput = z
  .object({
    feed: z.enum(['latest', 'following', 'saved', 'mine']).default('latest'),
    topic: text(1, 80).optional(),
    type: z.enum(communityTypes).optional(),
    q: text(0, 120).optional(),
    profile: text(1, 100).optional(),
    cursor: text(1, 2000).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type CommunityOptions = { enabled?: boolean; writes?: boolean };
