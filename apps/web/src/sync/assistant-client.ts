import {
  AssistantConversationSchema,
  AssistantConversationsResponseSchema,
  AssistantExaUsageSchema,
  AssistantMessagesResponseSchema,
  AssistantResearchDiagnosticsResponseSchema,
  AssistantRunEventsResponseSchema,
  AssistantRunSchema,
  AssistantSearchConsentRequestSchema,
  AssistantSendMessageRequestSchema,
  AssistantSubmissionResponseSchema,
  AssistantWebUsageSchema,
  type AssistantConversation,
  type AssistantMode,
  type AssistantRun,
  type AssistantRunEvent,
  type AssistantSendMessageRequest,
} from '@friday/contracts';

import {
  cacheAssistantState,
  listCachedAssistantConversations,
  listCachedAssistantMessages,
  listQueuedAssistantMessages,
  queueAssistantMessage,
  removeQueuedAssistantMessage,
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
        : `Assistant indisponible (${response.status.toString()}).`;
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

export async function createAssistantConversation(
  title = 'Nouvelle conversation',
  mode: AssistantMode = 'local',
): Promise<AssistantConversation> {
  const conversation = await parse(
    await fetch('/api/assistant/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, mode }),
    }),
    AssistantConversationSchema,
  );
  await cacheAssistantState([conversation]);
  return conversation;
}

export async function updateAssistantConversation(
  id: string,
  update: { archived?: boolean; title?: string; mode?: AssistantMode },
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
    {
      method: 'DELETE',
    },
  );
  if (!response.ok) await parse(response, AssistantConversationSchema);
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
    if (conversation) return { conversation, messages, activeRun: null };
    throw error;
  }
}

export async function sendAssistantMessage(
  conversationId: string,
  input: AssistantSendMessageRequest,
) {
  const payload = AssistantSendMessageRequestSchema.parse(input);
  try {
    const result = await parse(
      await fetch(
        `/api/assistant/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      ),
      AssistantSubmissionResponseSchema,
    );
    await removeQueuedAssistantMessage(payload.clientRequestId);
    return result;
  } catch (error) {
    if (!navigator.onLine || error instanceof TypeError) {
      if (payload.mode === 'friday')
        throw new Error(
          'Le mode Friday nécessite le hub pour lire les données actuelles de la maison.',
          { cause: error },
        );
      await queueAssistantMessage(conversationId, payload);
      return null;
    }
    throw error;
  }
}

export async function flushAssistantOutbox(): Promise<void> {
  if (!navigator.onLine) return;
  for (const queued of await listQueuedAssistantMessages()) {
    const result = await sendAssistantMessage(
      queued.conversationId,
      queued.input,
    );
    if (!result) break;
  }
}

export async function hasQueuedAssistantMessages(): Promise<boolean> {
  return (await listQueuedAssistantMessages()).length > 0;
}

export async function getAssistantRun(runId: string): Promise<AssistantRun> {
  return parse(
    await fetch(`/api/assistant/runs/${encodeURIComponent(runId)}`),
    AssistantRunSchema,
  );
}

export async function getAssistantRunEvents(
  runId: string,
): Promise<AssistantRunEvent[]> {
  const result = await parse(
    await fetch(
      `/api/assistant/runs/${encodeURIComponent(runId)}/events?after=0`,
    ),
    AssistantRunEventsResponseSchema,
  );
  return result.events;
}

export async function cancelAssistantRun(runId: string): Promise<AssistantRun> {
  return parse(
    await fetch(`/api/assistant/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
    }),
    AssistantRunSchema,
  );
}

export async function retryAssistantRun(runId: string): Promise<AssistantRun> {
  return parse(
    await fetch(`/api/assistant/runs/${encodeURIComponent(runId)}/retry`, {
      method: 'POST',
    }),
    AssistantRunSchema,
  );
}

export async function submitAssistantSearchConsent(
  runId: string,
  approved: boolean,
  queries: string[],
): Promise<AssistantRun> {
  const payload = AssistantSearchConsentRequestSchema.parse({
    approved,
    queries,
  });
  return parse(
    await fetch(
      `/api/assistant/runs/${encodeURIComponent(runId)}/search-consent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    ),
    AssistantRunSchema,
  );
}

export async function getAssistantWebUsage() {
  return parse(
    await fetch('/api/assistant/web/usage'),
    AssistantWebUsageSchema,
  );
}

export async function getAssistantExaUsage() {
  return parse(
    await fetch('/api/assistant/web/exa-usage'),
    AssistantExaUsageSchema,
  );
}

export async function getAssistantResearchDiagnostics(conversationId: string) {
  return parse(
    await fetch(
      `/api/assistant/conversations/${encodeURIComponent(conversationId)}/research-diagnostics`,
    ),
    AssistantResearchDiagnosticsResponseSchema,
  );
}
