import {
  AssistantConversationSchema,
  AssistantMessageSchema,
  AssistantSendMessageRequestSchema,
  type AssistantConversation,
  type AssistantMessage,
  type AssistantSendMessageRequest,
} from '@friday/contracts';

import { decryptJson, encryptJson } from '../crypto/vault.js';
import { fridayDb } from './friday-db.js';
import { getDeviceContext } from './task-repository.js';

const conversationAad = (id: string, deviceId: string) =>
  `assistant-conversation:${id}:${deviceId}`;
const messageAad = (id: string, deviceId: string) =>
  `assistant-message:${id}:${deviceId}`;
const outboxAad = (id: string, deviceId: string) =>
  `assistant-outbox:${id}:${deviceId}`;

export async function cacheAssistantState(
  conversations: AssistantConversation[],
  messages: AssistantMessage[] = [],
): Promise<void> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const conversationRows = await Promise.all(
    conversations.map(async (conversation) => ({
      id: conversation.id,
      profileId,
      archivedAt: conversation.archivedAt,
      updatedAt: conversation.updatedAt,
      encrypted: await encryptJson(
        key,
        conversation,
        conversationAad(conversation.id, deviceId),
      ),
    })),
  );
  const messageRows = await Promise.all(
    messages.map(async (message) => ({
      id: message.id,
      profileId,
      conversationId: message.conversationId,
      createdAt: message.createdAt,
      encrypted: await encryptJson(
        key,
        message,
        messageAad(message.id, deviceId),
      ),
    })),
  );
  await fridayDb.transaction(
    'rw',
    fridayDb.assistantConversations,
    fridayDb.assistantMessages,
    async () => {
      if (conversationRows.length > 0)
        await fridayDb.assistantConversations.bulkPut(conversationRows);
      if (messageRows.length > 0)
        await fridayDb.assistantMessages.bulkPut(messageRows);
    },
  );
}

export async function listCachedAssistantConversations(): Promise<
  AssistantConversation[]
> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const rows = await fridayDb.assistantConversations
    .where('profileId')
    .equals(profileId)
    .toArray();
  return Promise.all(
    rows
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(async (row) =>
        AssistantConversationSchema.parse(
          await decryptJson(
            key,
            row.encrypted,
            conversationAad(row.id, deviceId),
          ),
        ),
      ),
  );
}

export async function listCachedAssistantMessages(
  conversationId: string,
): Promise<AssistantMessage[]> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const rows = await fridayDb.assistantMessages
    .where('[profileId+conversationId]')
    .equals([profileId, conversationId])
    .sortBy('createdAt');
  return Promise.all(
    rows.map(async (row) =>
      AssistantMessageSchema.parse(
        await decryptJson(key, row.encrypted, messageAad(row.id, deviceId)),
      ),
    ),
  );
}

export async function queueAssistantMessage(
  conversationId: string,
  input: AssistantSendMessageRequest,
): Promise<void> {
  const parsed = AssistantSendMessageRequestSchema.parse(input);
  const { deviceId, key, profileId } = await getDeviceContext();
  await fridayDb.assistantOutbox.put({
    clientRequestId: parsed.clientRequestId,
    conversationId,
    profileId,
    createdAt: new Date().toISOString(),
    encrypted: await encryptJson(
      key,
      parsed,
      outboxAad(parsed.clientRequestId, deviceId),
    ),
  });
}

export async function listQueuedAssistantMessages(): Promise<
  Array<{ conversationId: string; input: AssistantSendMessageRequest }>
> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const rows = await fridayDb.assistantOutbox
    .where('profileId')
    .equals(profileId)
    .sortBy('createdAt');
  return Promise.all(
    rows.map(async (row) => ({
      conversationId: row.conversationId,
      input: parseQueuedAssistantInput(
        await decryptJson(
          key,
          row.encrypted,
          outboxAad(row.clientRequestId, deviceId),
        ),
      ),
    })),
  );
}

function parseQueuedAssistantInput(
  input: unknown,
): AssistantSendMessageRequest {
  if (
    input &&
    typeof input === 'object' &&
    'mode' in input &&
    input.mode === 'classic'
  ) {
    return AssistantSendMessageRequestSchema.parse({
      ...input,
      mode: 'local',
      thinkingPolicy: 'auto',
    });
  }
  return AssistantSendMessageRequestSchema.parse(input);
}

export async function removeQueuedAssistantMessage(
  clientRequestId: string,
): Promise<void> {
  await fridayDb.assistantOutbox.delete(clientRequestId);
}
