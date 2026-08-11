import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cacheAssistantState,
  listCachedAssistantConversations,
  listCachedAssistantMessages,
  listQueuedAssistantMessages,
  queueAssistantMessage,
  removeQueuedAssistantMessage,
} from './assistant-repository.js';
import { fridayDb } from './friday-db.js';
import { resetDatabaseForTests } from './task-repository.js';

beforeEach(async () => {
  await fridayDb.open();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe('Assistant local encrypted repository', () => {
  it('caches conversations and messages without retaining plaintext', async () => {
    const conversation = {
      id: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      mode: 'local' as const,
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
      requestedMode: 'classic' as const,
      effectiveMode: null,
      mode: 'local' as const,
      thinkingPolicy: 'auto' as const,
      thinkingUsed: false,
      researchOutcome: 'not_needed' as const,
      creditsUsed: 0,
      runId: '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      sources: [],
      progressEvents: [],
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

  it('persists an idempotent encrypted offline message until acknowledgement', async () => {
    const input = {
      clientRequestId: '41bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      content: 'Message hors ligne',
      mode: 'local' as const,
      thinkingPolicy: 'auto' as const,
    };
    const conversationId = '31bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
    await queueAssistantMessage(conversationId, input);
    await queueAssistantMessage(conversationId, input);

    expect(await listQueuedAssistantMessages()).toEqual([
      { conversationId, input },
    ]);
    expect(
      JSON.stringify(await fridayDb.assistantOutbox.get(input.clientRequestId)),
    ).not.toContain('Message hors ligne');

    await removeQueuedAssistantMessage(input.clientRequestId);
    expect(await listQueuedAssistantMessages()).toEqual([]);
  });
});
