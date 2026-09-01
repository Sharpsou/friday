import {
  ChatActiveRunResponseSchema,
  ChatConversationSchema,
  ChatConversationsResponseSchema,
  ChatEnqueueResponseSchema,
  ChatMessagesResponseSchema,
  ChatRunSchema,
  ChatDeleteResponseSchema,
  ChatWebUsageSchema,
  type ChatConversation,
  type ChatMode,
} from '@friday/contracts';

import {
  cacheChatState,
  deleteCachedChatConversation,
  listCachedChatConversations,
  listCachedChatMessages,
} from '../db/chat-repository.js';

async function parse<T>(
  response: Response,
  schema: { parse(input: unknown): T },
): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : '';
    if (code === 'chat_disabled') throw new Error('CHAT_DISABLED');
    throw new Error(code || `CHAT_HTTP_${response.status.toString()}`);
  }
  return schema.parse(payload);
}

export async function listChatConversations(): Promise<ChatConversation[]> {
  try {
    const result = await parse(
      await fetch('/api/chat/conversations'),
      ChatConversationsResponseSchema,
    );
    await cacheChatState(result.conversations);
    return result.conversations;
  } catch (error) {
    const cached = await listCachedChatConversations();
    if (cached.length) return cached;
    throw error;
  }
}

export async function createChatConversation(
  mode: ChatMode = 'friday',
): Promise<ChatConversation> {
  const result = await parse(
    await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    }),
    ChatConversationSchema,
  );
  await cacheChatState([result]);
  return result;
}

export async function updateChatConversation(
  id: string,
  update: { mode?: ChatMode; title?: string },
): Promise<ChatConversation> {
  const result = await parse(
    await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(update),
    }),
    ChatConversationSchema,
  );
  await cacheChatState([result]);
  return result;
}

export async function deleteChatConversation(id: string): Promise<void> {
  await parse(
    await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
    ChatDeleteResponseSchema,
  );
  await deleteCachedChatConversation(id);
}

export async function getChatWebUsage() {
  return parse(await fetch('/api/chat/web-usage'), ChatWebUsageSchema);
}

export async function getChatMessages(conversationId: string) {
  try {
    const result = await parse(
      await fetch(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
      ),
      ChatMessagesResponseSchema,
    );
    await cacheChatState([result.conversation], result.messages);
    return result;
  } catch (error) {
    const conversations = await listCachedChatConversations();
    const conversation = conversations.find(({ id }) => id === conversationId);
    if (conversation)
      return {
        conversation,
        messages: await listCachedChatMessages(conversationId),
      };
    throw error;
  }
}

export async function sendChatMessage(
  conversationId: string,
  content: string,
): Promise<string> {
  if (!navigator.onLine) throw new Error('CHAT_OFFLINE');
  try {
    const result = await parse(
      await fetch(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            clientRequestId: crypto.randomUUID(),
            content,
          }),
        },
      ),
      ChatEnqueueResponseSchema,
    );
    return result.runId;
  } catch (error) {
    if (!navigator.onLine || error instanceof TypeError)
      throw new Error('CHAT_OFFLINE', { cause: error });
    throw error;
  }
}

export async function getChatRun(runId: string) {
  return parse(
    await fetch(`/api/chat/runs/${encodeURIComponent(runId)}`),
    ChatRunSchema,
  );
}

export async function getChatActiveRun(conversationId: string) {
  const result = await parse(
    await fetch(
      `/api/chat/conversations/${encodeURIComponent(conversationId)}/active-run`,
    ),
    ChatActiveRunResponseSchema,
  );
  return result.run;
}

export async function cancelChatRun(runId: string): Promise<void> {
  await parse(
    await fetch(`/api/chat/runs/${encodeURIComponent(runId)}`, {
      method: 'DELETE',
    }),
    { parse: () => undefined },
  );
}
