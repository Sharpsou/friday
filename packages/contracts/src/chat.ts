import { z } from 'zod';
import { UuidSchema } from './common.ts';

export const ChatAnswerStatusSchema = z.enum([
  'unverified',
  'verified',
  'partial',
  'abstained',
  'audit_error',
]);

export const ChatRetrievalModeSchema = z.enum([
  'none',
  'hybrid',
  'lexical_fallback',
]);

export const ChatRouteSchema = z.enum(['local_unverified', 'web_verified']);

export const ChatModeSchema = z.enum(['friday', 'local', 'web']);

export const ChatRunStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const ChatRunStageSchema = z.enum([
  'queued',
  'routing',
  'research',
  'writing',
  'auditing',
  'finalizing',
  'completed',
]);

export const ChatSourceSchema = z
  .object({
    id: z.string().regex(/^S[1-9]\d*$/u),
    title: z.string().trim().min(1).max(500),
    url: z
      .string()
      .url()
      .max(2_048)
      .refine((url) => url.startsWith('https://'), 'HTTPS URL required'),
    domain: z.string().trim().min(1).max(253),
    publishedAt: z.string().datetime().nullable(),
    retrievedAt: z.string().datetime(),
    evidenceLevel: z.enum(['readable', 'discovery_only']).default('readable'),
  })
  .strict();

export const ChatConversationSchema = z
  .object({
    id: UuidSchema,
    title: z.string().trim().min(1).max(120),
    mode: ChatModeSchema,
    archivedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ChatMessageSchema = z
  .object({
    id: UuidSchema,
    conversationId: UuidSchema,
    role: z.enum(['user', 'assistant']),
    content: z.string().max(100_000),
    answerStatus: ChatAnswerStatusSchema.nullable(),
    route: ChatRouteSchema.nullable(),
    sources: z.array(ChatSourceSchema).max(12),
    createdAt: z.string().datetime(),
  })
  .strict();

export const ChatRunSchema = z
  .object({
    outcome: z
      .enum([
        'pending',
        'complete',
        'partial',
        'clarification',
        'abstained',
        'interrupted',
        'unverified',
      ])
      .optional(),
    id: UuidSchema,
    conversationId: UuidSchema,
    status: ChatRunStatusSchema,
    stage: ChatRunStageSchema,
    route: ChatRouteSchema.nullable(),
    requestedMode: ChatModeSchema,
    retrievalMode: ChatRetrievalModeSchema,
    errorCode: z
      .string()
      .regex(/^[A-Z0-9_]+$/u)
      .nullable(),
    axisCount: z.number().int().min(0).max(5),
    requiredAxisCount: z.number().int().min(0).max(5),
    coveredAxisCount: z.number().int().min(0).max(5),
    rejectedUnitCount: z.number().int().min(0).max(100),
    discoveredPageCount: z.number().int().min(0).max(100).default(0),
    readablePageCount: z.number().int().min(0).max(20).default(0),
    rejectedPageCount: z.number().int().min(0).max(100).default(0),
    leadCount: z.number().int().min(0).max(4).default(0),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ChatCreateConversationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    mode: ChatModeSchema.optional(),
  })
  .strict();

export const ChatUpdateConversationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    mode: ChatModeSchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export const ChatSendMessageRequestSchema = z
  .object({
    clientRequestId: UuidSchema,
    content: z.string().trim().min(1).max(8_000),
  })
  .strict();

export const ChatConversationsResponseSchema = z
  .object({ conversations: z.array(ChatConversationSchema) })
  .strict();

export const ChatMessagesResponseSchema = z
  .object({
    conversation: ChatConversationSchema,
    messages: z.array(ChatMessageSchema),
  })
  .strict();

export const ChatEnqueueResponseSchema = z
  .object({ runId: UuidSchema })
  .strict();

export const ChatActiveRunResponseSchema = z
  .object({ run: ChatRunSchema.nullable() })
  .strict();

export const ChatDeleteResponseSchema = z
  .object({ deleted: z.literal(true) })
  .strict();

export const ChatWebUsageSchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/u),
    creditsUsed: z.number().int().nonnegative(),
    remainingSearches: z.number().int().nonnegative(),
    source: z.enum(['tavily', 'unavailable']),
    hardLimit: z.number().int().positive(),
  })
  .strict();

export type ChatAnswerStatus = z.infer<typeof ChatAnswerStatusSchema>;

export type ChatRetrievalMode = z.infer<typeof ChatRetrievalModeSchema>;

export type ChatRoute = z.infer<typeof ChatRouteSchema>;

export type ChatMode = z.infer<typeof ChatModeSchema>;

export type ChatRunStatus = z.infer<typeof ChatRunStatusSchema>;

export type ChatRunStage = z.infer<typeof ChatRunStageSchema>;

export type ChatSource = z.infer<typeof ChatSourceSchema>;

export type ChatConversation = z.infer<typeof ChatConversationSchema>;

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export type ChatRun = z.infer<typeof ChatRunSchema>;

export type ChatWebUsage = z.infer<typeof ChatWebUsageSchema>;

export type ChatSendMessageRequest = z.infer<
  typeof ChatSendMessageRequestSchema
>;

export const ChatPendingSendSchema = z.object({
  id: z.uuid(),
  content: z.string().max(8000),
});
