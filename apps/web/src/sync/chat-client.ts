import { pendingChatSend, acknowledgeChatSend } from '../db/chat-send.js';
export { acknowledgeChatSend, readPendingChatSend } from '../db/chat-send.js';
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

export interface ChatAvailability {
  status: 'ready' | 'offline' | 'disabled' | 'auth-required';
  cacheWarning: boolean;
}
let availability: ChatAvailability = { status: 'ready', cacheWarning: false };
export function getChatAvailability(): ChatAvailability {
  return availability;
}
function announce(update: Partial<ChatAvailability>): void {
  availability = { ...availability, ...update };
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event('friday-chat-availability'));
}
class ChatHttpError extends Error {
  constructor(
    readonly status: number,
    code: string,
  ) {
    super(code);
  }
}
function allowsCachedRead(error: unknown): boolean {
  if (error instanceof ChatHttpError) {
    if ([401, 403].includes(error.status)) {
      announce({ status: 'auth-required' });
      return false;
    }
    if (error.message === 'CHAT_DISABLED') {
      announce({ status: 'disabled' });
      return true;
    }
    if (error.status < 500) return false;
  } else if (!(error instanceof TypeError)) return false;
  announce({ status: 'offline' });
  return true;
}
async function cacheWithoutRejecting(
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
    announce({ cacheWarning: false });
  } catch {
    announce({ cacheWarning: true });
  }
}

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
    throw new ChatHttpError(
      response.status,
      code === 'chat_disabled'
        ? 'CHAT_DISABLED'
        : code || `CHAT_HTTP_${response.status.toString()}`,
    );
  }
  return schema.parse(payload);
}

export async function listChatConversations(): Promise<ChatConversation[]> {
  try {
    const result = await parse(
      await fetch('/api/chat/conversations'),
      ChatConversationsResponseSchema,
    );
    announce({ status: 'ready' });
    await cacheWithoutRejecting(() =>
      cacheChatState(result.conversations, [], true),
    );
    return result.conversations;
  } catch (error) {
    if (!allowsCachedRead(error)) throw error;
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
  await cacheWithoutRejecting(() => cacheChatState([result]));
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
  await cacheWithoutRejecting(() => cacheChatState([result]));
  return result;
}

export async function deleteChatConversation(id: string): Promise<void> {
  await parse(
    await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
    ChatDeleteResponseSchema,
  );
  await cacheWithoutRejecting(() => deleteCachedChatConversation(id));
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
    announce({ status: 'ready' });
    await cacheWithoutRejecting(() =>
      cacheChatState([result.conversation], result.messages),
    );
    return result;
  } catch (error) {
    if (error instanceof ChatHttpError && error.status === 404)
      await deleteCachedChatConversation(conversationId);
    if (!allowsCachedRead(error)) throw error;
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
): Promise<{ runId: string; clientRequestId: string }> {
  if (!navigator.onLine) throw new Error('CHAT_OFFLINE');
  const clientRequestId = await pendingChatSend(conversationId, content);
  try {
    const result = await parse(
      await fetch(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            clientRequestId,
            content,
          }),
        },
      ),
      ChatEnqueueResponseSchema,
    );
    return { runId: result.runId, clientRequestId };
  } catch (error) {
    if (
      error instanceof ChatHttpError &&
      [400, 401, 403, 404, 429].includes(error.status)
    )
      await acknowledgeChatSend(conversationId, clientRequestId);
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
