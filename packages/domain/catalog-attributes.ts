import { z } from 'zod';
const value = z.string().trim().min(1).max(120);
export const catalogAttributes = z.discriminatedUnion('category', [
  z
    .object({
      category: z.literal('Sports'),
      athlete: value.optional(),
      team: value.optional(),
      league: value.optional(),
      season: value.optional(),
      set: value.optional(),
      manufacturer: value.optional(),
      card_number: value.optional(),
      parallel: value.optional(),
      language: value.optional(),
      autograph: z.boolean().optional(),
      relic: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      category: z.literal('K-pop'),
      group: value.optional(),
      member: value.optional(),
      album: value.optional(),
      era: value.optional(),
      event: value.optional(),
      store_variant: value.optional(),
      issuer: value.optional(),
      release: value.optional(),
      language: value.optional(),
      edition: value.optional(),
    })
    .strict(),
  z
    .object({
      category: z.literal('Art'),
      artist: value.optional(),
      medium: value.optional(),
      edition: value.optional(),
    })
    .strict(),
  z
    .object({
      category: z.literal('Gaming'),
      franchise: value.optional(),
      set: value.optional(),
      card_number: value.optional(),
      language: value.optional(),
      edition: value.optional(),
    })
    .strict(),
]);
