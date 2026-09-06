import { z } from 'zod';

export const ProtocolVersionSchema = z.literal(1);

export const UuidSchema = z.string().uuid();

export const UtcInstantSchema = z.string().datetime({ offset: true });

export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const LocalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    database: z.literal('ok'),
    ollama: z.literal('not-required'),
    version: z.string(),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
