import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fridayDb } from './friday-db.js';
import { resetDatabaseForTests } from './task-repository.js';
import {
  cacheChatState,
  listCachedChatConversations,
} from './chat-repository.js';
import {
  getChatAvailability,
  getChatMessages,
  createChatConversation,
  updateChatConversation,
  deleteChatConversation,
  listChatConversations,
} from '../sync/chat-client.js';

const conversation = {
  id: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
  title: 'Privé',
  mode: 'local' as const,
  archivedAt: null,
  createdAt: '2026-09-05T10:00:00.000Z',
  updatedAt: '2026-09-05T10:00:00.000Z',
};
beforeEach(async () => {
  await fridayDb.open();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await resetDatabaseForTests();
});
describe('Chat cache reconciliation', () => {
  it('distinguishes an offline cached read from a successful reconnect', async () => {
    await cacheChatState([conversation]);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network unavailable');
    });
    expect(await listChatConversations()).toEqual([conversation]);
    expect(getChatAvailability().status).toBe('offline');
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ conversations: [conversation] })),
    );
    await listChatConversations();
    expect(getChatAvailability().status).toBe('ready');
  });

  it('purges a missing conversation instead of returning its cached history', async () => {
    await cacheChatState([conversation]);
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
    );
    await expect(getChatMessages(conversation.id)).rejects.toThrow('not_found');
    expect(await listCachedChatConversations()).toEqual([]);
  });

  it('does not report failed mutations after server success when the local cache fails', async () => {
    vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValue(
      new Error('storage unavailable'),
    );
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify(conversation)),
    );
    await expect(createChatConversation('local')).resolves.toEqual(
      conversation,
    );
    await expect(
      updateChatConversation(conversation.id, { title: conversation.title }),
    ).resolves.toEqual(conversation);
    vi.spyOn(fridayDb.chatConversations, 'delete').mockRejectedValue(
      new Error('storage unavailable'),
    );
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ deleted: true })),
    );
    await expect(
      deleteChatConversation(conversation.id),
    ).resolves.toBeUndefined();
    expect(getChatAvailability().cacheWarning).toBe(true);
  });

  it('encrypts outside the transaction even when Web Crypto is slow', async () => {
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return encrypt(...args);
    });
    await cacheChatState([conversation]);
    expect(await listCachedChatConversations()).toEqual([conversation]);
    expect(
      JSON.stringify(await fridayDb.chatConversations.toArray()),
    ).not.toContain('Privé');
  });
  it('removes remotely deleted conversations and messages on an empty snapshot', async () => {
    await cacheChatState(
      [conversation],
      [
        {
          id: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
          conversationId: conversation.id,
          role: 'user',
          content: 'Privé',
          answerStatus: null,
          route: null,
          sources: [],
          createdAt: conversation.createdAt,
        },
      ],
    );
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ conversations: [] })),
    );
    expect(await listChatConversations()).toEqual([]);
    expect(await fridayDb.chatMessages.count()).toBe(0);
    expect(await listCachedChatConversations()).toEqual([]);
  });
  it('keeps cached history explicitly read only when disabled and does not hide authentication errors', async () => {
    await cacheChatState([conversation]);
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: 'chat_disabled' }), {
          status: 503,
        }),
    );
    expect(await listChatConversations()).toEqual([conversation]);
    expect(getChatAvailability().status).toBe('disabled');
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
        }),
    );
    await expect(listChatConversations()).rejects.toThrow('unauthorized');
  });
  it('returns fresh server content when caching fails', async () => {
    vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValue(
      new Error('storage error'),
    );
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ conversations: [conversation] })),
    );
    expect(await listChatConversations()).toEqual([conversation]);
    expect(getChatAvailability().cacheWarning).toBe(true);
  });
});
