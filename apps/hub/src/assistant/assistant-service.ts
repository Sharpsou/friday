import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import {
  AssistantConversationSchema,
  AssistantExaUsageSchema,
  AssistantMessageSchema,
  AssistantResearchDiagnosticsResponseSchema,
  AssistantRunEventSchema,
  AssistantRunSchema,
  AssistantSourceSchema,
  type AssistantConversation,
  type AssistantExaUsage,
  type AssistantMessage,
  type AssistantMode,
  type AssistantModel,
  type AssistantResearchOutcome,
  type AssistantRun,
  type AssistantRunEvent,
  type AssistantRunStatus,
  type AssistantResearchDiagnosticsResponse,
  type AssistantStoredEffectiveMode,
  type AssistantStoredWebDepth,
  type AssistantThinkingPolicy,
  type ResearchDiagnostic,
  AssistantWebUsageSchema,
  type AssistantWebUsage,
} from '@friday/contracts';

import type { AssistantEngine } from './assistant-engine.js';
import {
  FridayMemoryReader,
  type FridayGroundedFact,
} from './friday-memory.js';
import {
  ExaMcpError,
  ExaMcpSearchClient,
  type ExaFailureKind,
} from './exa-mcp-search.js';
import {
  selectResearchEvidence,
  shouldContinueDeepResearch,
} from './research-selection.js';
import {
  normalizeResearchEvidence,
  TavilySearchClient,
  type TavilyEvidence,
  type TavilySearchDepth,
} from './tavily-search.js';

interface ConversationRow {
  archived_at: string | null;
  created_at: string;
  id: string;
  mode: AssistantMode;
  mode_v2: 'friday' | null;
  title: string;
  updated_at: string;
}

interface MessageRow {
  assistant_model: AssistantModel;
  content: string;
  conversation_id: string;
  created_at: string;
  effective_mode: AssistantStoredEffectiveMode | null;
  id: string;
  conversation_mode: AssistantMode;
  conversation_mode_v2: 'friday' | null;
  thinking_policy: AssistantThinkingPolicy;
  thinking_used: 0 | 1;
  research_outcome: AssistantResearchOutcome;
  credits_used: number;
  requested_mode: 'auto' | 'web' | 'classic' | null;
  role: 'user' | 'assistant';
  run_id: string | null;
  web_depth: AssistantStoredWebDepth | null;
}

interface RunRow {
  assistant_model: AssistantModel;
  assistant_message_id: string | null;
  conversation_id: string;
  created_at: string;
  effective_mode: AssistantStoredEffectiveMode | null;
  error_code: string | null;
  error_message: string | null;
  id: string;
  conversation_mode: AssistantMode;
  conversation_mode_v2: 'friday' | null;
  thinking_policy: AssistantThinkingPolicy;
  thinking_used: 0 | 1;
  research_outcome: AssistantResearchOutcome;
  credits_used: number;
  search_consent: 0 | 1;
  profile_id: string;
  requested_mode: 'auto' | 'web' | 'classic';
  search_queries_json: string;
  stage_label: string;
  status: AssistantRunStatus;
  updated_at: string;
  user_message_id: string;
  web_depth: AssistantStoredWebDepth | null;
}

interface SourceRow {
  domain: string;
  published_at: string | null;
  retrieved_at: string;
  source_id: string;
  title: string;
  url: string;
  excerpt?: string;
  provider?: 'exa' | 'tavily';
}

interface RunEventRow {
  created_at: string;
  label: string;
  run_id: string;
  sequence: number;
  status: AssistantRunStatus;
}

const WEB_SOFT_LIMIT = 750;
const WEB_DEEP_LIMIT = 850;
const WEB_HARD_LIMIT = 950;

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
    private readonly tavily = new TavilySearchClient(undefined),
    private readonly exa = new ExaMcpSearchClient(),
    private readonly fridayMemory: Pick<
      FridayMemoryReader,
      'query'
    > = new FridayMemoryReader(database),
  ) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE assistant_runs
            SET status = CASE WHEN attempt_count >= 2 THEN 'failed' ELSE 'queued' END,
                stage_label = CASE WHEN attempt_count >= 2 THEN 'Échec après redémarrage' ELSE 'Dans la file' END,
                error_code = CASE WHEN attempt_count >= 2 THEN 'repeated_restart' ELSE NULL END,
                error_message = CASE WHEN attempt_count >= 2 THEN 'La demande a été interrompue deux fois.' ELSE NULL END,
                effective_mode = NULL,
                lease_until = NULL, updated_at = ?
          WHERE status IN ('preparing', 'awaiting_search_consent', 'searching',
                           'reading', 'verifying', 'writing', 'cancel_requested')`,
      )
      .run(now);
    this.schedule();
  }

  listConversations(profileId: string): AssistantConversation[] {
    return (
      this.database
        .prepare(
          `SELECT id, title, mode, mode_v2, archived_at, created_at, updated_at
           FROM assistant_conversations WHERE profile_id = ?
          ORDER BY archived_at IS NOT NULL, updated_at DESC`,
        )
        .all(profileId) as ConversationRow[]
    ).map((row) => this.toConversation(row));
  }

  createConversation(
    profileId: string,
    title: string,
    mode: AssistantMode = 'local',
  ): AssistantConversation {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO assistant_conversations(id, profile_id, title, mode, mode_v2, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        profileId,
        title,
        storedDatabaseMode(mode),
        extendedMode(mode),
        now,
        now,
      );
    return this.getConversation(profileId, id);
  }

  updateConversation(
    profileId: string,
    id: string,
    update: {
      archived?: boolean | undefined;
      title?: string | undefined;
      mode?: AssistantMode | undefined;
    },
  ): AssistantConversation {
    this.getConversation(profileId, id);
    const current = this.getConversation(profileId, id);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE assistant_conversations
            SET title = ?, mode = ?, mode_v2 = ?, archived_at = ?, updated_at = ?
          WHERE id = ? AND profile_id = ?`,
      )
      .run(
        update.title ?? current.title,
        storedDatabaseMode(update.mode ?? current.mode),
        extendedMode(update.mode ?? current.mode),
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
        `SELECT id, conversation_id, role, content, requested_mode, effective_mode, web_depth,
                 conversation_mode, conversation_mode_v2, assistant_model, thinking_policy, thinking_used, research_outcome, credits_used,
                run_id, created_at
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
      mode: AssistantMode | 'classic';
      model?: AssistantModel;
      thinkingPolicy?: AssistantThinkingPolicy;
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
    const mode = input.mode === 'classic' ? 'local' : input.mode;
    const model = input.model ?? 'qwen3.5';
    // Les anciens clients peuvent encore envoyer `forced`, mais la politique
    // est désormais entièrement automatique et pilotée par l'orchestrateur.
    const thinkingPolicy: AssistantThinkingPolicy = 'auto';
    const stored = storedMode(mode);
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO assistant_messages(
             id, conversation_id, profile_id, role, content, requested_mode, web_depth,
             conversation_mode, conversation_mode_v2, assistant_model, thinking_policy, run_id, created_at
           ) VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          messageId,
          conversationId,
          profileId,
          input.content,
          stored.requestedMode,
          stored.webDepth,
          storedDatabaseMode(mode),
          extendedMode(mode),
          model,
          thinkingPolicy,
          runId,
          now,
        );
      this.database
        .prepare(
          `INSERT INTO assistant_runs(
             id, client_request_id, conversation_id, profile_id, user_message_id,
             requested_mode, web_depth, conversation_mode, conversation_mode_v2, assistant_model, thinking_policy,
             status, stage_label, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'Dans la file', ?, ?)`,
        )
        .run(
          runId,
          input.clientRequestId,
          conversationId,
          profileId,
          messageId,
          stored.requestedMode,
          stored.webDepth,
          storedDatabaseMode(mode),
          extendedMode(mode),
          model,
          thinkingPolicy,
          now,
          now,
        );
      this.database
        .prepare(
          'UPDATE assistant_conversations SET mode = ?, mode_v2 = ?, updated_at = ? WHERE id = ?',
        )
        .run(storedDatabaseMode(mode), extendedMode(mode), now, conversationId);
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

  async webUsage(
    signal: AbortSignal = AbortSignal.timeout(10_000),
  ): Promise<AssistantWebUsage> {
    const month = new Date().toISOString().slice(0, 7);
    const row = this.database
      .prepare('SELECT credits_used FROM assistant_web_usage WHERE month = ?')
      .get(month) as { credits_used: number } | undefined;
    let creditsUsed = row?.credits_used ?? 0;
    let planLimit = WEB_HARD_LIMIT;
    let source: 'tavily' | 'local' = 'local';
    if (this.tavily.available) {
      try {
        const remote = await this.tavily.usage(signal);
        creditsUsed = Math.max(creditsUsed, remote.creditsUsed);
        planLimit = remote.limit;
        source = 'tavily';
      } catch {
        // Le compteur local garde l'interface et les garde-fous disponibles.
      }
    }
    const effectiveLimit = Math.min(WEB_HARD_LIMIT, planLimit);
    return AssistantWebUsageSchema.parse({
      month,
      creditsUsed,
      remainingBasicSearches: Math.max(0, effectiveLimit - creditsUsed),
      source,
      softLimit: WEB_SOFT_LIMIT,
      deepLimit: WEB_DEEP_LIMIT,
      hardLimit: WEB_HARD_LIMIT,
    });
  }

  exaUsage(): AssistantExaUsage {
    const month = new Date().toISOString().slice(0, 7);
    const usage = this.database
      .prepare(
        `SELECT calls, successes, empty_results, rate_limits, failures
           FROM assistant_exa_usage WHERE month = ?`,
      )
      .get(month) as
      | {
          calls: number;
          empty_results: number;
          failures: number;
          rate_limits: number;
          successes: number;
        }
      | undefined;
    const health = this.database
      .prepare(
        `SELECT status, last_attempt_at, last_message, cooldown_until
           FROM assistant_exa_health WHERE id = 1`,
      )
      .get() as {
      cooldown_until: string | null;
      last_attempt_at: string | null;
      last_message: string | null;
      status: 'untested' | 'available' | 'rate_limited' | 'unavailable';
    };
    return AssistantExaUsageSchema.parse({
      month,
      calls: usage?.calls ?? 0,
      successes: usage?.successes ?? 0,
      emptyResults: usage?.empty_results ?? 0,
      rateLimits: usage?.rate_limits ?? 0,
      failures: usage?.failures ?? 0,
      status: health.status,
      lastAttemptAt: health.last_attempt_at,
      message: health.last_message,
      cooldownUntil: health.cooldown_until,
    });
  }

  researchDiagnostics(
    profileId: string,
    conversationId: string,
  ): AssistantResearchDiagnosticsResponse {
    this.getConversation(profileId, conversationId);
    const rows = this.database
      .prepare(
        `SELECT a.run_id, a.provider, a.diagnostic_status, a.result_count,
                COALESCE(a.duration_ms, 0) AS duration_ms, a.error
           FROM assistant_research_attempts a
           JOIN assistant_runs r ON r.id = a.run_id
          WHERE r.profile_id = ? AND r.conversation_id = ?
          ORDER BY a.run_id, a.provider, a.ordinal`,
      )
      .all(profileId, conversationId) as Array<{
      diagnostic_status:
        | 'success'
        | 'empty'
        | 'rate_limited'
        | 'unavailable'
        | 'failed'
        | 'skipped'
        | null;
      duration_ms: number;
      error: string | null;
      provider: 'tavily' | 'exa';
      result_count: number;
      run_id: string;
    }>;
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.run_id}:${row.provider}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return AssistantResearchDiagnosticsResponseSchema.parse({
      diagnostics: [...groups.values()].map((attempts) => {
        const first = attempts[0]!;
        const status = aggregateDiagnosticStatus(
          attempts.map(
            (attempt) =>
              attempt.diagnostic_status ??
              (attempt.error ? 'failed' : 'success'),
          ),
        );
        const sources = this.database
          .prepare(
            `SELECT source_id FROM assistant_sources
              WHERE run_id = ? AND provider = ? ORDER BY source_id`,
          )
          .all(first.run_id, first.provider) as Array<{ source_id: string }>;
        return {
          runId: first.run_id,
          provider: first.provider,
          status,
          calls: attempts.filter(
            (attempt) => attempt.diagnostic_status !== 'skipped',
          ).length,
          results: attempts.reduce(
            (total, attempt) => total + attempt.result_count,
            0,
          ),
          durationMs: attempts.reduce(
            (total, attempt) => total + attempt.duration_ms,
            0,
          ),
          message: diagnosticMessage(
            first.provider,
            status,
            attempts.find((attempt) => attempt.error)?.error ?? null,
          ),
          sourceIds: sources.map((source) => source.source_id),
        };
      }),
    });
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
        'Cette demande n’attend pas de consentement.',
      );
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE assistant_runs
            SET status = 'queued', stage_label = 'Dans la file', search_consent = ?,
                search_queries_json = ?, conversation_mode = CASE WHEN ? THEN conversation_mode ELSE 'local' END,
                requested_mode = CASE WHEN ? THEN requested_mode ELSE 'classic' END,
                web_depth = CASE WHEN ? THEN web_depth ELSE NULL END, updated_at = ?
          WHERE id = ? AND profile_id = ?`,
      )
      .run(
        approved ? 1 : 0,
        JSON.stringify(approved ? queries : []),
        approved ? 1 : 0,
        approved ? 1 : 0,
        approved ? 1 : 0,
        now,
        runId,
        profileId,
      );
    this.addEvent(runId, profileId, 'queued', 'Dans la file', now);
    this.schedule();
    return this.getRun(profileId, runId);
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
      .all(runId, profileId, after) as RunEventRow[];
    const events = rows.map(toRunEvent);
    return { events, cursor: events.at(-1)?.sequence ?? after };
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
    const conversation = this.getConversation(profileId, run.conversationId);
    const modeChanged = conversation.mode !== run.mode;
    const nextStoredMode = storedMode(conversation.mode);
    const now = new Date().toISOString();
    this.database.transaction(() => {
      if (modeChanged) {
        this.database
          .prepare('DELETE FROM assistant_sources WHERE run_id = ?')
          .run(runId);
        this.database
          .prepare('DELETE FROM assistant_research_attempts WHERE run_id = ?')
          .run(runId);
        this.database
          .prepare(
            `UPDATE assistant_messages
                SET requested_mode = ?, web_depth = ?, conversation_mode = ?, conversation_mode_v2 = ?,
                    effective_mode = NULL, research_outcome = 'not_needed', credits_used = 0
              WHERE id = ? AND profile_id = ?`,
          )
          .run(
            nextStoredMode.requestedMode,
            nextStoredMode.webDepth,
            storedDatabaseMode(conversation.mode),
            extendedMode(conversation.mode),
            run.userMessageId,
            profileId,
          );
      }
      this.database
        .prepare(
          `UPDATE assistant_runs SET status = 'queued', stage_label = ?,
             requested_mode = ?, web_depth = ?, conversation_mode = ?, conversation_mode_v2 = ?,
             effective_mode = CASE WHEN ? THEN NULL ELSE effective_mode END,
             research_outcome = CASE WHEN ? THEN 'not_needed' ELSE research_outcome END,
             credits_used = CASE WHEN ? THEN 0 ELSE credits_used END,
             search_queries_json = CASE WHEN ? THEN '[]' ELSE search_queries_json END,
             search_consent = CASE WHEN ? THEN 0 ELSE search_consent END,
             thinking_used = 0, error_code = NULL, error_message = NULL,
             cancel_requested = 0, attempt_count = 0, lease_until = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          modeChanged
            ? `Dans la file · ${assistantModeLabel(conversation.mode)}`
            : 'Dans la file',
          nextStoredMode.requestedMode,
          nextStoredMode.webDepth,
          storedDatabaseMode(conversation.mode),
          extendedMode(conversation.mode),
          modeChanged ? 1 : 0,
          modeChanged ? 1 : 0,
          modeChanged ? 1 : 0,
          modeChanged ? 1 : 0,
          modeChanged ? 1 : 0,
          now,
          runId,
        );
      this.addEvent(
        runId,
        profileId,
        'queued',
        modeChanged
          ? `Reprise en ${assistantModeLabel(conversation.mode)} · ancien traitement écarté`
          : 'Dans la file',
        now,
      );
    })();
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
      const mode = runMode(row);
      let evidence: TavilyEvidence[] = [];
      let fridayFacts: FridayGroundedFact[] = [];
      let creditsUsed = row.credits_used;
      let researchOutcome: AssistantResearchOutcome = 'not_needed';
      let effectiveMode: AssistantStoredEffectiveMode = 'classic';
      if (isWebMode(mode)) {
        const research = await this.research(row, history, controller.signal);
        if (research.awaitingConsent) return;
        evidence = research.evidence;
        creditsUsed = research.creditsUsed;
        researchOutcome = research.outcome;
        effectiveMode = evidence.length > 0 ? 'web' : 'classic';
      } else if (mode === 'friday') {
        this.setRunState(
          row.id,
          row.profile_id,
          'reading',
          'Lecture des données Maison et Robot',
          new Date().toISOString(),
        );
        fridayFacts = this.fridayMemory.query(
          row.profile_id,
          userMessage.content,
        );
      }
      this.database
        .prepare(
          `UPDATE assistant_runs SET effective_mode = ?, research_outcome = ?,
             credits_used = ? WHERE id = ?`,
        )
        .run(effectiveMode, researchOutcome, creditsUsed, row.id);
      this.setRunState(
        row.id,
        row.profile_id,
        'writing',
        evidence.length > 0
          ? `Synthèse de ${evidence.length.toString()} source(s)`
          : 'Rédaction locale',
        new Date().toISOString(),
      );
      let result =
        isWebMode(mode) && evidence.length === 0
          ? {
              content: researchUnavailableAnswer(
                this.researchDiagnostics(
                  row.profile_id,
                  row.conversation_id,
                ).diagnostics.filter(
                  (diagnostic) => diagnostic.runId === row.id,
                ),
              ),
              thinkingUsed: false,
            }
          : mode === 'friday' && fridayFacts.length === 0
            ? {
                content:
                  'Je n’ai trouvé aucun fait local autorisé correspondant à cette question.',
                thinkingUsed: false,
              }
            : await this.engine.answer(history, controller.signal, {
                evidence,
                facts: fridayFacts,
                mode,
                model: row.assistant_model,
                onStage: (label) =>
                  this.setRunState(
                    row.id,
                    row.profile_id,
                    'writing',
                    label,
                    new Date().toISOString(),
                  ),
              });
      if (result.thinkingUsed) {
        this.setRunState(
          row.id,
          row.profile_id,
          'writing',
          'Réflexion approfondie utilisée',
          new Date().toISOString(),
        );
      }
      if (evidence.length > 0 && isWebMode(mode) && this.engine.verifyAnswer) {
        this.setRunState(
          row.id,
          row.profile_id,
          'verifying',
          'Vérification des affirmations',
          new Date().toISOString(),
        );
        const verified = await this.engine.verifyAnswer(
          userMessage.content,
          result.content,
          evidence,
          mode,
          controller.signal,
          row.assistant_model,
        );
        result = {
          content: verified.content,
          thinkingUsed: Boolean(result.thinkingUsed || verified.thinkingUsed),
        };
      }
      if (mode === 'friday' && fridayFacts.length > 0)
        result = groundFridayAnswer(result, fridayFacts);
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
            controller.signal,
            row.assistant_model,
          );
        } catch {
          if (controller.signal.aborted) throw controller.signal.reason;
        }
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      this.complete(
        row,
        result,
        generatedTitle,
        researchOutcome,
        creditsUsed,
        effectiveMode,
      );
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

  private async research(
    row: RunRow,
    history: AssistantMessage[],
    signal: AbortSignal,
  ): Promise<{
    awaitingConsent: boolean;
    creditsUsed: number;
    evidence: TavilyEvidence[];
    outcome: AssistantResearchOutcome;
  }> {
    const maximumQueries = row.conversation_mode === 'web_light' ? 2 : 6;
    let queries = JSON.parse(row.search_queries_json) as string[];
    if (queries.length === 0) {
      this.setRunState(
        row.id,
        row.profile_id,
        'preparing',
        'Analyse de la demande et décision Web',
        new Date().toISOString(),
      );
      const plan = this.engine.planResearch
        ? await this.engine.planResearch(
            history,
            row.conversation_mode as Exclude<AssistantMode, 'local'>,
            maximumQueries,
            signal,
            row.assistant_model,
          )
        : { searchNeeded: true, queries: [history.at(-1)?.content ?? ''] };
      const plannedQueries = plan.queries.length
        ? plan.queries
        : [deterministicSearchQuery(history)];
      const sanitized = plannedQueries
        .slice(0, maximumQueries)
        .map(sanitizeSearchQuery);
      queries = sanitized.map((item) => item.query);
      this.setRunState(
        row.id,
        row.profile_id,
        'preparing',
        `Plan Web prêt · ${queries.length.toString()} recherche(s) ciblée(s)`,
        new Date().toISOString(),
      );
      this.database
        .prepare(
          'UPDATE assistant_runs SET search_queries_json = ? WHERE id = ?',
        )
        .run(JSON.stringify(queries), row.id);
      if (sanitized.some((item) => item.sensitive) && !row.search_consent) {
        this.setRunState(
          row.id,
          row.profile_id,
          'awaiting_search_consent',
          'Consentement requis avant recherche',
          new Date().toISOString(),
        );
        return {
          awaitingConsent: true,
          creditsUsed: 0,
          evidence: [],
          outcome: 'not_needed',
        };
      }
    }

    const usage = await this.webUsage(signal);
    const tavilyAllowed =
      this.tavily.available &&
      usage.creditsUsed < WEB_HARD_LIMIT &&
      !(
        row.conversation_mode === 'web_deep' &&
        usage.creditsUsed >= WEB_DEEP_LIMIT
      );
    const exaState = this.exaUsage();
    const exaAllowed =
      row.conversation_mode === 'web_deep' &&
      (!exaState.cooldownUntil ||
        new Date(exaState.cooldownUntil).valueOf() <= Date.now());

    const evidence: TavilyEvidence[] = (
      this.database
        .prepare(
          `SELECT title, url, published_at, excerpt, provider
             FROM assistant_sources WHERE run_id = ? ORDER BY source_id`,
        )
        .all(row.id) as Array<{
        excerpt: string;
        published_at: string | null;
        title: string;
        url: string;
        provider: 'tavily' | 'exa';
      }>
    ).map((source) => ({
      title: source.title,
      url: source.url,
      publishedAt: source.published_at,
      content: source.excerpt,
      provider: source.provider,
    }));
    const question = history.at(-1)?.content ?? '';
    let creditsUsed = (
      this.database
        .prepare(
          `SELECT COALESCE(SUM(credits_used), 0) AS credits
             FROM assistant_research_attempts WHERE run_id = ?`,
        )
        .get(row.id) as { credits: number }
    ).credits;
    const creditsAtStart = creditsUsed;
    let failures = 0;
    const runBudget = row.conversation_mode === 'web_light' ? 2 : 8;
    if (!tavilyAllowed && queries[0]) {
      failures += 1;
      this.recordSkippedAttempt(
        row.id,
        1,
        'tavily',
        queries[0],
        'Quota Tavily atteint ou connecteur indisponible.',
      );
    }
    if (row.conversation_mode === 'web_deep' && !exaAllowed && queries[0]) {
      failures += 1;
      this.recordSkippedAttempt(
        row.id,
        101,
        'exa',
        queries[0],
        exaState.status === 'rate_limited'
          ? 'Limite gratuite Exa atteinte.'
          : 'Exa est temporairement en pause.',
      );
    }
    const firstExaPromise =
      exaAllowed && queries[0]
        ? this.exaAttempt(row, queries[0], 0, signal)
        : Promise.resolve(null);
    let firstExaConsumed = false;
    let firstExaFailed = false;
    let secondExaPromise: Promise<{
      evidence: TavilyEvidence[];
      failed: boolean;
    }> | null = null;
    const startSecondExaIfNeeded = () => {
      const domains = new Set(
        evidence.map((source) => new URL(source.url).hostname.toLowerCase()),
      ).size;
      const query = queries[2] ?? queries[1] ?? queries[0];
      const health = this.exaUsage();
      if (
        exaAllowed &&
        !firstExaFailed &&
        query &&
        (evidence.length < 4 || domains < 2) &&
        (!health.cooldownUntil ||
          new Date(health.cooldownUntil).valueOf() <= Date.now())
      )
        secondExaPromise = this.exaAttempt(row, query, 1, signal);
    };
    for (const [index, query] of queries.slice(0, maximumQueries).entries()) {
      const depth: TavilySearchDepth =
        row.conversation_mode === 'web_deep' && index >= 4
          ? 'advanced'
          : 'basic';
      const expectedCredits = depth === 'advanced' ? 2 : 1;
      const currentUsage = usage.creditsUsed + (creditsUsed - creditsAtStart);
      if (
        !tavilyAllowed ||
        creditsUsed + expectedCredits > runBudget ||
        currentUsage + expectedCredits > WEB_HARD_LIMIT
      )
        break;
      const previousAttempt = this.database
        .prepare(
          `SELECT id, status, diagnostic_status FROM assistant_research_attempts
            WHERE run_id = ? AND ordinal = ? AND provider = 'tavily'`,
        )
        .get(row.id, index + 1) as
        | {
            diagnostic_status: string | null;
            id: string;
            status: 'planned' | 'completed' | 'failed';
          }
        | undefined;
      if (
        previousAttempt?.status === 'completed' &&
        previousAttempt.diagnostic_status !== 'skipped'
      )
        continue;
      const attemptId = previousAttempt?.id ?? randomUUID();
      const phase = index < 2 ? 'explore' : index < 4 ? 'gap' : 'adversarial';
      const now = new Date().toISOString();
      if (previousAttempt) {
        this.database
          .prepare(
            `UPDATE assistant_research_attempts
                SET status = 'planned', error = NULL, completed_at = NULL WHERE id = ?`,
          )
          .run(attemptId);
      } else {
        this.database
          .prepare(
            `INSERT INTO assistant_research_attempts(
               id, run_id, ordinal, phase, query, search_depth, status, provider, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, 'planned', 'tavily', ?)`,
          )
          .run(attemptId, row.id, index + 1, phase, query, depth, now);
      }
      this.setRunState(
        row.id,
        row.profile_id,
        'searching',
        `Tavily ${(index + 1).toString()}/${queries.length.toString()} · ${depth} · ${progressQuery(query)}`,
        now,
      );
      const startedAt = Date.now();
      try {
        const [result, exaResult] =
          index === 0
            ? await Promise.all([
                this.tavily.search(query, depth, signal),
                firstExaPromise,
              ])
            : [await this.tavily.search(query, depth, signal), null];
        if (index === 0) firstExaConsumed = true;
        creditsUsed += result.creditsUsed;
        const added = this.persistEvidence(
          row.id,
          'tavily',
          evidence,
          result.evidence,
        );
        if (exaResult) {
          firstExaFailed = exaResult.failed;
          if (exaResult.failed) failures += 1;
          this.persistEvidence(row.id, 'exa', evidence, exaResult.evidence);
        }
        if (index === 0) startSecondExaIfNeeded();
        this.database.transaction(() => {
          this.database
            .prepare(
              `UPDATE assistant_research_attempts
                  SET status = 'completed', credits_used = ?, diagnostic_status = ?,
                      result_count = ?, duration_ms = ?, completed_at = ? WHERE id = ?`,
            )
            .run(
              result.creditsUsed,
              added > 0 ? 'success' : 'empty',
              added,
              Date.now() - startedAt,
              new Date().toISOString(),
              attemptId,
            );
          this.recordWebUsage(result.creditsUsed);
        })();
        this.setRunState(
          row.id,
          row.profile_id,
          'searching',
          `Tavily terminé · ${added.toString()} nouvelle(s) source(s)`,
          new Date().toISOString(),
        );
        if (
          row.conversation_mode === 'web_deep' &&
          index >= 1 &&
          index + 1 < queries.length &&
          !shouldContinueDeepResearch(question, queries, evidence)
        ) {
          this.setRunState(
            row.id,
            row.profile_id,
            'searching',
            'Couverture suffisante · recherches supplémentaires évitées',
            new Date().toISOString(),
          );
          break;
        }
      } catch {
        if (signal.aborted) throw signal.reason;
        if (index === 0) {
          const exaResult = await firstExaPromise;
          firstExaConsumed = true;
          if (exaResult) {
            firstExaFailed = exaResult.failed;
            if (exaResult.failed) failures += 1;
            this.persistEvidence(row.id, 'exa', evidence, exaResult.evidence);
          }
          startSecondExaIfNeeded();
        }
        failures += 1;
        this.database
          .prepare(
            `UPDATE assistant_research_attempts
                SET status = 'failed', diagnostic_status = 'unavailable',
                    error = ?, duration_ms = ?, completed_at = ? WHERE id = ?`,
          )
          .run(
            'Tavily est temporairement indisponible.',
            Date.now() - startedAt,
            new Date().toISOString(),
            attemptId,
          );
        this.setRunState(
          row.id,
          row.profile_id,
          'searching',
          'Tavily indisponible · poursuite avec Exa',
          new Date().toISOString(),
        );
      }
    }
    if (!firstExaConsumed) {
      const exaResult = await firstExaPromise;
      if (exaResult) {
        firstExaFailed = exaResult.failed;
        if (exaResult.failed) failures += 1;
        this.persistEvidence(row.id, 'exa', evidence, exaResult.evidence);
        startSecondExaIfNeeded();
      }
    }
    const pendingSecondExa = secondExaPromise as Promise<{
      evidence: TavilyEvidence[];
      failed: boolean;
    }> | null;
    if (pendingSecondExa) {
      const exaResult = await pendingSecondExa;
      if (exaResult.failed) failures += 1;
      this.persistEvidence(row.id, 'exa', evidence, exaResult.evidence);
    }
    const selection = selectResearchEvidence(
      question,
      queries,
      evidence,
      row.conversation_mode as Exclude<AssistantMode, 'local'>,
    );
    if (selection.selected.length > 0) {
      this.replaceEvidence(row.id, selection.selected);
      evidence.splice(0, evidence.length, ...selection.selected);
      this.setRunState(
        row.id,
        row.profile_id,
        'searching',
        `Sélection de ${evidence.length.toString()} source(s) sur ${selection.totalCandidates.toString()} · ${selection.coveredAspects.toString()}/${selection.totalAspects.toString()} aspect(s) couvert(s)`,
        new Date().toISOString(),
      );
    }
    if (evidence.length > 0) {
      this.setRunState(
        row.id,
        row.profile_id,
        'searching',
        `Lecture et rapprochement de ${evidence.length.toString()} source(s)`,
        new Date().toISOString(),
      );
    }
    return {
      awaitingConsent: false,
      creditsUsed,
      evidence,
      outcome:
        evidence.length === 0
          ? !tavilyAllowed && usage.creditsUsed >= WEB_HARD_LIMIT
            ? 'quota_exhausted'
            : 'unavailable'
          : failures > 0 || !selection.complete
            ? 'partial'
            : 'completed',
    };
  }

  private recordWebUsage(credits: number): void {
    const now = new Date().toISOString();
    const month = now.slice(0, 7);
    this.database
      .prepare(
        `INSERT INTO assistant_web_usage(month, credits_used, searches_used, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(month) DO UPDATE SET
           credits_used = credits_used + excluded.credits_used,
           searches_used = searches_used + 1,
           updated_at = excluded.updated_at`,
      )
      .run(month, credits, now);
  }

  private persistEvidence(
    runId: string,
    provider: 'tavily' | 'exa',
    evidence: TavilyEvidence[],
    candidates: TavilyEvidence[],
  ): number {
    let added = 0;
    for (const candidate of candidates) {
      const normalized = normalizeResearchEvidence(candidate);
      if (!normalized) continue;
      const url = canonicalUrl(normalized.url);
      if (!url || evidence.some((item) => canonicalUrl(item.url) === url))
        continue;
      const domain = new URL(url).hostname.toLowerCase();
      if (
        evidence.filter(
          (item) => new URL(item.url).hostname.toLowerCase() === domain,
        ).length >= 3
      )
        continue;
      const source = { ...normalized, provider, url };
      evidence.push(source);
      const sourceId = `S${(
        (
          this.database
            .prepare(
              'SELECT COUNT(*) AS count FROM assistant_sources WHERE run_id = ?',
            )
            .get(runId) as { count: number }
        ).count + 1
      ).toString()}`;
      this.database
        .prepare(
          `INSERT INTO assistant_sources(
             run_id, source_id, title, url, domain, published_at, retrieved_at, excerpt, provider
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          sourceId,
          source.title.slice(0, 500),
          source.url,
          domain,
          source.publishedAt,
          new Date().toISOString(),
          source.content.slice(0, 20_000),
          provider,
        );
      added += 1;
    }
    return added;
  }

  private replaceEvidence(runId: string, selected: TavilyEvidence[]): void {
    const retrievedAt = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare('DELETE FROM assistant_sources WHERE run_id = ?')
        .run(runId);
      const insert = this.database.prepare(
        `INSERT INTO assistant_sources(
           run_id, source_id, title, url, domain, published_at, retrieved_at, excerpt, provider
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [index, source] of selected.entries())
        insert.run(
          runId,
          `S${(index + 1).toString()}`,
          source.title.slice(0, 500),
          source.url,
          new URL(source.url).hostname.toLowerCase(),
          source.publishedAt,
          retrievedAt,
          source.content.slice(0, 20_000),
          source.provider ?? 'tavily',
        );
    })();
  }

  private async exaAttempt(
    row: RunRow,
    query: string,
    index: 0 | 1,
    signal: AbortSignal,
  ): Promise<{ evidence: TavilyEvidence[]; failed: boolean }> {
    const ordinal = 101 + index;
    const previous = this.database
      .prepare(
        `SELECT id, status, diagnostic_status FROM assistant_research_attempts
          WHERE run_id = ? AND ordinal = ? AND provider = 'exa'`,
      )
      .get(row.id, ordinal) as
      | {
          diagnostic_status: string | null;
          id: string;
          status: 'planned' | 'completed' | 'failed';
        }
      | undefined;
    if (
      previous?.status === 'completed' &&
      previous.diagnostic_status !== 'skipped'
    )
      return { evidence: [], failed: false };
    const id = previous?.id ?? randomUUID();
    const now = new Date().toISOString();
    if (previous) {
      this.database
        .prepare(
          `UPDATE assistant_research_attempts SET status = 'planned', error = NULL,
                  diagnostic_status = NULL, completed_at = NULL WHERE id = ?`,
        )
        .run(id);
    } else {
      this.database
        .prepare(
          `INSERT INTO assistant_research_attempts(
             id, run_id, ordinal, phase, query, search_depth, status, provider, created_at
           ) VALUES (?, ?, ?, ?, ?, 'basic', 'planned', 'exa', ?)`,
        )
        .run(id, row.id, ordinal, index === 0 ? 'explore' : 'gap', query, now);
    }
    this.recordExaCall();
    this.setRunState(
      row.id,
      row.profile_id,
      'searching',
      `Exa ${index + 1}/2 · ${progressQuery(query)}`,
      now,
    );
    const startedAt = Date.now();
    try {
      const result = await this.exa.search(query, signal);
      const status = result.evidence.length > 0 ? 'success' : 'empty';
      this.database
        .prepare(
          `UPDATE assistant_research_attempts SET status = 'completed',
                  diagnostic_status = ?, result_count = ?, duration_ms = ?,
                  completed_at = ? WHERE id = ?`,
        )
        .run(
          status,
          result.evidence.length,
          Date.now() - startedAt,
          new Date().toISOString(),
          id,
        );
      this.recordExaOutcome(status, null);
      return { evidence: result.evidence, failed: false };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      const failure = exaFailure(error);
      this.database
        .prepare(
          `UPDATE assistant_research_attempts SET status = 'failed',
                  diagnostic_status = ?, error = ?, duration_ms = ?,
                  completed_at = ? WHERE id = ?`,
        )
        .run(
          failure.kind,
          failure.message,
          Date.now() - startedAt,
          new Date().toISOString(),
          id,
        );
      this.recordExaOutcome(failure.kind, failure.retryAt);
      return { evidence: [], failed: true };
    }
  }

  private recordExaCall(): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO assistant_exa_usage(month, calls, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(month) DO UPDATE SET calls = calls + 1,
           updated_at = excluded.updated_at`,
      )
      .run(now.slice(0, 7), now);
  }

  private recordExaOutcome(
    status: 'success' | 'empty' | ExaFailureKind,
    retryAt: string | null,
  ): void {
    const now = new Date().toISOString();
    const column =
      status === 'success'
        ? 'successes'
        : status === 'empty'
          ? 'empty_results'
          : status === 'rate_limited'
            ? 'rate_limits'
            : 'failures';
    this.database
      .prepare(
        `INSERT INTO assistant_exa_usage(month, ${column}, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(month) DO UPDATE SET ${column} = ${column} + 1,
           updated_at = excluded.updated_at`,
      )
      .run(now.slice(0, 7), now);
    const cooldownUntil =
      status === 'rate_limited'
        ? (retryAt ?? new Date(Date.now() + 60 * 60_000).toISOString())
        : status === 'unavailable'
          ? new Date(Date.now() + 2 * 60_000).toISOString()
          : null;
    const health =
      status === 'success' || status === 'empty'
        ? 'available'
        : status === 'rate_limited'
          ? 'rate_limited'
          : 'unavailable';
    this.database
      .prepare(
        `UPDATE assistant_exa_health SET status = ?, last_attempt_at = ?,
                last_message = ?, cooldown_until = ? WHERE id = 1`,
      )
      .run(health, now, diagnosticMessage('exa', status, null), cooldownUntil);
  }

  private recordSkippedAttempt(
    runId: string,
    ordinal: number,
    provider: 'tavily' | 'exa',
    query: string,
    message: string,
  ): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO assistant_research_attempts(
           id, run_id, ordinal, phase, query, search_depth, status, provider,
           diagnostic_status, error, result_count, duration_ms, created_at, completed_at
         ) VALUES (?, ?, ?, 'explore', ?, 'basic', 'completed', ?, 'skipped', ?, 0, 0, ?, ?)`,
      )
      .run(
        randomUUID(),
        runId,
        ordinal,
        query,
        provider,
        message,
        new Date().toISOString(),
        new Date().toISOString(),
      );
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
    result: Awaited<ReturnType<AssistantEngine['answer']>>,
    generatedTitle: string | null,
    researchOutcome: AssistantResearchOutcome,
    creditsUsed: number,
    effectiveMode: AssistantStoredEffectiveMode,
  ): void {
    const messageId = randomUUID();
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO assistant_messages(
             id, conversation_id, profile_id, role, content, effective_mode, web_depth,
             conversation_mode, conversation_mode_v2, assistant_model, thinking_policy, thinking_used, research_outcome, credits_used,
             run_id, created_at
           ) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          messageId,
          row.conversation_id,
          row.profile_id,
          result.content,
          effectiveMode,
          row.web_depth,
          storedDatabaseMode(runMode(row)),
          extendedMode(runMode(row)),
          row.assistant_model,
          row.thinking_policy,
          result.thinkingUsed ? 1 : 0,
          researchOutcome,
          creditsUsed,
          row.id,
          now,
        );
      this.database
        .prepare(
          `UPDATE assistant_runs SET assistant_message_id = ?, status = 'completed',
             stage_label = 'Terminé', thinking_used = ?, research_outcome = ?,
             credits_used = ?, effective_mode = ?, lease_until = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(
          messageId,
          result.thinkingUsed ? 1 : 0,
          researchOutcome,
          creditsUsed,
          effectiveMode,
          now,
          row.id,
        );
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
        'SELECT id, title, mode, mode_v2, archived_at, created_at, updated_at FROM assistant_conversations WHERE id = ? AND profile_id = ?',
      )
      .get(id, profileId) as ConversationRow | undefined;
    if (!row) throw new AssistantNotFoundError('Conversation introuvable.');
    return this.toConversation(row);
  }

  private getMessage(profileId: string, id: string): AssistantMessage {
    const row = this.database
      .prepare(
        `SELECT id, conversation_id, role, content, requested_mode, effective_mode, web_depth,
                 conversation_mode, conversation_mode_v2, assistant_model, thinking_policy, thinking_used, research_outcome, credits_used,
                run_id, created_at
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
      mode: row.mode_v2 ?? row.mode,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private toMessage(row: MessageRow): AssistantMessage {
    const sourceRows =
      row.role === 'assistant' && row.run_id
        ? (this.database
            .prepare(
              'SELECT source_id, title, url, domain, published_at, retrieved_at FROM assistant_sources WHERE run_id = ? ORDER BY source_id',
            )
            .all(row.run_id) as SourceRow[])
        : [];
    const progressEventRows =
      row.role === 'assistant' && row.run_id
        ? (this.database
            .prepare(
              `SELECT sequence, run_id, status, label, created_at
                 FROM assistant_run_events WHERE run_id = ? ORDER BY sequence`,
            )
            .all(row.run_id) as RunEventRow[])
        : [];
    return AssistantMessageSchema.parse({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      requestedMode: row.requested_mode,
      effectiveMode: row.effective_mode,
      webDepth: row.web_depth,
      mode: row.conversation_mode_v2 ?? row.conversation_mode,
      model: row.assistant_model,
      thinkingPolicy: row.thinking_policy,
      thinkingUsed: Boolean(row.thinking_used),
      researchOutcome: row.research_outcome,
      creditsUsed: row.credits_used,
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
      progressEvents: progressEventRows.map(toRunEvent),
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
      mode: row.conversation_mode_v2 ?? row.conversation_mode,
      model: row.assistant_model,
      thinkingPolicy: row.thinking_policy,
      thinkingUsed: Boolean(row.thinking_used),
      researchOutcome: row.research_outcome,
      creditsUsed: row.credits_used,
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

function toRunEvent(row: RunEventRow): AssistantRunEvent {
  return AssistantRunEventSchema.parse({
    sequence: row.sequence,
    runId: row.run_id,
    status: row.status,
    label: row.label,
    createdAt: row.created_at,
  });
}

function progressQuery(query: string): string {
  const compact = query.replace(/\s+/gu, ' ').trim();
  return compact.length <= 88 ? compact : `${compact.slice(0, 85)}…`;
}

function storedMode(mode: AssistantMode): {
  requestedMode: 'classic' | 'web';
  webDepth: AssistantStoredWebDepth | null;
} {
  if (mode === 'local' || mode === 'friday')
    return { requestedMode: 'classic', webDepth: null };
  return {
    requestedMode: 'web',
    webDepth: mode === 'web_light' ? 'fast' : 'deep',
  };
}

function assistantModeLabel(mode: AssistantMode): string {
  if (mode === 'local') return 'Local';
  if (mode === 'friday') return 'Friday';
  return mode === 'web_light' ? 'Web léger' : 'Web approfondi';
}

function storedDatabaseMode(
  mode: AssistantMode,
): Exclude<AssistantMode, 'friday'> {
  return mode === 'friday' ? 'local' : mode;
}

function extendedMode(mode: AssistantMode): 'friday' | null {
  return mode === 'friday' ? 'friday' : null;
}

function runMode(row: RunRow): AssistantMode {
  return row.conversation_mode_v2 ?? row.conversation_mode;
}

function isWebMode(
  mode: AssistantMode,
): mode is Extract<AssistantMode, 'web_deep' | 'web_light'> {
  return mode === 'web_light' || mode === 'web_deep';
}

function groundFridayAnswer(
  result: Awaited<ReturnType<AssistantEngine['answer']>>,
  facts: FridayGroundedFact[],
): Awaited<ReturnType<AssistantEngine['answer']>> {
  const allowed = new Set(facts.map((fact) => fact.id));
  const cited = [...result.content.matchAll(/\[(F\d+)\]/gu)].map(
    (match) => match[1] ?? '',
  );
  if (cited.length > 0 && cited.every((id) => allowed.has(id))) return result;
  return {
    content: facts
      .slice(0, 12)
      .map((fact) => {
        const freshness = fact.observedAt ? ` · ${fact.observedAt}` : '';
        const confidence =
          fact.confidence === null
            ? ''
            : ` · confiance ${Math.round(fact.confidence * 100).toString()} %`;
        return `- ${fact.title} : ${fact.detail}${freshness}${confidence} [${fact.id}]`;
      })
      .join('\n'),
    thinkingUsed: false,
  };
}

function sanitizeSearchQuery(input: string): {
  query: string;
  sensitive: boolean;
} {
  let sensitive = false;
  const query = input
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, () => {
      sensitive = true;
      return '[adresse e-mail retirée]';
    })
    .replace(/(?:\+33|0)[1-9](?:[ .-]?\d{2}){4}/gu, () => {
      sensitive = true;
      return '[numéro retiré]';
    })
    .replace(
      /\b\d{1,4}\s+(?:rue|avenue|boulevard|chemin|impasse|allée)\b[^,;]*/giu,
      () => {
        sensitive = true;
        return '[adresse retirée]';
      },
    )
    .trim();
  return { query, sensitive };
}

function deterministicSearchQuery(history: AssistantMessage[]): string {
  const users = history
    .filter((message) => message.role === 'user')
    .slice(-2)
    .map((message) => message.content.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  return users.join(' — ').slice(0, 500) || 'information demandée';
}

function canonicalUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid)$/iu.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/u, '');
    return url.toString();
  } catch {
    return null;
  }
}

function exaFailure(error: unknown): {
  kind: ExaFailureKind;
  message: string;
  retryAt: string | null;
} {
  if (error instanceof ExaMcpError)
    return { kind: error.kind, message: error.message, retryAt: error.retryAt };
  return {
    kind: 'unavailable',
    message: 'Exa est temporairement indisponible.',
    retryAt: null,
  };
}

function aggregateDiagnosticStatus(
  statuses: ResearchDiagnostic['status'][],
): ResearchDiagnostic['status'] {
  const priority: ResearchDiagnostic['status'][] = [
    'rate_limited',
    'unavailable',
    'failed',
    'success',
    'empty',
    'skipped',
  ];
  return priority.find((status) => statuses.includes(status)) ?? 'skipped';
}

function diagnosticMessage(
  provider: ResearchDiagnostic['provider'],
  status: ResearchDiagnostic['status'] | 'success' | 'empty',
  error: string | null,
): string {
  const name = provider === 'exa' ? 'Exa' : 'Tavily';
  if (status === 'success') return `${name} a fourni des sources.`;
  if (status === 'empty')
    return `${name} n’a trouvé aucune source exploitable.`;
  if (status === 'rate_limited') return 'Limite gratuite Exa atteinte.';
  if (status === 'skipped') return `${name} n’a pas été interrogé.`;
  if (status === 'unavailable')
    return `${name} est temporairement indisponible.`;
  return (error || `${name} a refusé la recherche.`)
    .replace(/[\r\n]+/gu, ' ')
    .slice(0, 160);
}

function researchUnavailableAnswer(diagnostics: ResearchDiagnostic[]): string {
  const details = diagnostics.length
    ? diagnostics
        .map(
          (diagnostic) =>
            `- ${diagnostic.provider === 'exa' ? 'Exa' : 'Tavily'} : ${diagnostic.message}`,
        )
        .join('\n')
    : '- Aucun moteur n’a pu être interrogé.';
  return [
    'Je n’ai obtenu aucune source Web exploitable pour cette demande.',
    '',
    details,
    '',
    'Tu peux relancer la recherche : Friday réessaiera les moteurs disponibles.',
  ].join('\n');
}
