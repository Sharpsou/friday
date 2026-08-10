import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import {
  AssistantConversationSchema,
  AssistantMessageSchema,
  AssistantRunEventSchema,
  AssistantRunSchema,
  AssistantSourceSchema,
  type AssistantConversation,
  type AssistantEffectiveMode,
  type AssistantMessage,
  type AssistantMode,
  type AssistantRun,
  type AssistantRunEvent,
  type AssistantRunStatus,
  type AssistantWebDepth,
} from '@friday/contracts';

import {
  inferEffectiveMode,
  inferWebDepth,
  type AssistantEngine,
} from './assistant-engine.js';

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
  effective_mode: AssistantEffectiveMode | null;
  id: string;
  requested_mode: AssistantMode | null;
  role: 'user' | 'assistant';
  run_id: string | null;
  web_depth: AssistantWebDepth | null;
}

interface RunRow {
  assistant_message_id: string | null;
  conversation_id: string;
  created_at: string;
  effective_mode: AssistantEffectiveMode | null;
  error_code: string | null;
  error_message: string | null;
  id: string;
  profile_id: string;
  requested_mode: AssistantMode;
  search_queries_json: string;
  stage_label: string;
  status: AssistantRunStatus;
  updated_at: string;
  user_message_id: string;
  web_depth: AssistantWebDepth | null;
}

interface SourceRow {
  domain: string;
  published_at: string | null;
  retrieved_at: string;
  source_id: string;
  title: string;
  url: string;
}

const TERMINAL_STATUSES: AssistantRunStatus[] = [
  'completed',
  'cancelled',
  'failed',
];

export class AssistantNotFoundError extends Error {}
export class AssistantConflictError extends Error {}

export class AssistantService {
  private activeController: AbortController | null = null;
  private activeRunId: string | null = null;
  private processing: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly database: Database.Database,
    private readonly engine: AssistantEngine,
  ) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE assistant_runs
            SET status = CASE WHEN attempt_count >= 2 THEN 'failed' ELSE 'queued' END,
                stage_label = CASE WHEN attempt_count >= 2 THEN 'Échec après redémarrage' ELSE 'Dans la file' END,
                error_code = CASE WHEN attempt_count >= 2 THEN 'repeated_restart' ELSE NULL END,
                error_message = CASE WHEN attempt_count >= 2 THEN 'La demande a été interrompue deux fois.' ELSE NULL END,
                lease_until = NULL, updated_at = ?
          WHERE status IN ('preparing', 'searching', 'reading', 'verifying', 'writing', 'cancel_requested')`,
      )
      .run(now);
    this.schedule();
  }

  listConversations(profileId: string): AssistantConversation[] {
    return (
      this.database
        .prepare(
          `SELECT id, title, archived_at, created_at, updated_at
           FROM assistant_conversations WHERE profile_id = ?
          ORDER BY archived_at IS NOT NULL, updated_at DESC`,
        )
        .all(profileId) as ConversationRow[]
    ).map((row) => this.toConversation(row));
  }

  createConversation(profileId: string, title: string): AssistantConversation {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO assistant_conversations(id, profile_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, title, now, now);
    return this.getConversation(profileId, id);
  }

  updateConversation(
    profileId: string,
    id: string,
    update: { archived?: boolean | undefined; title?: string | undefined },
  ): AssistantConversation {
    this.getConversation(profileId, id);
    const current = this.getConversation(profileId, id);
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
          ? current.archivedAt
          : update.archived
            ? now
            : null,
        now,
        id,
        profileId,
      );
    return this.getConversation(profileId, id);
  }

  deleteConversation(profileId: string, id: string): void {
    this.getConversation(profileId, id);
    const active = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM assistant_runs
          WHERE conversation_id = ? AND profile_id = ?
            AND status NOT IN ('completed', 'cancelled', 'failed')`,
      )
      .get(id, profileId) as { count: number };
    if (active.count > 0)
      throw new AssistantConflictError(
        'Annulez la demande en cours avant de supprimer la conversation.',
      );
    this.database
      .prepare(
        'DELETE FROM assistant_conversations WHERE id = ? AND profile_id = ?',
      )
      .run(id, profileId);
  }

  getMessages(
    profileId: string,
    conversationId: string,
  ): {
    activeRun: AssistantRun | null;
    conversation: AssistantConversation;
    messages: AssistantMessage[];
  } {
    const conversation = this.getConversation(profileId, conversationId);
    const rows = this.database
      .prepare(
        `SELECT id, conversation_id, role, content, requested_mode, effective_mode, web_depth, run_id, created_at
           FROM assistant_messages WHERE conversation_id = ? AND profile_id = ?
          ORDER BY created_at, id`,
      )
      .all(conversationId, profileId) as MessageRow[];
    const latestRunRow = this.database
      .prepare(
        `SELECT * FROM assistant_runs WHERE conversation_id = ? AND profile_id = ?
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(conversationId, profileId) as RunRow | undefined;
    return {
      conversation,
      messages: rows.map((row) => this.toMessage(row)),
      activeRun:
        latestRunRow && latestRunRow.assistant_message_id === null
          ? this.toRun(latestRunRow)
          : null,
    };
  }

  submit(
    profileId: string,
    conversationId: string,
    input: {
      clientRequestId: string;
      content: string;
      mode: AssistantMode;
      webDepth?: AssistantWebDepth | null | undefined;
    },
  ): { message: AssistantMessage; run: AssistantRun } {
    this.getConversation(profileId, conversationId);
    const existing = this.database
      .prepare(
        'SELECT * FROM assistant_runs WHERE profile_id = ? AND client_request_id = ?',
      )
      .get(profileId, input.clientRequestId) as RunRow | undefined;
    if (existing) {
      const message = this.getMessage(profileId, existing.user_message_id);
      return { message, run: this.toRun(existing) };
    }
    const pending = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM assistant_runs WHERE profile_id = ?
          AND status NOT IN ('completed', 'cancelled', 'failed')`,
      )
      .get(profileId) as { count: number };
    if (pending.count >= 5)
      throw new AssistantConflictError(
        'Vous avez déjà cinq demandes en attente.',
      );
    const conversationActive = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM assistant_runs WHERE conversation_id = ?
          AND status NOT IN ('completed', 'cancelled', 'failed')`,
      )
      .get(conversationId) as { count: number };
    if (conversationActive.count > 0)
      throw new AssistantConflictError(
        'Cette conversation a déjà une demande en cours.',
      );

    const messageId = randomUUID();
    const runId = randomUUID();
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO assistant_messages(
             id, conversation_id, profile_id, role, content, requested_mode, web_depth, run_id, created_at
           ) VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?)`,
        )
        .run(
          messageId,
          conversationId,
          profileId,
          input.content,
          input.mode,
          input.webDepth ?? null,
          runId,
          now,
        );
      this.database
        .prepare(
          `INSERT INTO assistant_runs(
             id, client_request_id, conversation_id, profile_id, user_message_id,
             requested_mode, web_depth, status, stage_label, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'Dans la file', ?, ?)`,
        )
        .run(
          runId,
          input.clientRequestId,
          conversationId,
          profileId,
          messageId,
          input.mode,
          input.webDepth ?? null,
          now,
          now,
        );
      this.database
        .prepare(
          'UPDATE assistant_conversations SET updated_at = ? WHERE id = ?',
        )
        .run(now, conversationId);
      this.addEvent(runId, profileId, 'queued', 'Dans la file', now);
    })();
    this.schedule();
    return {
      message: this.getMessage(profileId, messageId),
      run: this.getRun(profileId, runId),
    };
  }

  getRun(profileId: string, runId: string): AssistantRun {
    const row = this.database
      .prepare('SELECT * FROM assistant_runs WHERE id = ? AND profile_id = ?')
      .get(runId, profileId) as RunRow | undefined;
    if (!row) throw new AssistantNotFoundError('Demande introuvable.');
    return this.toRun(row);
  }

  listEvents(
    profileId: string,
    runId: string,
    after: number,
  ): { events: AssistantRunEvent[]; cursor: number } {
    this.getRun(profileId, runId);
    const rows = this.database
      .prepare(
        `SELECT sequence, run_id, status, label, created_at
           FROM assistant_run_events WHERE run_id = ? AND profile_id = ? AND sequence > ?
          ORDER BY sequence LIMIT 200`,
      )
      .all(runId, profileId, after) as Array<{
      sequence: number;
      run_id: string;
      status: AssistantRunStatus;
      label: string;
      created_at: string;
    }>;
    const events = rows.map((row) =>
      AssistantRunEventSchema.parse({
        sequence: row.sequence,
        runId: row.run_id,
        status: row.status,
        label: row.label,
        createdAt: row.created_at,
      }),
    );
    return { events, cursor: events.at(-1)?.sequence ?? after };
  }

  consent(
    profileId: string,
    runId: string,
    approved: boolean,
    queries: string[],
  ): AssistantRun {
    const run = this.getRun(profileId, runId);
    if (run.status !== 'awaiting_search_consent')
      throw new AssistantConflictError(
        'Cette demande n’attend pas de confirmation.',
      );
    const now = new Date().toISOString();
    if (!approved) {
      this.setRunState(
        runId,
        profileId,
        'cancelled',
        'Recherche refusée',
        now,
        {
          errorCode: 'search_consent_denied',
          errorMessage:
            'La recherche contenant des données personnelles a été refusée.',
        },
      );
    } else {
      this.database
        .prepare(
          `UPDATE assistant_runs SET status = 'queued', stage_label = 'Dans la file',
             search_queries_json = ?, search_consent = 1, updated_at = ? WHERE id = ?`,
        )
        .run(JSON.stringify(queries), now, runId);
      this.addEvent(runId, profileId, 'queued', 'Dans la file', now);
      this.schedule();
    }
    return this.getRun(profileId, runId);
  }

  cancel(profileId: string, runId: string): AssistantRun {
    const run = this.getRun(profileId, runId);
    if (TERMINAL_STATUSES.includes(run.status)) return run;
    const now = new Date().toISOString();
    if (run.status === 'queued' || run.status === 'awaiting_search_consent') {
      this.setRunState(runId, profileId, 'cancelled', 'Annulé', now);
    } else {
      this.setRunState(
        runId,
        profileId,
        'cancel_requested',
        'Annulation demandée',
        now,
      );
      if (this.activeRunId === runId)
        this.activeController?.abort(new Error('Demande annulée.'));
    }
    return this.getRun(profileId, runId);
  }

  retry(profileId: string, runId: string): AssistantRun {
    const run = this.getRun(profileId, runId);
    if (!['failed', 'cancelled'].includes(run.status))
      throw new AssistantConflictError(
        'Seule une demande terminée en échec ou annulée peut être relancée.',
      );
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE assistant_runs SET status = 'queued', stage_label = 'Dans la file',
           error_code = NULL, error_message = NULL, cancel_requested = 0,
           attempt_count = 0, lease_until = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(now, runId);
    this.addEvent(runId, profileId, 'queued', 'Dans la file', now);
    this.schedule();
    return this.getRun(profileId, runId);
  }

  queueSummary(profileId: string): {
    activeRun: AssistantRun | null;
    pending: number;
  } {
    const rows = this.database
      .prepare(
        `SELECT * FROM assistant_runs WHERE profile_id = ?
          AND status NOT IN ('completed', 'cancelled', 'failed') ORDER BY created_at`,
      )
      .all(profileId) as RunRow[];
    return {
      pending: rows.length,
      activeRun: rows[0] ? this.toRun(rows[0]) : null,
    };
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.activeController?.abort(new Error('Arrêt du hub.'));
    await this.processing?.catch(() => undefined);
    await this.engine.close?.();
  }

  private schedule(): void {
    if (this.stopping || this.processing) return;
    this.processing = this.processNext().finally(() => {
      this.processing = null;
      if (!this.stopping && this.hasQueued()) this.schedule();
    });
  }

  private async processNext(): Promise<void> {
    const row = this.claimNext();
    if (!row) return;
    const controller = new AbortController();
    this.activeController = controller;
    this.activeRunId = row.id;
    try {
      const history = this.getMessages(
        row.profile_id,
        row.conversation_id,
      ).messages;
      const userMessage = history.find(
        (message) => message.id === row.user_message_id,
      );
      if (!userMessage) throw new Error('Message utilisateur introuvable.');
      const effectiveMode = inferEffectiveMode(
        row.requested_mode,
        userMessage.content,
      );
      const webDepth =
        effectiveMode === 'web'
          ? inferWebDepth(
              row.requested_mode,
              row.web_depth,
              userMessage.content,
            )
          : null;
      this.database
        .prepare(
          'UPDATE assistant_runs SET effective_mode = ?, web_depth = ? WHERE id = ?',
        )
        .run(effectiveMode, webDepth, row.id);

      let result;
      if (effectiveMode === 'web') {
        let queries = JSON.parse(row.search_queries_json) as string[];
        if (queries.length === 0) {
          queries =
            webDepth === 'fast'
              ? [userMessage.content]
              : await this.engine.planQueries(
                  userMessage.content,
                  controller.signal,
                );
        }
        const consent = this.database
          .prepare('SELECT search_consent FROM assistant_runs WHERE id = ?')
          .get(row.id) as { search_consent: number };
        if (
          !consent.search_consent &&
          this.requiresConsent(row.profile_id, queries)
        ) {
          const now = new Date().toISOString();
          this.database
            .prepare(
              `UPDATE assistant_runs SET status = 'awaiting_search_consent',
                 stage_label = 'Confirmation requise', search_queries_json = ?,
                 lease_until = NULL, updated_at = ? WHERE id = ?`,
            )
            .run(JSON.stringify(queries), now, row.id);
          this.addEvent(
            row.id,
            row.profile_id,
            'awaiting_search_consent',
            'Confirmation requise',
            now,
          );
          return;
        }
        result = await this.engine.answerWeb(
          history,
          queries,
          controller.signal,
          (status, label) => {
            this.setRunState(
              row.id,
              row.profile_id,
              status,
              label,
              new Date().toISOString(),
            );
          },
          webDepth ?? 'fast',
        );
      } else {
        this.setRunState(
          row.id,
          row.profile_id,
          'writing',
          'Rédaction',
          new Date().toISOString(),
        );
        result = await this.engine.answerClassic(history, controller.signal);
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      let generatedTitle: string | null = null;
      if (this.shouldGenerateTitle(row)) {
        this.setRunState(
          row.id,
          row.profile_id,
          'writing',
          'Titre de la conversation',
          new Date().toISOString(),
        );
        try {
          generatedTitle = await this.engine.generateTitle(
            userMessage.content,
            effectiveMode,
            webDepth,
            controller.signal,
          );
        } catch {
          if (controller.signal.aborted) throw controller.signal.reason;
        }
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      this.complete(row, effectiveMode, webDepth, result, generatedTitle);
    } catch (error) {
      const current = this.getRun(row.profile_id, row.id);
      const now = new Date().toISOString();
      if (controller.signal.aborted || current.status === 'cancel_requested') {
        this.setRunState(row.id, row.profile_id, 'cancelled', 'Annulé', now);
      } else {
        this.setRunState(row.id, row.profile_id, 'failed', 'Échec', now, {
          errorCode: 'assistant_failed',
          errorMessage:
            error instanceof Error
              ? error.message
              : 'Erreur Assistant inconnue.',
        });
      }
    } finally {
      this.activeController = null;
      this.activeRunId = null;
    }
  }

  private claimNext(): RunRow | null {
    return this.database.transaction(() => {
      const last = this.database
        .prepare('SELECT last_profile_id FROM assistant_scheduler WHERE id = 1')
        .get() as { last_profile_id: string | null };
      const candidates = this.database
        .prepare(
          `SELECT * FROM assistant_runs WHERE status = 'queued'
            AND NOT EXISTS (
              SELECT 1 FROM assistant_runs earlier
               WHERE earlier.conversation_id = assistant_runs.conversation_id
                 AND earlier.created_at < assistant_runs.created_at
                 AND earlier.status NOT IN ('completed', 'cancelled', 'failed')
            )
           ORDER BY created_at`,
        )
        .all() as RunRow[];
      const row =
        candidates.find(
          (candidate) => candidate.profile_id !== last.last_profile_id,
        ) ?? candidates[0];
      if (!row) return null;
      const now = new Date().toISOString();
      const lease = new Date(Date.now() + 15 * 60_000).toISOString();
      this.database
        .prepare(
          `UPDATE assistant_runs SET status = 'preparing', stage_label = 'Préparation',
             attempt_count = attempt_count + 1, lease_until = ?, updated_at = ?
           WHERE id = ? AND status = 'queued'`,
        )
        .run(lease, now, row.id);
      this.database
        .prepare(
          'UPDATE assistant_scheduler SET last_profile_id = ? WHERE id = 1',
        )
        .run(row.profile_id);
      this.addEvent(row.id, row.profile_id, 'preparing', 'Préparation', now);
      return this.database
        .prepare('SELECT * FROM assistant_runs WHERE id = ?')
        .get(row.id) as RunRow;
    })();
  }

  private complete(
    row: RunRow,
    effectiveMode: AssistantEffectiveMode,
    webDepth: AssistantWebDepth | null,
    result: Awaited<ReturnType<AssistantEngine['answerClassic']>>,
    generatedTitle: string | null,
  ): void {
    const messageId = randomUUID();
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO assistant_messages(
             id, conversation_id, profile_id, role, content, effective_mode, web_depth, run_id, created_at
           ) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?)`,
        )
        .run(
          messageId,
          row.conversation_id,
          row.profile_id,
          result.content,
          effectiveMode,
          webDepth,
          row.id,
          now,
        );
      const insertSource = this.database.prepare(
        `INSERT INTO assistant_sources(
           run_id, source_id, title, url, domain, published_at, retrieved_at, excerpt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const source of result.sources) {
        insertSource.run(
          row.id,
          source.id,
          source.title,
          source.url,
          source.domain,
          source.publishedAt,
          source.retrievedAt,
          source.excerpt,
        );
      }
      this.database
        .prepare(
          `UPDATE assistant_runs SET assistant_message_id = ?, status = 'completed',
             stage_label = 'Terminé', lease_until = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(messageId, now, row.id);
      this.database
        .prepare(
          `UPDATE assistant_conversations
              SET title = CASE
                    WHEN title = 'Nouvelle conversation' AND ? IS NOT NULL THEN ?
                    ELSE title
                  END,
                  updated_at = ?
            WHERE id = ?`,
        )
        .run(generatedTitle, generatedTitle, now, row.conversation_id);
      this.addEvent(row.id, row.profile_id, 'completed', 'Terminé', now);
    })();
  }

  private shouldGenerateTitle(row: RunRow): boolean {
    const conversation = this.database
      .prepare(
        `SELECT title,
                (SELECT COUNT(*) FROM assistant_messages
                  WHERE conversation_id = ? AND profile_id = ? AND role = 'user') AS user_count
           FROM assistant_conversations
          WHERE id = ? AND profile_id = ?`,
      )
      .get(
        row.conversation_id,
        row.profile_id,
        row.conversation_id,
        row.profile_id,
      ) as { title: string; user_count: number } | undefined;
    return (
      conversation?.title === 'Nouvelle conversation' &&
      conversation.user_count === 1
    );
  }

  private requiresConsent(profileId: string, queries: string[]): boolean {
    const names = (
      this.database
        .prepare(
          'SELECT name FROM household_members hm JOIN "user" u ON u.id = hm.user_id',
        )
        .all() as Array<{ name: string }>
    ).map(({ name }) => name.toLocaleLowerCase('fr'));
    const text = queries.join(' ').toLocaleLowerCase('fr');
    return (
      names.some((name) => name.length >= 3 && text.includes(name)) ||
      /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/iu.test(text) ||
      /\b(?:\+33|0)[1-9](?:[ .-]?\d{2}){4}\b/u.test(text) ||
      /\b(?:adresse|diagnostic|traitement|mot de passe|identifiant|compte bancaire)\b/iu.test(
        text,
      ) ||
      text.includes(profileId.toLocaleLowerCase('fr'))
    );
  }

  private setRunState(
    runId: string,
    profileId: string,
    status: AssistantRunStatus,
    label: string,
    now: string,
    error?: { errorCode: string; errorMessage: string },
  ): void {
    this.database
      .prepare(
        `UPDATE assistant_runs SET status = ?, stage_label = ?, updated_at = ?,
           lease_until = CASE WHEN ? IN ('completed', 'cancelled', 'failed', 'awaiting_search_consent') THEN NULL ELSE lease_until END,
           error_code = ?, error_message = ? WHERE id = ? AND profile_id = ?`,
      )
      .run(
        status,
        label,
        now,
        status,
        error?.errorCode ?? null,
        error?.errorMessage ?? null,
        runId,
        profileId,
      );
    this.addEvent(runId, profileId, status, label, now);
  }

  private addEvent(
    runId: string,
    profileId: string,
    status: AssistantRunStatus,
    label: string,
    now: string,
  ): void {
    this.database
      .prepare(
        'INSERT INTO assistant_run_events(run_id, profile_id, status, label, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(runId, profileId, status, label, now);
  }

  private getConversation(
    profileId: string,
    id: string,
  ): AssistantConversation {
    const row = this.database
      .prepare(
        'SELECT id, title, archived_at, created_at, updated_at FROM assistant_conversations WHERE id = ? AND profile_id = ?',
      )
      .get(id, profileId) as ConversationRow | undefined;
    if (!row) throw new AssistantNotFoundError('Conversation introuvable.');
    return this.toConversation(row);
  }

  private getMessage(profileId: string, id: string): AssistantMessage {
    const row = this.database
      .prepare(
        `SELECT id, conversation_id, role, content, requested_mode, effective_mode, web_depth, run_id, created_at
           FROM assistant_messages WHERE id = ? AND profile_id = ?`,
      )
      .get(id, profileId) as MessageRow | undefined;
    if (!row) throw new AssistantNotFoundError('Message introuvable.');
    return this.toMessage(row);
  }

  private toConversation(row: ConversationRow): AssistantConversation {
    return AssistantConversationSchema.parse({
      id: row.id,
      title: row.title,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private toMessage(row: MessageRow): AssistantMessage {
    const sourceRows = row.run_id
      ? (this.database
          .prepare(
            'SELECT source_id, title, url, domain, published_at, retrieved_at FROM assistant_sources WHERE run_id = ? ORDER BY source_id',
          )
          .all(row.run_id) as SourceRow[])
      : [];
    return AssistantMessageSchema.parse({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      requestedMode: row.requested_mode,
      effectiveMode: row.effective_mode,
      webDepth: row.web_depth,
      runId: row.run_id,
      sources: sourceRows.map((source) =>
        AssistantSourceSchema.parse({
          id: source.source_id,
          title: source.title,
          url: source.url,
          domain: source.domain,
          publishedAt: source.published_at,
          retrievedAt: source.retrieved_at,
        }),
      ),
      createdAt: row.created_at,
    });
  }

  private toRun(row: RunRow): AssistantRun {
    return AssistantRunSchema.parse({
      id: row.id,
      conversationId: row.conversation_id,
      userMessageId: row.user_message_id,
      assistantMessageId: row.assistant_message_id,
      requestedMode: row.requested_mode,
      effectiveMode: row.effective_mode,
      webDepth: row.web_depth,
      status: row.status,
      stageLabel: row.stage_label,
      queuePosition:
        row.status === 'queued' ? this.queuePosition(row.id) : null,
      searchQueries: JSON.parse(row.search_queries_json) as unknown,
      error:
        row.error_code && row.error_message
          ? { code: row.error_code, message: row.error_message }
          : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private queuePosition(runId: string): number {
    const rows = this.database
      .prepare(
        "SELECT id FROM assistant_runs WHERE status = 'queued' ORDER BY created_at",
      )
      .all() as Array<{ id: string }>;
    return Math.max(1, rows.findIndex((row) => row.id === runId) + 1);
  }

  private hasQueued(): boolean {
    return Boolean(
      this.database
        .prepare("SELECT 1 FROM assistant_runs WHERE status = 'queued' LIMIT 1")
        .get(),
    );
  }
}
