import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  pendingChatSend,
  acknowledgeChatSend,
  readPendingChatSend,
} from './chat-send.js';
import { fridayDb } from './friday-db.js';
import { resetDatabaseForTests } from './task-repository.js';
afterEach(async () => {
  await resetDatabaseForTests();
});
describe('uncertain Chat send', () => {
  it('keeps an encrypted stable identity across reload and requires resolution before another message', async () => {
    const first = await pendingChatSend('conversation', 'Question privée');
    fridayDb.close();
    await fridayDb.open();
    expect(await pendingChatSend('conversation', 'Question privée')).toBe(
      first,
    );
    expect(JSON.stringify(await fridayDb.settings.toArray())).not.toContain(
      'Question privée',
    );
    await expect(
      pendingChatSend('conversation', 'Autre question'),
    ).rejects.toThrow('CHAT_SEND_UNRESOLVED');
    expect(await readPendingChatSend('conversation')).toEqual({
      id: first,
      content: 'Question privée',
    });
    await acknowledgeChatSend('conversation', 'unrelated');
    expect((await readPendingChatSend('conversation'))?.id).toBe(first);
    await acknowledgeChatSend('conversation', first);
    expect(await pendingChatSend('conversation', 'Question privée')).not.toBe(
      first,
    );
  });
});
