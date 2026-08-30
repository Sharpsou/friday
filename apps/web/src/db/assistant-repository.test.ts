import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cacheAssistantState,
  listCachedAssistantConversations,
  listCachedAssistantMessages,
} from './assistant-repository.js';
import { fridayDb } from './friday-db.js';
import { resetDatabaseForTests } from './task-repository.js';

beforeEach(async () => {
  await fridayDb.open();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe('Chat encrypted archive cache', () => {
  it('caches historical data without retaining plaintext', async () => {
    const conversation = {
      id: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      title: 'Conversation secrète',
      archivedAt: null,
      createdAt: '2026-08-10T12:00:00.000Z',
      updatedAt: '2026-08-10T12:00:00.000Z',
    };
    const message = {
      id: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      conversationId: conversation.id,
      role: 'user' as const,
      content: 'Donnée très privée',
      sources: [],
      createdAt: '2026-08-10T12:00:01.000Z',
    };

    await cacheAssistantState([conversation], [message]);

    expect(await listCachedAssistantConversations()).toEqual([conversation]);
    expect(await listCachedAssistantMessages(conversation.id)).toEqual([
      message,
    ]);
    expect(
      JSON.stringify(await fridayDb.assistantMessages.get(message.id)),
    ).not.toContain('Donnée très privée');
  });
});
