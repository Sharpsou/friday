import {
  AssistantConversationSchema,
  AssistantConversationsResponseSchema,
  AssistantMessagesResponseSchema,
  type AssistantConversation,
} from '@friday/contracts';

import {
  cacheAssistantState,
  listCachedAssistantConversations,
  listCachedAssistantMessages,
} from '../db/assistant-repository.js';

async function parse<T>(
  response: Response,
  schema: { parse(input: unknown): T },
): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : `Archive du Chat indisponible (${response.status.toString()}).`;
    throw new Error(message);
  }
  return schema.parse(payload);
}

export async function listAssistantConversations(): Promise<
  AssistantConversation[]
> {
  try {
    const result = await parse(
      await fetch('/api/assistant/conversations'),
      AssistantConversationsResponseSchema,
    );
    await cacheAssistantState(result.conversations);
    return result.conversations;
  } catch (error) {
    const cached = await listCachedAssistantConversations();
    if (cached.length > 0) return cached;
    throw error;
  }
}

export async function updateAssistantConversation(
  id: string,
  update: { archived?: boolean; title?: string },
): Promise<AssistantConversation> {
  const conversation = await parse(
    await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(update),
    }),
    AssistantConversationSchema,
  );
  await cacheAssistantState([conversation]);
  return conversation;
}

export async function deleteAssistantConversation(id: string): Promise<void> {
  const response = await fetch(
    `/api/assistant/conversations/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  if (!response.ok)
    throw new Error('Suppression de la conversation impossible.');
}

export async function getAssistantMessages(conversationId: string) {
  try {
    const result = await parse(
      await fetch(
        `/api/assistant/conversations/${encodeURIComponent(conversationId)}/messages`,
      ),
      AssistantMessagesResponseSchema,
    );
    await cacheAssistantState([result.conversation], result.messages);
    return result;
  } catch (error) {
    const [conversations, messages] = await Promise.all([
      listCachedAssistantConversations(),
      listCachedAssistantMessages(conversationId),
    ]);
    const conversation = conversations.find(
      (item) => item.id === conversationId,
    );
    if (conversation) return { conversation, messages };
    throw error;
  }
}
