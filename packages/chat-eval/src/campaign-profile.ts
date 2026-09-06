import { defaultModelProfile, type ModelRole } from '@friday/assistant-core';
import { z } from 'zod';
import type { ModelPair } from './evaluation-types.js';

const profile = z.strictObject({
  contextTokens: z.number().int().min(8192).max(32768),
  temperature: z.number().min(0).max(2),
  topK: z.number().int().min(1).max(100),
  topP: z.number().min(0).max(1),
  repeatPenalty: z.number().min(0).max(2),
  presencePenalty: z.number().min(-2).max(2),
  think: z.boolean(),
});
const roles = z.enum(['planning', 'preparation', 'writing', 'verification']);
export const CampaignProfileSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{3,100}$/u),
  writerModel: z.string().min(1).max(100),
  auditorModel: z.string().min(1).max(100),
  profiles: z.partialRecord(roles, profile).optional(),
  modelsByRole: z.partialRecord(roles, z.string().min(1).max(100)).optional(),
});

/** Manifest records every effective role setting, including defaults. */
export function resolveCampaignProfile(pair: ModelPair): ModelPair {
  const modelsByRole = Object.fromEntries(
    roles.options.map((role) => [
      role,
      pair.modelsByRole?.[role] ??
        (role === 'writing' ? pair.writerModel : pair.auditorModel),
    ]),
  ) as Record<ModelRole, string>;
  return CampaignProfileSchema.parse({
    ...pair,
    modelsByRole,
    profiles: Object.fromEntries(
      roles.options.map((role) => [
        role,
        {
          ...defaultModelProfile(modelsByRole[role], role),
          ...pair.profiles?.[role],
        },
      ]),
    ),
  });
}
