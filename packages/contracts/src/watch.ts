import { z } from 'zod';
import { UtcInstantSchema, UuidSchema } from './common.ts';

export const WatchCadenceSchema = z.enum(['daily', 'weekly']);

export const WatchStatusSchema = z.enum(['active', 'paused']);

export const WatchNoveltySchema = z.enum(['new', 'evolution', 'confirmation']);

export const WatchConceptStateSchema = z.enum([
  'tracked',
  'secondary',
  'muted',
]);

export const WatchTopicEventKindSchema = z.enum([
  'new_topic',
  'major_update',
  'additional_detail',
  'confirmation',
  'contradiction',
  'duplicate',
  'noise',
]);

export const WatchSourceKindSchema = z.enum([
  'official',
  'research',
  'specialized_press',
  'general_press',
  'community',
]);

export const WatchRunStageSchema = z.enum([
  'queued',
  'discovering',
  'collecting',
  'extracting',
  'clustering',
  'synthesizing',
  'completed',
  'failed',
]);

export const WatchRunTriggerSchema = z.enum([
  'initialization',
  'scheduled',
  'catch_up',
  'manual',
  'resume',
]);

export const WatchArticleStateValueSchema = z.enum([
  'unread',
  'read',
  'useful',
  'follow_up',
  'hidden',
]);

export const WatchSourceSchema = z
  .object({
    id: UuidSchema,
    title: z.string().trim().min(1).max(160),
    siteUrl: z.string().url(),
    feedUrl: z.string().url(),
    lastFetchedAt: UtcInstantSchema.nullable(),
    lastError: z.string().max(500).nullable(),
  })
  .strict();

export const WatchSourceCandidateSchema = z
  .object({
    id: UuidSchema,
    title: z.string().trim().min(1).max(300),
    siteUrl: z.string().url(),
    feedUrl: z.string().url().nullable(),
    kind: WatchSourceKindSchema,
    language: z.string().trim().min(2).max(12),
    score: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(500),
    status: z.enum(['validated', 'rejected']),
  })
  .strict();

export const WatchThemeProposalSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    summary: z.string().trim().min(3).max(500),
  })
  .strict();

export const WatchDiscoverySchema = z
  .object({
    id: UuidSchema,
    concepts: z.array(z.string().trim().min(1).max(80)).max(20),
    themes: z.array(WatchThemeProposalSchema).min(5).max(8),
    candidates: z.array(WatchSourceCandidateSchema).max(40),
    examinedCount: z.number().int().nonnegative(),
    validatedCount: z.number().int().nonnegative(),
    creditsUsed: z.number().int().nonnegative(),
    createdAt: UtcInstantSchema,
  })
  .strict();

export const WatchConceptSchema = z
  .object({
    id: UuidSchema,
    watchId: UuidSchema,
    label: z.string().trim().min(1).max(80),
    state: WatchConceptStateSchema,
    origin: z.enum(['user', 'assistant']),
    articleCount: z.number().int().nonnegative(),
    firstSeenAt: UtcInstantSchema,
    lastSeenAt: UtcInstantSchema,
  })
  .strict();

export const WatchTopicSchema = z
  .object({
    id: UuidSchema,
    watchId: UuidSchema,
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().max(4_000),
    eventKind: WatchTopicEventKindSchema,
    importance: z.number().min(0).max(1),
    articleIds: z.array(UuidSchema).max(30),
    conceptIds: z.array(UuidSchema).max(20),
    firstSeenAt: UtcInstantSchema,
    lastSeenAt: UtcInstantSchema,
  })
  .strict();

export const WatchRunProgressSchema = z
  .object({
    id: UuidSchema,
    watchId: UuidSchema,
    trigger: WatchRunTriggerSchema.default('scheduled'),
    stage: WatchRunStageSchema,
    current: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    error: z.string().max(500).nullable(),
    updatedAt: UtcInstantSchema,
  })
  .strict();

export const WatchSchema = z
  .object({
    id: UuidSchema,
    name: z.string().trim().min(1).max(80),
    question: z.string().trim().min(1).max(500),
    includeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    concepts: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    languages: z
      .array(z.string().trim().min(2).max(12))
      .min(1)
      .max(4)
      .default(['fr', 'en']),
    cadence: WatchCadenceSchema,
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
    weekday: z.number().int().min(1).max(7).nullable(),
    timeZone: z.string().trim().min(1).max(80),
    status: WatchStatusSchema,
    sources: z.array(WatchSourceSchema).max(15),
    nextDigestAt: UtcInstantSchema,
    createdAt: UtcInstantSchema,
    updatedAt: UtcInstantSchema,
  })
  .strict();

export const WatchArticleSchema = z
  .object({
    id: UuidSchema,
    watchId: UuidSchema,
    sourceId: UuidSchema,
    sourceTitle: z.string().min(1).max(160),
    title: z.string().min(1).max(500),
    url: z.string().url(),
    publishedAt: UtcInstantSchema.nullable(),
    collectedAt: UtcInstantSchema,
    excerpt: z.string().max(8_000),
    summary: z.string().max(4_000).nullable(),
    relevanceReason: z.string().max(500).nullable(),
    novelty: WatchNoveltySchema.nullable(),
    relevant: z.boolean(),
    baseline: z.boolean(),
    state: WatchArticleStateValueSchema,
  })
  .strict();

export const WatchDigestSchema = z
  .object({
    id: UuidSchema,
    watchId: UuidSchema,
    title: z.string().min(1).max(160),
    summary: z.string().max(8_000),
    articleIds: z.array(UuidSchema).max(10),
    newCount: z.number().int().nonnegative(),
    createdAt: UtcInstantSchema,
  })
  .strict();

export const WatchOverviewSchema = z
  .object({
    watches: z.array(WatchSchema),
    articles: z.array(WatchArticleSchema),
    digests: z.array(WatchDigestSchema),
    unreadRelevantCount: z.number().int().nonnegative(),
    concepts: z.array(WatchConceptSchema).default([]),
    topics: z.array(WatchTopicSchema).default([]),
    runs: z.array(WatchRunProgressSchema).default([]),
  })
  .strict();

export const WatchDiscoveryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    question: z.string().trim().min(3).max(500),
    includeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    languages: z.array(z.string().trim().min(2).max(12)).min(1).max(4),
  })
  .strict();

const WatchCreateRequestObjectSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    question: z.string().trim().min(1).max(500),
    includeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
    concepts: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    themes: z.array(WatchThemeProposalSchema).max(8).optional(),
    languages: z
      .array(z.string().trim().min(2).max(12))
      .min(1)
      .max(4)
      .default(['fr', 'en']),
    cadence: WatchCadenceSchema,
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
    weekday: z.number().int().min(1).max(7).nullable(),
    timeZone: z.string().trim().min(1).max(80).default('Europe/Paris'),
    sources: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(160),
            siteUrl: z.string().url(),
            feedUrl: z.string().url(),
          })
          .strict(),
      )
      .min(1)
      .max(15),
  })
  .strict();

export const WatchCreateRequestSchema =
  WatchCreateRequestObjectSchema.superRefine((value, context) => {
    if (value.cadence === 'weekly' && value.weekday === null)
      context.addIssue({ code: 'custom', message: 'weekday_required' });
  });

export const WatchUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    question: z.string().trim().min(1).max(500).optional(),
    includeKeywords: z
      .array(z.string().trim().min(1).max(80))
      .max(30)
      .optional(),
    excludeKeywords: z
      .array(z.string().trim().min(1).max(80))
      .max(30)
      .optional(),
    concepts: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    languages: z
      .array(z.string().trim().min(2).max(12))
      .min(1)
      .max(4)
      .optional(),
    cadence: WatchCadenceSchema.optional(),
    localTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
      .optional(),
    weekday: z.number().int().min(1).max(7).nullable().optional(),
    timeZone: z.string().trim().min(1).max(80).optional(),
    sources: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(160),
            siteUrl: z.string().url(),
            feedUrl: z.string().url(),
          })
          .strict(),
      )
      .min(1)
      .max(15)
      .optional(),
    status: WatchStatusSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.cadence === 'weekly' && value.weekday == null)
      context.addIssue({ code: 'custom', message: 'weekday_required' });
  });

export const WatchSourceValidateRequestSchema = z
  .object({ url: z.string().url().max(2_000) })
  .strict();

export const WatchAddDiscoveredSourcesRequestSchema = z
  .object({
    discoveryId: UuidSchema,
    candidateIds: z.array(UuidSchema).min(1).max(15),
  })
  .strict();

export const WatchAddDiscoveredSourcesResponseSchema = z
  .object({
    watch: WatchSchema,
    addedCount: z.number().int().nonnegative().max(15),
  })
  .strict();

export const WatchArticleStateRequestSchema = z
  .object({
    operationId: UuidSchema,
    state: WatchArticleStateValueSchema,
    exclusionKeyword: z.string().trim().min(1).max(80).nullable().default(null),
  })
  .strict();

export const WatchConceptStateRequestSchema = z
  .object({
    operationId: UuidSchema,
    state: WatchConceptStateSchema,
  })
  .strict();

export type WatchCadence = z.infer<typeof WatchCadenceSchema>;

export type WatchStatus = z.infer<typeof WatchStatusSchema>;

export type WatchNovelty = z.infer<typeof WatchNoveltySchema>;

export type WatchConceptState = z.infer<typeof WatchConceptStateSchema>;

export type WatchTopicEventKind = z.infer<typeof WatchTopicEventKindSchema>;

export type WatchSourceKind = z.infer<typeof WatchSourceKindSchema>;

export type WatchRunStage = z.infer<typeof WatchRunStageSchema>;

export type WatchRunTrigger = z.infer<typeof WatchRunTriggerSchema>;

export type WatchArticleStateValue = z.infer<
  typeof WatchArticleStateValueSchema
>;

export type WatchSource = z.infer<typeof WatchSourceSchema>;

export type Watch = z.infer<typeof WatchSchema>;

export type WatchArticle = z.infer<typeof WatchArticleSchema>;

export type WatchDigest = z.infer<typeof WatchDigestSchema>;

export type WatchOverview = z.infer<typeof WatchOverviewSchema>;

export type WatchConcept = z.infer<typeof WatchConceptSchema>;

export type WatchTopic = z.infer<typeof WatchTopicSchema>;

export type WatchRunProgress = z.infer<typeof WatchRunProgressSchema>;

export type WatchDiscovery = z.infer<typeof WatchDiscoverySchema>;

export type WatchThemeProposal = z.infer<typeof WatchThemeProposalSchema>;

export type WatchDiscoveryRequest = z.infer<typeof WatchDiscoveryRequestSchema>;

export type WatchCreateRequest = z.infer<typeof WatchCreateRequestSchema>;

export type WatchAddDiscoveredSourcesRequest = z.infer<
  typeof WatchAddDiscoveredSourcesRequestSchema
>;
