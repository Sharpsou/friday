import { z } from 'zod';
import { UtcInstantSchema, UuidSchema } from './common.ts';

export const AssistantConversationSchema = z.object({
  id: UuidSchema,
  title: z.string().trim().min(1).max(80),
  archivedAt: UtcInstantSchema.nullable(),
  createdAt: UtcInstantSchema,
  updatedAt: UtcInstantSchema,
});

export const AssistantSourceSchema = z
  .object({
    id: z.string().regex(/^S[1-9]\d*$/u),
    title: z.string().min(1).max(500),
    url: z.string().url(),
    domain: z.string().min(1).max(255),
    publishedAt: UtcInstantSchema.nullable(),
    retrievedAt: UtcInstantSchema,
  })
  .strict();

export const AssistantMessageSchema = z.object({
  id: UuidSchema,
  conversationId: UuidSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string().max(100_000),
  sources: z.array(AssistantSourceSchema),
  createdAt: UtcInstantSchema,
});

export const AssistantUpdateConversationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.archived !== undefined);

export const AssistantConversationsResponseSchema = z
  .object({ conversations: z.array(AssistantConversationSchema) })
  .strict();

export const AssistantMessagesResponseSchema = z
  .object({
    conversation: AssistantConversationSchema,
    messages: z.array(AssistantMessageSchema),
  })
  .strict();

export type AssistantConversation = z.infer<typeof AssistantConversationSchema>;

export type AssistantSource = z.infer<typeof AssistantSourceSchema>;

export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
