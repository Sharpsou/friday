import {
  ChatConversationSchema,
  ChatMessageSchema,
  type ChatConversation,
  type ChatMessage,
} from '@friday/contracts';

import { decryptJson, encryptJson } from '../crypto/vault.js';
import { fridayDb } from './friday-db.js';
import { getDeviceContext } from './task-repository.js';

const conversationAad = (id: string, deviceId: string) =>
  `chat-v2-conversation:${id}:${deviceId}`;
const messageAad = (id: string, deviceId: string) =>
  `chat-v2-message:${id}:${deviceId}`;

export async function cacheChatState(
  conversations: ChatConversation[],
  messages: ChatMessage[] = [],
): Promise<void> {
  const { deviceId, key, profileId } = await getDeviceContext();
  await fridayDb.transaction(
    'rw',
    fridayDb.chatConversations,
    fridayDb.chatMessages,
    async () => {
      if (conversations.length)
        await fridayDb.chatConversations.bulkPut(
          await Promise.all(
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
          ),
        );
      if (messages.length)
        await fridayDb.chatMessages.bulkPut(
          await Promise.all(
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
          ),
        );
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
    async () => {
      const messages = await fridayDb.chatMessages
        .where('[profileId+conversationId]')
        .equals([profileId, id])
        .primaryKeys();
      await fridayDb.chatMessages.bulkDelete(messages);
      await fridayDb.chatConversations.delete(id);
    },
  );
}
