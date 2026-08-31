import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import {
  ChatConversationSchema,
  ChatMessageSchema,
  ChatRunSchema,
  type ChatAnswerStatus,
  type ChatConversation,
  type ChatMessage,
  type ChatRetrievalMode,
  type ChatRoute,
  type ChatRun,
  type ChatRunStage,
  type ChatSource,
} from '@friday/contracts';

export interface ChatEngineInput {
  content: string;
  priorTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal: AbortSignal;
  updateStage(stage: ChatRunStage): void;
}

export interface ChatEngineResult {
  markdown: string;
  status: ChatAnswerStatus;
  route: ChatRoute;
  retrievalMode: ChatRetrievalMode;
  sources: ChatSource[];
  modelCalls: number;
  passageCount: number;
}

export interface ChatEngine {
  answer(input: ChatEngineInput): Promise<ChatEngineResult>;
}

interface ConversationRow {
  id: string;
  title: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  answer_status: ChatAnswerStatus | null;
  route: ChatRoute | null;
  created_at: string;
}

interface RunRow {
  id: string;
  conversation_id: string;
  status: ChatRun['status'];
  stage: ChatRunStage;
  route: ChatRoute | null;
  retrieval_mode: ChatRetrievalMode;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

interface PendingRunRow {
  id: string;
  profile_id: string;
  conversation_id: string;
  user_message_id: string;
  content: string;
}

export class ChatNotFoundError extends Error {}
export class ChatQueueFullError extends Error {}

function safeErrorCode(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError')
    return 'CANCELLED';
  if (!(error instanceof Error)) return 'CHAT_RUN_FAILED';
  const value = error.message.split(':', 1)[0] ?? '';
  return /^[A-Z0-9_]+$/u.test(value) ? value : 'CHAT_RUN_FAILED';
}

export class ChatService {
  private running = false;
  private stopped = true;
  private activeRun: { id: string; controller: AbortController } | undefined;

  constructor(
    private readonly database: Database.Database,
    private readonly engine: ChatEngine,
  ) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE chat_runs
            SET status = 'queued', stage = 'queued', updated_at = ?
          WHERE status = 'running'`,
      )
      .run(now);
  }

  start(): void {
    this.stopped = false;
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    this.activeRun?.controller.abort();
  }

  createConversation(
    profileId: string,
    title = 'Nouvelle conversation',
  ): ChatConversation {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO chat_conversations(id, profile_id, title, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      )
      .run(id, profileId, title, now, now);
    return this.requireConversation(profileId, id);
  }

  listConversations(profileId: string): ChatConversation[] {
    return (
      this.database
        .prepare(
          `SELECT id, title, archived_at, created_at, updated_at
             FROM chat_conversations WHERE profile_id = ?
             ORDER BY archived_at IS NOT NULL, updated_at DESC`,
        )
        .all(profileId) as ConversationRow[]
    ).map((row) => this.toConversation(row));
  }

  updateConversation(
    profileId: string,
    id: string,
    update: { title?: string; archived?: boolean },
  ): ChatConversation {
    const current = this.requireConversation(profileId, id);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE chat_conversations SET title = ?, archived_at = ?, updated_at = ?
          WHERE id = ? AND profile_id = ?`,
      )
      .run(
        update.title ?? current.title,
        update.archived === undefined
          ? current.archivedAt
          : update.archived
            ? now
            : null,
        now,
        id,
        profileId,
      );
    return this.requireConversation(profileId, id);
  }

  deleteConversation(profileId: string, id: string): void {
    this.requireConversation(profileId, id);
    const active = this.database
      .prepare(
        `SELECT id FROM chat_runs
          WHERE profile_id = ? AND conversation_id = ? AND status = 'running'`,
      )
      .get(profileId, id) as { id: string } | undefined;
    if (active && this.activeRun?.id === active.id) {
      this.activeRun.controller.abort();
    }
    this.database
      .prepare('DELETE FROM chat_conversations WHERE id = ? AND profile_id = ?')
      .run(id, profileId);
  }

  getMessages(
    profileId: string,
    conversationId: string,
  ): {
    conversation: ChatConversation;
    messages: ChatMessage[];
  } {
    const conversation = this.requireConversation(profileId, conversationId);
    const sourceStatement = this.database.prepare(
      `SELECT source_id AS id, title, url, domain,
              published_at AS publishedAt, retrieved_at AS retrievedAt
         FROM chat_sources WHERE message_id = ?
         ORDER BY CAST(SUBSTR(source_id, 2) AS INTEGER)`,
    );
    const messages = (
      this.database
        .prepare(
          `SELECT id, conversation_id, role, content, answer_status, route, created_at
             FROM chat_messages
            WHERE profile_id = ? AND conversation_id = ?
            ORDER BY ordinal`,
        )
        .all(profileId, conversationId) as MessageRow[]
    ).map((row) =>
      ChatMessageSchema.parse({
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role,
        content: row.content,
        answerStatus: row.answer_status,
        route: row.route,
        sources: sourceStatement.all(row.id),
        createdAt: row.created_at,
      }),
    );
    return { conversation, messages };
  }

  enqueue(
    profileId: string,
    conversationId: string,
    clientRequestId: string,
    content: string,
  ): string {
    this.requireConversation(profileId, conversationId);
    const existing = this.database
      .prepare(
        'SELECT id FROM chat_runs WHERE profile_id = ? AND client_request_id = ?',
      )
      .get(profileId, clientRequestId) as { id: string } | undefined;
    if (existing) return existing.id;
    const count = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM chat_runs
          WHERE profile_id = ? AND status IN ('queued', 'running')`,
      )
      .get(profileId) as { count: number };
    if (count.count >= 4) throw new ChatQueueFullError('CHAT_QUEUE_FULL');
    const runId = randomUUID();
    const messageId = randomUUID();
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const ordinal = (
        this.database
          .prepare(
            `SELECT COALESCE(MAX(ordinal), 0) + 1 AS value
               FROM chat_messages WHERE conversation_id = ?`,
          )
          .get(conversationId) as { value: number }
      ).value;
      this.database
        .prepare(
          `INSERT INTO chat_messages(
             id, conversation_id, profile_id, role, content, answer_status, route, ordinal, created_at
           ) VALUES (?, ?, ?, 'user', ?, NULL, NULL, ?, ?)`,
        )
        .run(messageId, conversationId, profileId, content, ordinal, now);
      this.database
        .prepare(
          `INSERT INTO chat_runs(
             id, profile_id, conversation_id, client_request_id, user_message_id,
             status, stage, retrieval_mode, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'queued', 'queued', 'none', ?, ?)`,
        )
        .run(
          runId,
          profileId,
          conversationId,
          clientRequestId,
          messageId,
          now,
          now,
        );
      this.database
        .prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?')
        .run(now, conversationId);
    })();
    this.kick();
    return runId;
  }

  getRun(profileId: string, id: string): ChatRun {
    const row = this.database
      .prepare(
        `SELECT id, conversation_id, status, stage, route, retrieval_mode,
                error_code, created_at, updated_at
           FROM chat_runs WHERE id = ? AND profile_id = ?`,
      )
      .get(id, profileId) as RunRow | undefined;
    if (!row) throw new ChatNotFoundError('Run introuvable.');
    return ChatRunSchema.parse({
      id: row.id,
      conversationId: row.conversation_id,
      status: row.status,
      stage: row.stage,
      route: row.route,
      retrievalMode: row.retrieval_mode,
      errorCode: row.error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  cancelRun(profileId: string, id: string): void {
    const run = this.getRun(profileId, id);
    if (
      run.status === 'completed' ||
      run.status === 'failed' ||
      run.status === 'cancelled'
    )
      return;
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE chat_runs SET cancel_requested = 1,
          status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
          updated_at = ? WHERE id = ? AND profile_id = ?`,
      )
      .run(now, id, profileId);
    if (this.activeRun?.id === id) this.activeRun.controller.abort();
  }

  private kick(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    void this.drain().finally(() => {
      this.running = false;
      if (!this.stopped && this.nextPending()) this.kick();
    });
  }

  private nextPending(): PendingRunRow | undefined {
    return this.database
      .prepare(
        `SELECT r.id, r.profile_id, r.conversation_id, r.user_message_id, m.content
           FROM chat_runs r JOIN chat_messages m ON m.id = r.user_message_id
          WHERE r.status = 'queued' AND r.cancel_requested = 0
          ORDER BY r.created_at, r.id LIMIT 1`,
      )
      .get() as PendingRunRow | undefined;
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      const pending = this.nextPending();
      if (!pending) return;
      await this.execute(pending);
    }
  }

  private async execute(run: PendingRunRow): Promise<void> {
    const controller = new AbortController();
    this.activeRun = { id: run.id, controller };
    const startedAt = performance.now();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE chat_runs SET status = 'running', stage = 'routing', updated_at = ?
          WHERE id = ? AND status = 'queued'`,
      )
      .run(now, run.id);
    try {
      const priorTurns = (
        this.database
          .prepare(
            `SELECT role, content FROM chat_messages
              WHERE profile_id = ? AND conversation_id = ? AND id <> ?
              ORDER BY ordinal DESC LIMIT 2`,
          )
          .all(
            run.profile_id,
            run.conversation_id,
            run.user_message_id,
          ) as Array<{
          role: 'user' | 'assistant';
          content: string;
        }>
      ).reverse();
      const result = await this.engine.answer({
        content: run.content,
        priorTurns,
        signal: controller.signal,
        updateStage: (stage) => {
          this.database
            .prepare(
              'UPDATE chat_runs SET stage = ?, updated_at = ? WHERE id = ?',
            )
            .run(stage, new Date().toISOString(), run.id);
        },
      });
      if (controller.signal.aborted)
        throw new DOMException('Cancelled', 'AbortError');
      const messageId = randomUUID();
      const completedAt = new Date().toISOString();
      this.database.transaction(() => {
        const ordinal = (
          this.database
            .prepare(
              `SELECT COALESCE(MAX(ordinal), 0) + 1 AS value
                 FROM chat_messages WHERE conversation_id = ?`,
            )
            .get(run.conversation_id) as { value: number }
        ).value;
        this.database
          .prepare(
            `INSERT INTO chat_messages(
               id, conversation_id, profile_id, role, content, answer_status, route, ordinal, created_at
             ) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?)`,
          )
          .run(
            messageId,
            run.conversation_id,
            run.profile_id,
            result.markdown,
            result.status,
            result.route,
            ordinal,
            completedAt,
          );
        const insertSource = this.database.prepare(
          `INSERT INTO chat_sources(
             message_id, source_id, title, url, domain, published_at, retrieved_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const source of result.sources) {
          insertSource.run(
            messageId,
            source.id,
            source.title,
            source.url,
            source.domain,
            source.publishedAt,
            source.retrievedAt,
          );
        }
        this.database
          .prepare(
            `UPDATE chat_runs SET status = 'completed', stage = 'completed',
               assistant_message_id = ?, route = ?, retrieval_mode = ?, error_code = NULL,
               model_calls = ?, source_count = ?, passage_count = ?, duration_ms = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            messageId,
            result.route,
            result.retrievalMode,
            result.modelCalls,
            result.sources.length,
            result.passageCount,
            Math.round(performance.now() - startedAt),
            completedAt,
            run.id,
          );
        this.database
          .prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?')
          .run(completedAt, run.conversation_id);
      })();
    } catch (error) {
      const cancelled = controller.signal.aborted;
      this.database
        .prepare(
          `UPDATE chat_runs SET status = ?, error_code = ?, duration_ms = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          cancelled ? 'cancelled' : 'failed',
          cancelled ? 'CANCELLED' : safeErrorCode(error),
          Math.round(performance.now() - startedAt),
          new Date().toISOString(),
          run.id,
        );
    } finally {
      this.activeRun = undefined;
    }
  }

  private requireConversation(profileId: string, id: string): ChatConversation {
    const row = this.database
      .prepare(
        `SELECT id, title, archived_at, created_at, updated_at
           FROM chat_conversations WHERE id = ? AND profile_id = ?`,
      )
      .get(id, profileId) as ConversationRow | undefined;
    if (!row) throw new ChatNotFoundError('Conversation introuvable.');
    return this.toConversation(row);
  }

  private toConversation(row: ConversationRow): ChatConversation {
    return ChatConversationSchema.parse({
      id: row.id,
      title: row.title,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}
