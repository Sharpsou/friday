import type Database from 'better-sqlite3';

import {
  AssistantConversationSchema,
  AssistantMessageSchema,
  type AssistantConversation,
  type AssistantMessage,
} from '@friday/contracts';

interface ConversationRow {
  archived_at: string | null;
  created_at: string;
  id: string;
  title: string;
  updated_at: string;
}

interface MessageRow {
  content: string;
  conversation_id: string;
  created_at: string;
  id: string;
  role: 'assistant' | 'user';
  run_id: string | null;
}

interface SourceRow {
  domain: string;
  published_at: string | null;
  retrieved_at: string;
  source_id: string;
  title: string;
  url: string;
}

export class AssistantNotFoundError extends Error {}

/**
 * Accès d'archive au Chat retiré.
 *
 * Cette classe ne crée aucun run, ne contacte aucun modèle et n'effectue
 * aucune recherche réseau. Les tables historiques restent lisibles afin de ne
 * pas effacer les conversations privées existantes pendant la reconstruction.
 */
export class AssistantArchiveService {
  constructor(private readonly database: Database.Database) {}

  listConversations(profileId: string): AssistantConversation[] {
    return (
      this.database
        .prepare(
          `SELECT id, title, archived_at, created_at, updated_at
             FROM assistant_conversations
            WHERE profile_id = ?
            ORDER BY archived_at IS NOT NULL, updated_at DESC`,
        )
        .all(profileId) as ConversationRow[]
    ).map(toConversation);
  }

  getMessages(
    profileId: string,
    conversationId: string,
  ): { conversation: AssistantConversation; messages: AssistantMessage[] } {
    const conversation = this.requireConversation(profileId, conversationId);
    const rows = this.database
      .prepare(
        `SELECT id, conversation_id, role, content, run_id, created_at
           FROM assistant_messages
          WHERE profile_id = ? AND conversation_id = ?
          ORDER BY created_at, id`,
      )
      .all(profileId, conversationId) as MessageRow[];
    const sourceQuery = this.database.prepare(
      `SELECT source_id, title, url, domain, published_at, retrieved_at
         FROM assistant_sources
        WHERE run_id = ?
        ORDER BY CAST(SUBSTR(source_id, 2) AS INTEGER)`,
    );
    return {
      conversation,
      messages: rows.map((row) =>
        AssistantMessageSchema.parse({
          id: row.id,
          conversationId: row.conversation_id,
          role: row.role,
          content: row.content,
          sources: row.run_id
            ? (sourceQuery.all(row.run_id) as SourceRow[]).map((source) => ({
                id: source.source_id,
                title: source.title,
                url: source.url,
                domain: source.domain,
                publishedAt: source.published_at,
                retrievedAt: source.retrieved_at,
              }))
            : [],
          createdAt: row.created_at,
        }),
      ),
    };
  }

  updateConversation(
    profileId: string,
    conversationId: string,
    update: { archived?: boolean; title?: string },
  ): AssistantConversation {
    this.requireConversation(profileId, conversationId);
    const current = this.database
      .prepare(
        'SELECT title, archived_at FROM assistant_conversations WHERE id = ?',
      )
      .get(conversationId) as { archived_at: string | null; title: string };
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE assistant_conversations
            SET title = ?, archived_at = ?, updated_at = ?
          WHERE id = ? AND profile_id = ?`,
      )
      .run(
        update.title ?? current.title,
        update.archived === undefined
          ? current.archived_at
          : update.archived
            ? now
            : null,
        now,
        conversationId,
        profileId,
      );
    return this.requireConversation(profileId, conversationId);
  }

  deleteConversation(profileId: string, conversationId: string): void {
    this.requireConversation(profileId, conversationId);
    this.database
      .prepare(
        'DELETE FROM assistant_conversations WHERE id = ? AND profile_id = ?',
      )
      .run(conversationId, profileId);
  }

  private requireConversation(
    profileId: string,
    conversationId: string,
  ): AssistantConversation {
    const row = this.database
      .prepare(
        `SELECT id, title, archived_at, created_at, updated_at
           FROM assistant_conversations
          WHERE id = ? AND profile_id = ?`,
      )
      .get(conversationId, profileId) as ConversationRow | undefined;
    if (!row) throw new AssistantNotFoundError('Conversation introuvable.');
    return toConversation(row);
  }
}

function toConversation(row: ConversationRow): AssistantConversation {
  return AssistantConversationSchema.parse({
    id: row.id,
    title: row.title,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
