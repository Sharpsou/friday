import { ChatPendingSendSchema } from '@friday/contracts';
import {
  decryptJson,
  encryptJson,
  type EncryptedEnvelope,
} from '../crypto/vault.js';
import { getDeviceContext } from './device-context.js';
import { fridayDb } from './friday-db.js';

export async function pendingChatSend(
  conversationId: string,
  content: string,
): Promise<string> {
  const { profileId, deviceId, key } = await getDeviceContext();
  const storageKey = `chat-send:${profileId}:${conversationId}`;
  const aad = `${storageKey}:${deviceId}`;
  const saved = await fridayDb.settings.get(storageKey);
  if (saved) {
    const value = ChatPendingSendSchema.parse(
      await decryptJson(key, saved.value as EncryptedEnvelope, aad),
    );
    if (value.content !== content) throw new Error('CHAT_SEND_UNRESOLVED');
    return value.id;
  }
  const value = { id: crypto.randomUUID(), content };
  const encrypted = await encryptJson(key, value, aad);
  // A unique settings key also serializes competing browser tabs.
  try {
    await fridayDb.settings.add({ key: storageKey, value: encrypted });
  } catch (error) {
    if (error instanceof Error && error.name === 'ConstraintError')
      return pendingChatSend(conversationId, content);
    throw error;
  }
  return value.id;
}
export async function readPendingChatSend(conversationId: string) {
  const { profileId, deviceId, key } = await getDeviceContext();
  const storageKey = `chat-send:${profileId}:${conversationId}`;
  const row = await fridayDb.settings.get(storageKey);
  return row
    ? ChatPendingSendSchema.parse(
        await decryptJson(
          key,
          row.value as EncryptedEnvelope,
          `${storageKey}:${deviceId}`,
        ),
      )
    : null;
}

export async function acknowledgeChatSend(
  conversationId: string,
  requestId: string,
) {
  const { profileId } = await getDeviceContext();
  const storageKey = `chat-send:${profileId}:${conversationId}`;
  const row = await fridayDb.settings.get(storageKey);
  const pending = await readPendingChatSend(conversationId);
  if (!row || pending?.id !== requestId) return;
  await fridayDb.transaction('rw', fridayDb.settings, async () => {
    const current = await fridayDb.settings.get(storageKey);
    // A delayed response in another tab must not remove a newer request.
    if (JSON.stringify(current?.value) === JSON.stringify(row.value))
      await fridayDb.settings.delete(storageKey);
  });
}
