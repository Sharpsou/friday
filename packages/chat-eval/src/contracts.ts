import { z } from 'zod';

const UtcInstantSchema = z.iso.datetime({ offset: true });
const SourceIdSchema = z.string().regex(/^S[1-9]\d*$/u);
const PassageIdSchema = z.string().regex(/^P[1-9]\d*$/u);
const UnitIdSchema = z.string().regex(/^U[1-9]\d*$/u);

function uniqueBy<T>(values: T[], key: (value: T) => string): boolean {
  return new Set(values.map(key)).size === values.length;
}

export const EvidenceSourceSchema = z.strictObject({
  id: SourceIdSchema,
  url: z
    .url()
    .max(2_048)
    .refine((url) => /^https?:\/\//u.test(url), 'HTTP(S) URL required'),
  title: z.string().trim().min(1).max(500),
  publishedAt: UtcInstantSchema.optional(),
  retrievedAt: UtcInstantSchema,
});

export const EvidencePassageSchema = z.strictObject({
  id: PassageIdSchema,
  sourceId: SourceIdSchema,
  heading: z.string().trim().min(1).max(500).optional(),
  text: z.string().trim().min(1).max(8_000),
});

export const AuditUnitSchema = z
  .strictObject({
    id: UnitIdSchema,
    text: z.string().trim().min(1).max(4_000),
    citedPassageIds: z.array(PassageIdSchema).max(12),
  })
  .refine((unit) => uniqueBy(unit.citedPassageIds, String), {
    message: 'Duplicate cited passage identifier',
    path: ['citedPassageIds'],
  });

export const AnswerAuditSchema = z
  .strictObject({
    units: z
      .array(
        z.strictObject({
          unitId: UnitIdSchema,
          verdict: z.enum([
            'supported',
            'unsupported',
            'contradicted',
            'not_factual',
          ]),
          passageIds: z.array(PassageIdSchema).max(12),
          reason: z.string().trim().min(1).max(500).optional(),
        }),
      )
      .max(100),
    usefulness: z.enum(['answers', 'partial', 'misses']),
    missingAspects: z.array(z.string().trim().min(1).max(300)).max(20),
    evidenceSufficiency: z.enum(['sufficient', 'insufficient']),
  })
  .refine((audit) => uniqueBy(audit.units, ({ unitId }) => unitId), {
    message: 'Duplicate audited unit identifier',
    path: ['units'],
  })
  .refine((audit) => uniqueBy(audit.missingAspects, String), {
    message: 'Duplicate missing aspect',
    path: ['missingAspects'],
  })
  .refine(
    (audit) => audit.units.every((unit) => uniqueBy(unit.passageIds, String)),
    { message: 'Duplicate supporting passage identifier', path: ['units'] },
  );

export const FrozenPageSchema = z.strictObject({
  source: EvidenceSourceSchema,
  snapshot: z
    .strictObject({
      file: z.string().regex(/^pages\/[a-z0-9][a-z0-9._-]{2,199}\.html$/u),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      contentType: z.enum(['text/html', 'text/plain']),
    })
    .optional(),
  sections: z
    .array(
      z.strictObject({
        heading: z.string().trim().min(1).max(500).optional(),
        paragraphs: z
          .array(z.string().trim().min(1).max(12_000))
          .min(1)
          .max(500),
      }),
    )
    .min(1)
    .max(200),
});

export const PriorTurnSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(8_000),
});

export const HumanCriteriaSchema = z.strictObject({
  expectedAspects: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
  catastrophicFailures: z
    .array(z.string().trim().min(1).max(300))
    .max(20)
    .default([]),
  notes: z.string().trim().max(2_000).optional(),
});

export const ChatEvalCaseSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/u),
    split: z.enum(['development', 'validation']),
    category: z.enum([
      'current_events',
      'explanation',
      'comparison',
      'recommendation',
      'procedure',
      'local',
      'scientific',
      'technical',
      'high_risk',
      'context_followup',
    ]),
    question: z.string().trim().min(3).max(2_000),
    priorTurns: z.array(PriorTurnSchema).max(2).default([]),
    pages: z.array(FrozenPageSchema).min(1).max(20),
    criteria: HumanCriteriaSchema,
    frozenAt: UtcInstantSchema,
  })
  .refine(({ pages }) => uniqueBy(pages, ({ source }) => source.id), {
    message: 'Duplicate source identifier',
    path: ['pages'],
  });

export const CorpusSchema = z
  .strictObject({
    version: z.literal('chat-foundation-v1'),
    frozen: z.literal(true),
    cases: z.array(ChatEvalCaseSchema).length(20),
  })
  .refine((corpus) => uniqueBy(corpus.cases, ({ id }) => id), {
    message: 'Duplicate case identifier',
    path: ['cases'],
  })
  .refine(
    ({ cases }) =>
      cases.filter(({ split }) => split === 'development').length === 10 &&
      cases.filter(({ split }) => split === 'validation').length === 10,
    { message: 'Corpus requires 10 development and 10 validation cases' },
  );

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
export type EvidencePassage = z.infer<typeof EvidencePassageSchema>;
export type AuditUnit = z.infer<typeof AuditUnitSchema>;
export type AnswerAudit = z.infer<typeof AnswerAuditSchema>;
export type FrozenPage = z.infer<typeof FrozenPageSchema>;
export type ChatEvalCase = z.infer<typeof ChatEvalCaseSchema>;
export type Corpus = z.infer<typeof CorpusSchema>;

export function validateAuditReferences(
  audit: AnswerAudit,
  units: AuditUnit[],
  passages: EvidencePassage[],
): AnswerAudit {
  const unitIds = new Set(units.map(({ id }) => id));
  const passageIds = new Set(passages.map(({ id }) => id));
  for (const unit of audit.units) {
    if (!unitIds.has(unit.unitId)) throw new Error('AUDIT_UNKNOWN_UNIT');
    if (unit.passageIds.some((id) => !passageIds.has(id))) {
      throw new Error('AUDIT_UNKNOWN_PASSAGE');
    }
  }
  const byId = new Map(audit.units.map((unit) => [unit.unitId, unit]));
  return {
    ...audit,
    units: units.map(
      ({ id }) =>
        byId.get(id) ?? {
          unitId: id,
          verdict: 'unsupported' as const,
          passageIds: [],
          reason: 'Unité omise par l’auditeur.',
        },
    ),
  };
}

export const AnswerAuditJsonSchema = z.toJSONSchema(AnswerAuditSchema);
