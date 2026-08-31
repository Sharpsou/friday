import { z } from 'zod';

const UtcInstantSchema = z.iso.datetime({ offset: true });
const SourceIdSchema = z.string().regex(/^S[1-9]\d*$/u);
const PassageIdSchema = z.string().regex(/^P[1-9]\d*$/u);
const UnitIdSchema = z.string().regex(/^U[1-9]\d*$/u);
const AxisIdSchema = z.string().regex(/^A[1-5]$/u);

function uniqueBy<T>(values: T[], key: (value: T) => string): boolean {
  return new Set(values.map(key)).size === values.length;
}

export const EvidenceSourceSchema = z.strictObject({
  id: SourceIdSchema,
  url: z
    .url()
    .max(2_048)
    .refine((url) => /^https:\/\//u.test(url), 'HTTPS URL required'),
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

export const AnswerAxisSchema = z.strictObject({
  id: AxisIdSchema,
  label: z.string().trim().min(2).max(80),
  question: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .refine((value) => !/https?:\/\//iu.test(value), 'URL forbidden'),
  importance: z.enum(['required', 'useful']),
  query: z
    .string()
    .trim()
    .min(2)
    .max(300)
    .refine((value) => !/https?:\/\//iu.test(value), 'URL forbidden'),
});

export const AnswerPlanSchema = z
  .strictObject({
    intent: z.enum([
      'explain',
      'compare',
      'recent',
      'recommend',
      'procedure',
      'other',
    ]),
    axes: z.array(AnswerAxisSchema).min(1).max(5),
  })
  .refine((plan) => uniqueBy(plan.axes, ({ id }) => id), {
    message: 'Duplicate answer axis identifier',
    path: ['axes'],
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
    axes: z
      .array(
        z.strictObject({
          axisId: AxisIdSchema,
          coverage: z.enum(['covered', 'partial', 'missing']),
          passageIds: z.array(PassageIdSchema).max(12),
        }),
      )
      .max(5)
      .default([]),
    usefulness: z.enum(['answers', 'partial', 'misses']),
    missingAspects: z.array(z.string().trim().min(1).max(300)).max(20),
    evidenceSufficiency: z.enum(['sufficient', 'insufficient']),
  })
  .refine((audit) => uniqueBy(audit.units, ({ unitId }) => unitId), {
    message: 'Duplicate audited unit identifier',
    path: ['units'],
  })
  .refine((audit) => uniqueBy(audit.axes, ({ axisId }) => axisId), {
    message: 'Duplicate audited axis identifier',
    path: ['axes'],
  })
  .refine((audit) => uniqueBy(audit.missingAspects, String), {
    message: 'Duplicate missing aspect',
    path: ['missingAspects'],
  })
  .refine(
    (audit) => audit.units.every((unit) => uniqueBy(unit.passageIds, String)),
    {
      message: 'Duplicate supporting passage identifier',
      path: ['units'],
    },
  )
  .refine(
    (audit) => audit.axes.every((axis) => uniqueBy(axis.passageIds, String)),
    {
      message: 'Duplicate axis passage identifier',
      path: ['axes'],
    },
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
  referenceEvidence: z
    .array(
      z.strictObject({
        aspect: z.string().trim().min(1).max(300),
        paragraphs: z
          .array(
            z.strictObject({
              sourceId: SourceIdSchema,
              sectionIndex: z.number().int().nonnegative().max(199),
              paragraphIndex: z.number().int().nonnegative().max(499),
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .max(20)
    .optional(),
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
    version: z.string().regex(/^chat-foundation-v\d+$/u),
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
    {
      message: 'Corpus requires 10 development and 10 validation cases',
    },
  )
  .refine(
    ({ version, cases }) =>
      version !== 'chat-foundation-v2' ||
      cases.every(({ criteria }) =>
        criteria.expectedAspects.every((aspect) =>
          (criteria.referenceEvidence ?? []).some(
            (reference) => reference.aspect === aspect,
          ),
        ),
      ),
    {
      message:
        'Corpus v2 requires paragraph evidence for every expected aspect',
    },
  );

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
export type EvidencePassage = z.infer<typeof EvidencePassageSchema>;
export type AuditUnit = z.infer<typeof AuditUnitSchema>;
export type AnswerAxis = z.infer<typeof AnswerAxisSchema>;
export type AnswerPlan = z.infer<typeof AnswerPlanSchema>;
export type AnswerAudit = z.infer<typeof AnswerAuditSchema>;
export type FrozenPage = z.infer<typeof FrozenPageSchema>;
export type ChatEvalCase = z.infer<typeof ChatEvalCaseSchema>;
export type Corpus = z.infer<typeof CorpusSchema>;

export function validateAuditReferences(
  audit: AnswerAudit,
  units: AuditUnit[],
  passages: EvidencePassage[],
  axes: AnswerAxis[] = [],
): AnswerAudit {
  const unitIds = new Set(units.map(({ id }) => id));
  const passageIds = new Set(passages.map(({ id }) => id));
  for (const unit of audit.units) {
    if (!unitIds.has(unit.unitId)) throw new Error('AUDIT_UNKNOWN_UNIT');
    if (unit.passageIds.some((id) => !passageIds.has(id)))
      throw new Error('AUDIT_UNKNOWN_PASSAGE');
    if (unit.verdict === 'supported' && unit.passageIds.length === 0)
      throw new Error('AUDIT_SUPPORTED_WITHOUT_PASSAGE');
    if (unit.verdict === 'contradicted' && unit.passageIds.length === 0)
      throw new Error('AUDIT_CONTRADICTION_WITHOUT_PASSAGE');
    if (unit.verdict === 'not_factual' && unit.passageIds.length !== 0)
      throw new Error('AUDIT_NON_FACTUAL_WITH_PASSAGE');
  }
  if (audit.units.length !== units.length)
    throw new Error('AUDIT_INCOMPLETE_UNITS');
  const byId = new Map(audit.units.map((unit) => [unit.unitId, unit]));
  if (units.some(({ id }) => !byId.has(id)))
    throw new Error('AUDIT_INCOMPLETE_UNITS');
  const axisIds = new Set(axes.map(({ id }) => id));
  if (axes.length && audit.axes.length !== axes.length)
    throw new Error('AUDIT_INCOMPLETE_AXES');
  for (const axis of audit.axes) {
    if (!axisIds.has(axis.axisId)) throw new Error('AUDIT_UNKNOWN_AXIS');
    if (axis.passageIds.some((id) => !passageIds.has(id)))
      throw new Error('AUDIT_UNKNOWN_PASSAGE');
    if (axis.coverage === 'covered' && axis.passageIds.length === 0)
      throw new Error('AUDIT_COVERED_AXIS_WITHOUT_PASSAGE');
    if (
      axis.coverage === 'covered' &&
      !axis.passageIds.some((id) =>
        audit.units.some(
          (unit) =>
            unit.verdict === 'supported' && unit.passageIds.includes(id),
        ),
      )
    )
      throw new Error('AUDIT_COVERED_AXIS_WITHOUT_SUPPORTED_UNIT');
  }
  return {
    ...audit,
    units: units.map(({ id }) => byId.get(id)!),
    axes: axes.length
      ? axes.map(({ id }) => audit.axes.find(({ axisId }) => axisId === id)!)
      : audit.axes,
  };
}

const AnswerAuditOutputSchema = z.strictObject({
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
      }),
    )
    .max(100),
  axes: z
    .array(
      z.strictObject({
        axisId: AxisIdSchema,
        coverage: z.enum(['covered', 'partial', 'missing']),
        passageIds: z.array(PassageIdSchema).max(12),
      }),
    )
    .max(5),
  usefulness: z.enum(['answers', 'partial', 'misses']),
  missingAspects: z.array(z.string().trim().min(1).max(300)).max(20),
  evidenceSufficiency: z.enum(['sufficient', 'insufficient']),
});

// The runtime output contract deliberately omits per-unit prose. Repeated
// reasons made otherwise valid audits exceed the bounded Ollama response on
// answers containing many short units. AnswerAuditSchema still accepts an
// optional reason when importing human-authored or historical fixtures.
export const AnswerAuditJsonSchema = z.toJSONSchema(AnswerAuditOutputSchema);
export const AnswerPlanJsonSchema = z.toJSONSchema(AnswerPlanSchema);
