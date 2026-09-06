import { z } from 'zod';
import { EvidencePassageSchema, EvidenceSourceSchema } from './contracts.js';
import type { EvidenceDossier } from './passages.js';

// A private conversation snapshot, never a shared knowledge store.
export const ResearchMemorySchema = z
  .strictObject({
    sources: z.array(EvidenceSourceSchema).max(8),
    passages: z.array(EvidencePassageSchema).max(12),
  })
  .refine(
    ({ sources, passages }) =>
      new Set(sources.map((s) => s.id)).size === sources.length &&
      new Set(passages.map((p) => p.id)).size === passages.length &&
      passages.every((p) => sources.some((s) => s.id === p.sourceId)) &&
      passages.reduce((n, p) => n + p.text.length, 0) <= 24000,
  );
export type ResearchMemory = z.infer<typeof ResearchMemorySchema>;

export const ContinuationSchema = z.strictObject({
  question: z.string().trim().min(3).max(2000),
  action: z.enum(['reuse', 'links', 'research']),
  sourceIds: z.array(z.string()).max(8),
});
export const ContinuationJsonSchema = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    action: { type: 'string', enum: ['reuse', 'links', 'research'] },
    sourceIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['question', 'action', 'sourceIds'],
  additionalProperties: false,
};

export function memoryDossier(memory: ResearchMemory): EvidenceDossier {
  return {
    ...memory,
    characterCount: memory.passages.reduce((n, p) => n + p.text.length, 0),
    retrievalMode: 'lexical_fallback',
    diagnostics: {
      candidateWindows: memory.passages.length,
      queryCount: 0,
      lexicalCandidates: 0,
      semanticCandidates: 0,
      selectedParagraphKeys: [],
      queryPassageIds: [],
      queries: [],
    },
  };
}
