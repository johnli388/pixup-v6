import { z } from 'zod';

export const assistantInput = z
  .object({
    message: z.string().trim().min(1).max(2000),
    history: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().max(4000),
          })
          .strict(),
      )
      .max(6)
      .default([]),
    use_ai: z.boolean().default(false),
  })
  .strict();
export type AssistantInput = z.infer<typeof assistantInput>;

export const assistantPlan = z
  .object({
    intent: z.enum(['cards', 'sellers', 'buyers', 'orders', 'help']),
    query: z.string().max(200),
    category: z.enum(['Sports', 'K-pop', 'Art', 'Gaming']).nullable(),
    max_price_cents: z.number().int().min(0).max(10000000).nullable(),
  })
  .strict();
export type AssistantPlan = z.infer<typeof assistantPlan>;

export const assistantResult = z
  .object({
    kind: z.enum(['card', 'seller', 'buyer', 'order', 'help']),
    title: z.string(),
    description: z.string(),
    href: z.string().regex(/^\/(?!\/)/),
    price_cents: z.number().int().optional(),
    artwork: z.string().optional(),
  })
  .strict();
export const assistantResponse = z
  .object({
    answer: z.string().max(4000),
    mode: z.enum(['local', 'ai']),
    notice: z.string(),
    results: z.array(assistantResult).max(12),
  })
  .strict();
export type AssistantResponse = z.infer<typeof assistantResponse>;
export type AssistantResult = z.infer<typeof assistantResult>;
export type AssistantConfig = { ai_available: boolean };
