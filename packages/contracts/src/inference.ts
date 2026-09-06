import { z } from 'zod';
import { UtcInstantSchema } from './common.ts';

export const InferenceStatusSchema = z
  .object({
    active: z
      .object({
        kind: z.enum(['watch', 'chat', 'menus', 'classification', 'photo']),
        startedAt: UtcInstantSchema,
      })
      .strict()
      .nullable(),
    queued: z
      .object({
        watch: z.number().int().nonnegative(),
        chat: z.number().int().nonnegative().optional(),
        menus: z.number().int().nonnegative().optional(),
        classification: z.number().int().nonnegative().optional(),
        photo: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export type InferenceStatus = z.infer<typeof InferenceStatusSchema>;
