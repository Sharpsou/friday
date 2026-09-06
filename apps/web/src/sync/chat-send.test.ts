import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sendChatMessage,
  acknowledgeChatSend,
  readPendingChatSend,
} from './chat-client.js';
import { fridayDb } from '../db/friday-db.js';
import { resetDatabaseForTests } from '../db/task-repository.js';
import { deleteCachedChatConversation } from '../db/chat-repository.js';

beforeEach(async () => {
  await fridayDb.open();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await resetDatabaseForTests();
});
const conversation = '56f8e391-9734-40d6-a531-c051310014c7';
const runId = '1a8f6b14-8eea-4b1b-bca5-c792d608f6d9';
describe('Chat send network recovery', () => {
  it('resends the same identity after a lost POST response and page reload', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const requests: Array<{ clientRequestId: string; content: string }> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      if (requests.length === 1)
        throw new TypeError('response lost after acceptance');
      return new Response(JSON.stringify({ runId }), { status: 202 });
    });
    await expect(
      sendChatMessage(conversation, 'Ma question privée'),
    ).rejects.toThrow('CHAT_OFFLINE');
    fridayDb.close();
    await fridayDb.open();
    const pending = await readPendingChatSend(conversation);
    expect(pending?.content).toBe('Ma question privée');
    const confirmed = await sendChatMessage(conversation, pending!.content);
    expect(requests[1]).toEqual(requests[0]);
    expect(confirmed.runId).toBe(runId);
    await acknowledgeChatSend(conversation, confirmed.clientRequestId);
    expect(await readPendingChatSend(conversation)).toBeNull();
  });
  it('clears a definitively rejected request and purges pending text with its conversation', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: 'invalid' }), { status: 400 }),
    );
    await expect(
      sendChatMessage(conversation, 'Question rejetée'),
    ).rejects.toThrow();
    expect(await readPendingChatSend(conversation)).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    await expect(
      sendChatMessage(conversation, 'Question corrigée'),
    ).rejects.toThrow();
    await deleteCachedChatConversation(conversation);
    expect(await readPendingChatSend(conversation)).toBeNull();
  });
});
