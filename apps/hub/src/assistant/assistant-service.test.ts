import { afterEach, describe, expect, it } from 'vitest';

import {
  AssistantArchiveService,
  AssistantNotFoundError,
} from './assistant-service.js';
import { openDatabase } from '../db/database.js';

const PROFILE_ONE = 'f61f8f8b-8d09-4575-8e83-357618e881ac';
const PROFILE_TWO = '6b0db27d-443d-4dd2-9a21-b809384f2f13';
const CONVERSATION_ID = '41bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
const MESSAGE_ID = '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
const databases: ReturnType<typeof openDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function makeArchive() {
  const database = openDatabase(':memory:');
  databases.push(database);
  const now = '2026-08-30T12:00:00.000Z';
  database
    .prepare(
      `INSERT INTO assistant_conversations(
        id, profile_id, title, archived_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?)`,
    )
    .run(CONVERSATION_ID, PROFILE_ONE, 'Historique privé', now, now);
  database
    .prepare(
      `INSERT INTO assistant_messages(
        id, conversation_id, profile_id, role, content, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      MESSAGE_ID,
      CONVERSATION_ID,
      PROFILE_ONE,
      'user',
      'Question historique',
      now,
    );
  return { service: new AssistantArchiveService(database) };
}

describe('AssistantArchiveService', () => {
  it('keeps the private history readable without exposing legacy modes', () => {
    const { service } = makeArchive();

    expect(service.listConversations(PROFILE_ONE)).toEqual([
      expect.objectContaining({
        id: CONVERSATION_ID,
        title: 'Historique privé',
      }),
    ]);
    expect(service.getMessages(PROFILE_ONE, CONVERSATION_ID).messages).toEqual([
      expect.objectContaining({
        content: 'Question historique',
        role: 'user',
        sources: [],
      }),
    ]);
    expect(service.listConversations(PROFILE_TWO)).toEqual([]);
    expect(() => service.getMessages(PROFILE_TWO, CONVERSATION_ID)).toThrow(
      AssistantNotFoundError,
    );
  });

  it('maintains archive metadata and deletion only for the owner', () => {
    const { service } = makeArchive();

    const archived = service.updateConversation(PROFILE_ONE, CONVERSATION_ID, {
      archived: true,
      title: 'Archive renommée',
    });
    expect(archived.title).toBe('Archive renommée');
    expect(archived.archivedAt).not.toBeNull();
    expect(() =>
      service.deleteConversation(PROFILE_TWO, CONVERSATION_ID),
    ).toThrow(AssistantNotFoundError);

    service.deleteConversation(PROFILE_ONE, CONVERSATION_ID);
    expect(service.listConversations(PROFILE_ONE)).toEqual([]);
  });
});
