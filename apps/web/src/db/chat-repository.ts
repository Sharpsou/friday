import {
  ChatConversationSchema,
  ChatMessageSchema,
  type ChatConversation,
  type ChatMessage,
} from '@friday/contracts';

import { decryptJson, encryptJson } from '../crypto/vault.js';
import { getDeviceContext } from './device-context.js';
import { fridayDb } from './friday-db.js';

const conversationAad = (id: string, deviceId: string) =>
  `chat-v2-conversation:${id}:${deviceId}`;
const messageAad = (id: string, deviceId: string) =>
  `chat-v2-message:${id}:${deviceId}`;

export async function cacheChatState(
  conversations: ChatConversation[],
  messages: ChatMessage[] = [],
  replaceSnapshot = false,
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
    fridayDb.chatConversations,
    fridayDb.chatMessages,
    fridayDb.settings,
    async () => {
      if (replaceSnapshot) {
        const ids = new Set(conversations.map(({ id }) => id));
        const removed = (
          await fridayDb.chatConversations
            .where('profileId')
            .equals(profileId)
            .primaryKeys()
        ).filter((id) => !ids.has(id));
        for (const id of removed)
          await fridayDb.chatMessages
            .where('[profileId+conversationId]')
            .equals([profileId, id])
            .delete();
        await fridayDb.chatConversations.bulkDelete(removed);
        await fridayDb.settings.bulkDelete(
          removed.map((id) => `chat-send:${profileId}:${id}`),
        );
      }
      if (conversationRows.length)
        await fridayDb.chatConversations.bulkPut(conversationRows);
      if (messageRows.length) await fridayDb.chatMessages.bulkPut(messageRows);
    },
  );
}

export async function listCachedChatConversations(): Promise<
  ChatConversation[]
> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const rows = await fridayDb.chatConversations
    .where('profileId')
    .equals(profileId)
    .toArray();
  return Promise.all(
    rows
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(async (row) =>
        ChatConversationSchema.parse(
          await decryptJson(
            key,
            row.encrypted,
            conversationAad(row.id, deviceId),
          ),
        ),
      ),
  );
}

export async function listCachedChatMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const rows = await fridayDb.chatMessages
    .where('[profileId+conversationId]')
    .equals([profileId, conversationId])
    .sortBy('createdAt');
  return Promise.all(
    rows.map(async (row) =>
      ChatMessageSchema.parse(
        await decryptJson(key, row.encrypted, messageAad(row.id, deviceId)),
      ),
    ),
  );
}

export async function deleteCachedChatConversation(id: string): Promise<void> {
  const { profileId } = await getDeviceContext();
  await fridayDb.transaction(
    'rw',
    fridayDb.chatConversations,
    fridayDb.chatMessages,
    fridayDb.settings,
    async () => {
      const messages = await fridayDb.chatMessages
        .where('[profileId+conversationId]')
        .equals([profileId, id])
        .primaryKeys();
      await fridayDb.chatMessages.bulkDelete(messages);
      await fridayDb.chatConversations.delete(id);
      await fridayDb.settings.delete(`chat-send:${profileId}:${id}`);
    },
  );
}
