import { createHash, randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import {
  WatchArticleSchema,
  WatchConceptSchema,
  WatchDigestSchema,
  WatchDiscoverySchema,
  WatchOverviewSchema,
  WatchRunProgressSchema,
  WatchSchema,
  WatchTopicSchema,
  type Watch,
  type WatchArticle,
  type WatchArticleStateValue,
  type WatchConcept,
  type WatchConceptState,
  type WatchCreateRequest,
  type WatchDigest,
  type WatchDiscovery,
  type WatchDiscoveryRequest,
  type WatchOverview,
  type WatchSourceKind,
  type WatchTopic,
  type WatchTopicEventKind,
  type WatchThemeProposal,
} from '@friday/contracts';

import type {
  WatchLanguageEngine,
  WatchAnalysis,
  WatchSynthesis,
} from './ollama-watch-engine.js';
import { TavilySearchClient } from './tavily-search.js';
import { SecureFeedClient, type ValidatedFeed } from './feed-client.js';

const FETCH_INTERVAL_MS = 6 * 60 * 60_000;
const RETENTION_MS = 183 * 24 * 60 * 60_000;
type WatchRunTrigger =
  'initialization' | 'scheduled' | 'catch_up' | 'manual' | 'resume';

interface WatchRow {
  baseline_completed_at: string | null;
  cadence: 'daily' | 'weekly';
  created_at: string;
  exclude_keywords_json: string;
  id: string;
  include_keywords_json: string;
  languages_json: string;
  last_web_search_at: string | null;
  local_time: string;
  memory_initialized_at: string | null;
  name: string;
  next_digest_at: string;
  profile_id: string;
  question: string;
  status: 'active' | 'paused';
  time_zone: string;
  updated_at: string;
  weekday: number | null;
}

interface FeedRow {
  etag: string | null;
  feed_url: string;
  id: string;
  last_modified: string | null;
  site_url: string;
  title: string;
  source_mode: 'rss' | 'web';
}

interface DiscoveryCandidate {
  feedUrl: string | null;
  id: string;
  kind: WatchSourceKind;
  language: string;
  reason: string;
  score: number;
  siteUrl: string;
  status: 'validated' | 'rejected';
  title: string;
}

interface WatchAnalysisCandidate {
  canonical_url: string;
  excerpt: string;
  id: string;
  source_id: string;
  source_title: string;
  title: string;
}

export class WatchNotFoundError extends Error {}

export class WatchService {
  private processing: Promise<void> | null = null;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: Database.Database,
    private readonly engine: WatchLanguageEngine,
    private readonly feedClient = new SecureFeedClient(),
    private readonly tavily = new TavilySearchClient(undefined),
  ) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE watch_runs SET status = 'queued', stage = 'queued', trigger = 'resume',
                error_message = NULL, updated_at = ?
          WHERE status IN ('collecting', 'analyzing')`,
      )
      .run(now);
    this.initializeLegacyMemory(now);
    this.queueDueWatches(now, true);
    this.timer = setInterval(() => this.schedule(), 60_000);
    this.timer.unref?.();
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.processing?.catch(() => undefined);
  }

  async validateSource(
    url: string,
    signal: AbortSignal,
  ): Promise<ValidatedFeed> {
    return this.feedClient.validate(url, signal);
  }

  async suggestSources(
    query: string,
    signal: AbortSignal,
  ): Promise<ValidatedFeed[]> {
    const discovery = await this.discoverSources(
      'legacy',
      {
        name: query.slice(0, 80),
        question: query,
        includeKeywords: [],
        excludeKeywords: [],
        languages: ['fr', 'en'],
      },
      signal,
      false,
    );
    return discovery.candidates.flatMap((candidate) =>
      candidate.status === 'validated' && candidate.feedUrl
        ? [
            {
              title: candidate.title,
              siteUrl: candidate.siteUrl,
              feedUrl: candidate.feedUrl,
            },
          ]
        : [],
    );
  }

  async discoverSources(
    profileId: string,
    input: WatchDiscoveryRequest,
    signal: AbortSignal,
    persist = true,
  ): Promise<WatchDiscovery> {
    if (!this.tavily.available)
      throw new Error('La recherche de sources Tavily est indisponible.');
    const fallbackConcepts = uniqueKeywords([
      ...input.includeKeywords,
      ...input.question.split(/[,.;:]/u).map((part) => part.trim()),
    ]).slice(0, 12);
    const fallbackKinds: WatchSourceKind[] = [
      'official',
      'research',
      'specialized_press',
      'general_press',
    ];
    const plan = this.engine.planWatchDiscovery
      ? await this.engine.planWatchDiscovery(input, signal)
      : {
          concepts: fallbackConcepts,
          themes: fallbackWatchThemes(input),
          queries: fallbackKinds.map((kind) => ({
            kind,
            query: `${input.question} ${kind.replaceAll('_', ' ')}`,
          })),
        };
    const searches = await Promise.all(
      plan.queries.slice(0, 4).map(async (planned) => ({
        kind: planned.kind,
        result: await this.tavily.search(
          `${sanitizeSuggestionQuery(planned.query)} flux RSS Atom`,
          'basic',
          signal,
        ),
      })),
    );
    const evidence = new Map<
      string,
      { kind: WatchSourceKind; title: string; url: string; rank: number }
    >();
    for (const search of searches)
      search.result.evidence.forEach((item, rank) => {
        try {
          const url = new URL(item.url).toString();
          const key = new URL(url).origin;
          if (!evidence.has(key))
            evidence.set(key, {
              kind: search.kind,
              title: item.title,
              url,
              rank,
            });
        } catch {
          // Tavily output is untrusted and malformed URLs are ignored.
        }
      });
    const examined = [...evidence.values()].slice(0, 20);
    const settled = await Promise.allSettled(
      examined.map(async (candidate) => {
        try {
          return await this.feedClient.validate(candidate.url, signal);
        } catch {
          return this.feedClient.validate(
            new URL(candidate.url).origin,
            signal,
          );
        }
      }),
    );
    const candidates: DiscoveryCandidate[] = examined.map(
      (candidate, index) => {
        const result = settled[index];
        const validated = result?.status === 'fulfilled' ? result.value : null;
        return {
          id: randomUUID(),
          title: validated?.title ?? candidate.title.slice(0, 300),
          siteUrl: validated?.siteUrl ?? candidate.url,
          feedUrl: validated?.feedUrl ?? null,
          kind: candidate.kind,
          language: input.languages[0] ?? 'fr',
          score: Math.max(0.35, 0.95 - candidate.rank * 0.1),
          reason: validated
            ? sourceReason(candidate.kind)
            : result?.status === 'rejected'
              ? String(result.reason).slice(0, 500)
              : 'Aucun flux RSS ou Atom vérifiable.',
          status: validated ? ('validated' as const) : ('rejected' as const),
        };
      },
    );
    const selected = diversifyCandidates(candidates, 15);
    const discovery = WatchDiscoverySchema.parse({
      id: randomUUID(),
      concepts: uniqueKeywords([...plan.concepts, ...input.includeKeywords]),
      themes: stableWatchThemes(plan.themes, input),
      candidates: [
        ...selected,
        ...candidates.filter(
          (candidate) =>
            candidate.status === 'rejected' &&
            !selected.some((item) => item.id === candidate.id),
        ),
      ].slice(0, 40),
      examinedCount: examined.length,
      validatedCount: candidates.filter(
        (candidate) => candidate.status === 'validated',
      ).length,
      creditsUsed: searches.reduce(
        (total, search) => total + search.result.creditsUsed,
        0,
      ),
      createdAt: new Date().toISOString(),
    });
    if (persist)
      this.persistDiscovery(profileId, input, plan.queries, discovery);
    return discovery;
  }

  async create(
    profileId: string,
    input: WatchCreateRequest,
    signal: AbortSignal,
  ): Promise<Watch> {
    const active = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM watches
          WHERE profile_id = ? AND status = 'active'`,
      )
      .get(profileId) as { count: number };
    if (active.count >= 10)
      throw new Error('Limite de 10 veilles actives atteinte.');
    assertTimeZone(input.timeZone);
    const validated = await Promise.all(
      input.sources.map((source) =>
        this.feedClient.validate(source.feedUrl, signal),
      ),
    );
    const id = randomUUID();
    const now = new Date();
    const nextDigestAt = nextScheduledAt(input, now).toISOString();
    const themes = stableWatchThemes(input.themes ?? [], input);
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO watches(
             id, profile_id, name, question, include_keywords_json,
             exclude_keywords_json, languages_json, cadence, local_time, weekday, time_zone,
             status, next_digest_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .run(
          id,
          profileId,
          input.name,
          input.question,
          JSON.stringify(uniqueKeywords(input.includeKeywords)),
          JSON.stringify(uniqueKeywords(input.excludeKeywords)),
          JSON.stringify(input.languages),
          input.cadence,
          input.localTime,
          input.weekday,
          input.timeZone,
          nextDigestAt,
          now.toISOString(),
          now.toISOString(),
        );
      for (const source of validated) {
        const feedId = this.upsertFeed(source, now.toISOString());
        this.database
          .prepare(
            'INSERT OR IGNORE INTO watch_sources(watch_id, feed_id) VALUES (?, ?)',
          )
          .run(id, feedId);
      }
      for (const label of uniqueKeywords([
        ...input.concepts,
        ...input.includeKeywords,
      ]))
        this.insertConcept(id, profileId, label, 'tracked', 'user', now);
      for (const theme of themes)
        this.insertInitialTheme(id, profileId, theme, now);
      this.queueRun(id, profileId, 'initialization', now.toISOString());
    })();
    this.schedule();
    return this.get(profileId, id);
  }

  async update(
    profileId: string,
    id: string,
    input: {
      [Key in keyof WatchCreateRequest]?: WatchCreateRequest[Key] | undefined;
    } & { status?: 'active' | 'paused' | undefined },
    signal: AbortSignal,
  ): Promise<Watch> {
    const current = this.get(profileId, id);
    const merged: WatchCreateRequest = {
      name: input.name ?? current.name,
      question: input.question ?? current.question,
      includeKeywords: input.includeKeywords ?? current.includeKeywords,
      excludeKeywords: input.excludeKeywords ?? current.excludeKeywords,
      concepts: input.concepts ?? current.concepts,
      themes: input.themes ?? [],
      languages: input.languages ?? current.languages,
      cadence: input.cadence ?? current.cadence,
      localTime: input.localTime ?? current.localTime,
      weekday: input.weekday === undefined ? current.weekday : input.weekday,
      timeZone: input.timeZone ?? current.timeZone,
      sources: (input.sources ?? current.sources).map((source) => ({
        title: source.title,
        siteUrl: source.siteUrl,
        feedUrl: source.feedUrl,
      })),
    };
    assertTimeZone(merged.timeZone);
    const validated = input.sources
      ? await Promise.all(
          input.sources.map((source) =>
            this.feedClient.validate(source.feedUrl, signal),
          ),
        )
      : null;
    const now = new Date();
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE watches SET name = ?, question = ?, include_keywords_json = ?,
             exclude_keywords_json = ?, languages_json = ?, cadence = ?, local_time = ?, weekday = ?,
             time_zone = ?, status = ?, next_digest_at = ?, updated_at = ?
           WHERE id = ? AND profile_id = ?`,
        )
        .run(
          merged.name,
          merged.question,
          JSON.stringify(uniqueKeywords(merged.includeKeywords)),
          JSON.stringify(uniqueKeywords(merged.excludeKeywords)),
          JSON.stringify(merged.languages),
          merged.cadence,
          merged.localTime,
          merged.weekday,
          merged.timeZone,
          input.status ?? current.status,
          nextScheduledAt(merged, now).toISOString(),
          now.toISOString(),
          id,
          profileId,
        );
      if (validated) {
        this.database
          .prepare('DELETE FROM watch_sources WHERE watch_id = ?')
          .run(id);
        for (const source of validated) {
          const feedId = this.upsertFeed(source, now.toISOString());
          this.database
            .prepare(
              'INSERT INTO watch_sources(watch_id, feed_id) VALUES (?, ?)',
            )
            .run(id, feedId);
        }
      }
      if (input.concepts)
        for (const label of uniqueKeywords(input.concepts))
          this.insertConcept(id, profileId, label, 'tracked', 'user', now);
    })();
    return this.get(profileId, id);
  }

  addDiscoveredSources(
    profileId: string,
    watchId: string,
    discoveryId: string,
    candidateIds: string[],
  ): { addedCount: number; watch: Watch } {
    this.requireWatchRow(profileId, watchId);
    const discovery = this.database
      .prepare(
        `SELECT id FROM watch_discovery_runs
          WHERE id = ? AND profile_id = ?`,
      )
      .get(discoveryId, profileId);
    if (!discovery)
      throw new Error('Cette recherche de sources est introuvable.');
    const uniqueCandidateIds = [...new Set(candidateIds)];
    const candidates = this.database
      .prepare(
        `SELECT id, title, site_url, feed_url
           FROM watch_source_candidates
          WHERE discovery_id = ? AND status = 'validated'
            AND feed_url IS NOT NULL`,
      )
      .all(discoveryId) as Array<{
      feed_url: string;
      id: string;
      site_url: string;
      title: string;
    }>;
    const selected = candidates.filter((candidate) =>
      uniqueCandidateIds.includes(candidate.id),
    );
    if (selected.length !== uniqueCandidateIds.length)
      throw new Error(
        'Une source sélectionnée n’appartient pas à cette recherche.',
      );
    const existingFeeds = new Set(
      (
        this.database
          .prepare(
            `SELECT f.feed_url FROM watch_sources s
              JOIN watch_feeds f ON f.id = s.feed_id
             WHERE s.watch_id = ? AND f.source_mode = 'rss'`,
          )
          .all(watchId) as Array<{ feed_url: string }>
      ).map((row) => row.feed_url),
    );
    const newSourceCount = selected.filter(
      (candidate) => !existingFeeds.has(candidate.feed_url),
    ).length;
    if (existingFeeds.size + newSourceCount > 15)
      throw new Error('Une veille ne peut pas contenir plus de 15 sources.');
    const now = new Date().toISOString();
    let addedCount = 0;
    this.database.transaction(() => {
      for (const candidate of selected) {
        const feedId = this.upsertFeed(
          {
            title: candidate.title,
            siteUrl: candidate.site_url,
            feedUrl: candidate.feed_url,
          },
          now,
        );
        const inserted = this.database
          .prepare(
            'INSERT OR IGNORE INTO watch_sources(watch_id, feed_id) VALUES (?, ?)',
          )
          .run(watchId, feedId);
        addedCount += inserted.changes;
      }
      if (addedCount > 0)
        this.database
          .prepare('UPDATE watches SET updated_at = ? WHERE id = ?')
          .run(now, watchId);
    })();
    return { addedCount, watch: this.get(profileId, watchId) };
  }

  delete(profileId: string, id: string): void {
    const result = this.database
      .prepare('DELETE FROM watches WHERE id = ? AND profile_id = ?')
      .run(id, profileId);
    if (result.changes === 0) throw new WatchNotFoundError();
  }

  runNow(profileId: string, id: string): void {
    this.get(profileId, id);
    this.queueRun(id, profileId, 'manual', new Date().toISOString());
    this.schedule();
  }

  setArticleState(
    profileId: string,
    watchId: string,
    articleId: string,
    operationId: string,
    state: WatchArticleStateValue,
    exclusionKeyword: string | null,
  ): WatchArticle {
    this.get(profileId, watchId);
    const previous = this.database
      .prepare(
        'SELECT result_json FROM watch_state_operations WHERE operation_id = ?',
      )
      .get(operationId) as { result_json: string } | undefined;
    if (previous)
      return WatchArticleSchema.parse(JSON.parse(previous.result_json));
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO watch_article_states(profile_id, watch_id, article_id, state, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(profile_id, watch_id, article_id) DO UPDATE SET
             state = excluded.state, updated_at = excluded.updated_at`,
        )
        .run(profileId, watchId, articleId, state, now);
      if (state === 'hidden' && exclusionKeyword) {
        const row = this.requireWatchRow(profileId, watchId);
        const exclusions = uniqueKeywords([
          ...(JSON.parse(row.exclude_keywords_json) as string[]),
          exclusionKeyword,
        ]);
        this.database
          .prepare(
            'UPDATE watches SET exclude_keywords_json = ?, updated_at = ? WHERE id = ?',
          )
          .run(JSON.stringify(exclusions), now, watchId);
      }
    })();
    const article = this.getArticle(profileId, watchId, articleId);
    this.database
      .prepare(
        `INSERT INTO watch_state_operations(operation_id, profile_id, result_json, applied_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(operationId, profileId, JSON.stringify(article), now);
    return article;
  }

  overview(profileId: string): WatchOverview {
    const watches = (
      this.database
        .prepare(
          'SELECT * FROM watches WHERE profile_id = ? ORDER BY updated_at DESC',
        )
        .all(profileId) as WatchRow[]
    ).map((row) => this.toWatch(row));
    const articles = this.listArticles(profileId);
    const digests = this.listDigests(profileId);
    const concepts = this.listConcepts(profileId);
    const topics = this.listTopics(profileId);
    const runs = (
      this.database
        .prepare(
          `SELECT id, watch_id, trigger, stage, progress_current, progress_total,
                  error_message, updated_at
             FROM (
               SELECT id, watch_id, trigger, stage, progress_current,
                      progress_total, error_message, updated_at,
                      ROW_NUMBER() OVER (
                        PARTITION BY watch_id
                        ORDER BY created_at DESC, rowid DESC
                      ) AS watch_run_rank
                 FROM watch_runs
                WHERE profile_id = ?
             )
            WHERE watch_run_rank = 1
            ORDER BY updated_at DESC LIMIT 20`,
        )
        .all(profileId) as Array<Record<string, unknown>>
    ).map((row) =>
      WatchRunProgressSchema.parse({
        id: row.id,
        watchId: row.watch_id,
        trigger: row.trigger,
        stage: row.stage,
        current: row.progress_current,
        total: row.progress_total,
        error: row.error_message,
        updatedAt: row.updated_at,
      }),
    );
    return WatchOverviewSchema.parse({
      watches,
      articles,
      digests,
      concepts,
      topics,
      runs,
      unreadRelevantCount: articles.filter(
        (article) =>
          article.relevant && !article.baseline && article.state === 'unread',
      ).length,
    });
  }

  get(profileId: string, id: string): Watch {
    return this.toWatch(this.requireWatchRow(profileId, id));
  }

  setConceptState(
    profileId: string,
    watchId: string,
    conceptId: string,
    operationId: string,
    state: WatchConceptState,
  ): WatchConcept {
    this.requireWatchRow(profileId, watchId);
    const replay = this.database
      .prepare(
        'SELECT result_json FROM watch_concept_state_operations WHERE operation_id = ? AND profile_id = ?',
      )
      .get(operationId, profileId) as { result_json: string } | undefined;
    if (replay) return WatchConceptSchema.parse(JSON.parse(replay.result_json));
    const now = new Date().toISOString();
    const updated = this.database
      .prepare(
        'UPDATE watch_concepts SET state = ?, last_seen_at = ? WHERE id = ? AND watch_id = ? AND profile_id = ?',
      )
      .run(state, now, conceptId, watchId, profileId);
    if (updated.changes === 0) throw new WatchNotFoundError();
    const concept = this.listConcepts(profileId).find(
      (item) => item.id === conceptId && item.watchId === watchId,
    );
    if (!concept) throw new WatchNotFoundError();
    this.database
      .prepare(
        `INSERT INTO watch_concept_state_operations(operation_id, profile_id, result_json, applied_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(operationId, profileId, JSON.stringify(concept), now);
    return concept;
  }

  private schedule(): void {
    if (this.stopped || this.processing) return;
    this.processing = this.process().finally(() => {
      this.processing = null;
      if (
        !this.stopped &&
        this.database
          .prepare("SELECT 1 FROM watch_runs WHERE status = 'queued' LIMIT 1")
          .get()
      )
        queueMicrotask(() => this.schedule());
    });
  }

  private async process(): Promise<void> {
    this.queueDueWatches(new Date().toISOString(), false);
    const run = this.database
      .prepare(
        `SELECT id, watch_id, profile_id, trigger FROM watch_runs
          WHERE status = 'queued' ORDER BY created_at LIMIT 1`,
      )
      .get() as
      | {
          id: string;
          profile_id: string;
          trigger: WatchRunTrigger;
          watch_id: string;
        }
      | undefined;
    if (!run) {
      this.purgeOldArticles();
      return;
    }
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE watch_runs SET status = 'collecting', stage = 'collecting', updated_at = ? WHERE id = ?`,
      )
      .run(now, run.id);
    try {
      await this.fetchFeedsForWatch(run.watch_id);
      await this.collectWebComplement(run.profile_id, run.watch_id);
      this.database
        .prepare(
          `UPDATE watch_runs SET status = 'analyzing', stage = 'extracting', updated_at = ? WHERE id = ?`,
        )
        .run(new Date().toISOString(), run.id);
      await this.generateDigest(run.profile_id, run.watch_id, run.id);
      this.database
        .prepare(
          `UPDATE watches SET memory_initialized_at = COALESCE(memory_initialized_at, ?),
                              updated_at = ?
            WHERE id = ?`,
        )
        .run(new Date().toISOString(), new Date().toISOString(), run.watch_id);
      this.database
        .prepare(
          `UPDATE watch_runs SET status = 'completed', stage = 'completed', updated_at = ? WHERE id = ?`,
        )
        .run(new Date().toISOString(), run.id);
    } catch (error) {
      const failedAt = new Date();
      this.database
        .prepare(
          `UPDATE watch_runs SET status = 'failed', stage = 'failed', error_message = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          error instanceof Error ? error.message.slice(0, 500) : String(error),
          failedAt.toISOString(),
          run.id,
        );
      const watch = this.database
        .prepare('SELECT * FROM watches WHERE id = ?')
        .get(run.watch_id) as WatchRow | undefined;
      if (watch)
        this.database
          .prepare(
            'UPDATE watches SET next_digest_at = ?, updated_at = ? WHERE id = ?',
          )
          .run(
            nextScheduledAt(this.toWatch(watch), failedAt).toISOString(),
            failedAt.toISOString(),
            run.watch_id,
          );
    }
    if (!this.stopped) queueMicrotask(() => this.schedule());
  }

  private async collectWebComplement(
    profileId: string,
    watchId: string,
  ): Promise<void> {
    if (!this.tavily.available) return;
    const watch = this.requireWatchRow(profileId, watchId);
    const rssCount = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM watch_sources s
          JOIN watch_feeds f ON f.id = s.feed_id
          WHERE s.watch_id = ? AND f.source_mode = 'rss'`,
      )
      .get(watchId) as { count: number };
    if (rssCount.count >= 6) return;
    if (
      watch.last_web_search_at &&
      Date.now() - new Date(watch.last_web_search_at).valueOf() <
        24 * 60 * 60_000
    )
      return;
    const month = new Date().toISOString().slice(0, 7);
    const usage = this.database
      .prepare(
        'SELECT credits_used FROM watch_web_usage WHERE profile_id = ? AND month = ?',
      )
      .get(profileId, month) as { credits_used: number } | undefined;
    if ((usage?.credits_used ?? 0) >= 30) return;
    const result = await this.tavily.search(
      `${sanitizeSuggestionQuery(watch.question)} actualités récentes`,
      'basic',
      new AbortController().signal,
    );
    const now = new Date().toISOString();
    this.database.transaction(() => {
      for (const evidence of result.evidence.slice(0, 5)) {
        let origin: string;
        try {
          origin = new URL(evidence.url).origin;
        } catch {
          continue;
        }
        const feedId = this.upsertWebFeed(origin, evidence.title, now);
        this.database
          .prepare(
            'INSERT OR IGNORE INTO watch_sources(watch_id, feed_id) VALUES (?, ?)',
          )
          .run(watchId, feedId);
        const fingerprint = createHash('sha256')
          .update(`${evidence.title}\n${evidence.content.slice(0, 2_000)}`)
          .digest('hex');
        const articleId = randomUUID();
        const inserted = this.database
          .prepare(
            `INSERT OR IGNORE INTO watch_articles(
               id, feed_id, external_id, canonical_url, fingerprint, title,
               published_at, collected_at, excerpt
             ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            articleId,
            feedId,
            evidence.url,
            fingerprint,
            evidence.title.slice(0, 500),
            evidence.publishedAt,
            now,
            evidence.content.slice(0, 8_000),
          );
        if (inserted.changes > 0) {
          this.database
            .prepare(
              'INSERT INTO watch_articles_fts(article_id, title, excerpt) VALUES (?, ?, ?)',
            )
            .run(articleId, evidence.title, evidence.content.slice(0, 8_000));
          this.matchArticle(
            feedId,
            articleId,
            evidence.title,
            evidence.content,
          );
        }
      }
      this.database
        .prepare(
          `INSERT INTO watch_web_usage(profile_id, month, credits_used, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(profile_id, month) DO UPDATE SET
             credits_used = credits_used + excluded.credits_used,
             updated_at = excluded.updated_at`,
        )
        .run(profileId, month, result.creditsUsed, now);
      this.database
        .prepare(
          'UPDATE watches SET last_web_search_at = ?, updated_at = ? WHERE id = ?',
        )
        .run(now, now, watchId);
    })();
  }

  private async fetchFeedsForWatch(watchId: string): Promise<void> {
    const rows = this.database
      .prepare(
        `SELECT f.* FROM watch_feeds f JOIN watch_sources s ON s.feed_id = f.id
          WHERE s.watch_id = ? AND f.source_mode = 'rss'
            AND (f.last_fetched_at IS NULL OR f.next_fetch_at <= ?)`,
      )
      .all(watchId, new Date().toISOString()) as FeedRow[];
    for (const row of rows) await this.fetchFeed(row);
  }

  private async fetchFeed(row: FeedRow): Promise<void> {
    const controller = new AbortController();
    const now = new Date();
    try {
      const feed = await this.feedClient.fetchFeed(
        row.feed_url,
        controller.signal,
        {
          etag: row.etag,
          lastModified: row.last_modified,
        },
      );
      this.database.transaction(() => {
        for (const article of feed.articles) {
          const id = randomUUID();
          const inserted = this.database
            .prepare(
              `INSERT OR IGNORE INTO watch_articles(
                 id, feed_id, external_id, canonical_url, fingerprint, title,
                 published_at, collected_at, excerpt
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              row.id,
              article.externalId,
              article.canonicalUrl,
              article.fingerprint,
              article.title,
              article.publishedAt,
              now.toISOString(),
              article.excerpt,
            );
          if (inserted.changes > 0) {
            this.database
              .prepare(
                'INSERT INTO watch_articles_fts(article_id, title, excerpt) VALUES (?, ?, ?)',
              )
              .run(id, article.title, article.excerpt);
            this.matchArticle(row.id, id, article.title, article.excerpt);
          }
        }
        this.database
          .prepare(
            `UPDATE watch_feeds SET etag = ?, last_modified = ?, last_fetched_at = ?,
               next_fetch_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(
            feed.etag ?? row.etag,
            feed.lastModified ?? row.last_modified,
            now.toISOString(),
            new Date(now.valueOf() + FETCH_INTERVAL_MS).toISOString(),
            now.toISOString(),
            row.id,
          );
      })();
    } catch (error) {
      this.database
        .prepare(
          `UPDATE watch_feeds SET last_fetched_at = ?, next_fetch_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          now.toISOString(),
          new Date(now.valueOf() + 60 * 60_000).toISOString(),
          error instanceof Error ? error.message.slice(0, 500) : String(error),
          now.toISOString(),
          row.id,
        );
    }
  }

  private matchArticle(
    feedId: string,
    articleId: string,
    title: string,
    excerpt: string,
  ): void {
    const rows = this.database
      .prepare(
        `SELECT w.* FROM watches w JOIN watch_sources s ON s.watch_id = w.id
          WHERE s.feed_id = ?`,
      )
      .all(feedId) as WatchRow[];
    for (const row of rows) {
      const haystack = normalize(`${title} ${excerpt}`);
      const includes = JSON.parse(row.include_keywords_json) as string[];
      const excludes = JSON.parse(row.exclude_keywords_json) as string[];
      const rejected = excludes.some((keyword) =>
        haystack.includes(normalize(keyword)),
      );
      const matched =
        includes.length === 0 ||
        includes.some((keyword) => haystack.includes(normalize(keyword)));
      this.database
        .prepare(
          `INSERT OR IGNORE INTO watch_matches(
             watch_id, article_id, relevant, baseline, novelty, summary, relevance_reason
           ) VALUES (?, ?, ?, ?, NULL, NULL, ?)`,
        )
        .run(
          row.id,
          articleId,
          rejected ? 0 : matched ? 1 : 0,
          row.baseline_completed_at ? 0 : 1,
          rejected
            ? 'Mot-clé exclu'
            : matched
              ? 'Correspondance déterministe'
              : 'Hors mots-clés',
        );
    }
  }

  private async generateDigest(
    profileId: string,
    watchId: string,
    runId: string,
  ): Promise<void> {
    const watch = this.requireWatchRow(profileId, watchId);
    const allowedLanguages = JSON.parse(watch.languages_json) as string[];
    const themes = this.listTopics(profileId)
      .filter((topic) => topic.watchId === watchId)
      .map(({ summary, title }) => ({ summary, title }));
    const now = new Date();
    const creatingBaseline = !watch.baseline_completed_at;
    if (creatingBaseline) {
      this.database
        .prepare(
          'UPDATE watches SET baseline_completed_at = ?, next_digest_at = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          now.toISOString(),
          nextScheduledAt(this.toWatch(watch), now).toISOString(),
          now.toISOString(),
          watchId,
        );
    }
    const candidates = selectBalancedWatchCandidates(
      this.database
        .prepare(
          `SELECT a.id, a.title, a.canonical_url, a.excerpt,
                  f.id AS source_id, f.title AS source_title
           FROM watch_matches m
           JOIN watch_articles a ON a.id = m.article_id
           JOIN watch_feeds f ON f.id = a.feed_id
           JOIN watch_sources ws ON ws.watch_id = m.watch_id
             AND ws.feed_id = a.feed_id
          WHERE m.watch_id = ? AND m.relevant = 1
            AND m.analyzed_at IS NULL
          ORDER BY COALESCE(a.published_at, a.collected_at) DESC LIMIT 120`,
        )
        .all(watchId) as WatchAnalysisCandidate[],
      30,
    );
    this.database
      .prepare(
        `UPDATE watch_runs SET stage = 'extracting', progress_current = 0,
           progress_total = ?, updated_at = ? WHERE id = ?`,
      )
      .run(candidates.length, new Date().toISOString(), runId);
    let completed = 0;
    for (const candidate of candidates) {
      let text = candidate.excerpt;
      if (text.length < 400) {
        try {
          text = await this.feedClient.fetchArticleText(
            candidate.canonical_url,
            new AbortController().signal,
          );
        } catch {
          // The feed excerpt remains usable and source reading failure is non-fatal.
        }
      }
      const fallbackAnalysis: WatchAnalysis = {
        concepts: JSON.parse(watch.include_keywords_json) as string[],
        entities: [],
        facts: [text.slice(0, 500)],
        importance: 0,
        novelty: 'new',
        reason: 'Analyse IA indisponible · article non classé par précaution',
        relevant: false,
        summary: '',
        topicTitle: themes[0]?.title ?? candidate.title,
      };
      let analysis = fallbackAnalysis;
      const configuredLanguage = matchesConfiguredWatchLanguage(
        `${candidate.title}\n${text}`,
        allowedLanguages,
      );
      if (!configuredLanguage) {
        analysis = {
          ...fallbackAnalysis,
          reason: 'Langue ou écriture hors des langues configurées',
        };
      } else if (this.engine.analyzeWatchArticle) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            analysis = await this.engine.analyzeWatchArticle(
              {
                articleTitle: candidate.title,
                articleText: text,
                excludeKeywords: JSON.parse(
                  watch.exclude_keywords_json,
                ) as string[],
                includeKeywords: JSON.parse(
                  watch.include_keywords_json,
                ) as string[],
                question: watch.question,
                sourceTitle: candidate.source_title,
                themes,
              },
              new AbortController().signal,
            );
            break;
          } catch {
            if (attempt === 1) analysis = fallbackAnalysis;
          }
        }
      }
      this.database
        .prepare(
          `UPDATE watch_matches SET relevant = ?, novelty = ?, summary = ?,
             relevance_reason = ?, model_id = 'qwen3.5:9b-q4_K_M',
             prompt_version = 'watch-v1', analyzed_at = ?
           WHERE watch_id = ? AND article_id = ?`,
        )
        .run(
          analysis.relevant ? 1 : 0,
          analysis.novelty,
          analysis.summary,
          analysis.reason,
          new Date().toISOString(),
          watchId,
          candidate.id,
        );
      if (
        analysis.relevant &&
        !this.mergeArticleIntoTopic(
          profileId,
          watchId,
          candidate.id,
          candidate.title,
          analysis,
        )
      ) {
        this.database
          .prepare(
            `UPDATE watch_matches SET relevant = 0,
               relevance_reason = 'Aucun thème stable ne correspond à cet article'
             WHERE watch_id = ? AND article_id = ?`,
          )
          .run(watchId, candidate.id);
      }
      completed += 1;
      this.database
        .prepare(
          'UPDATE watch_runs SET progress_current = ?, updated_at = ? WHERE id = ?',
        )
        .run(completed, new Date().toISOString(), runId);
    }
    this.database
      .prepare(
        `UPDATE watch_runs SET stage = 'clustering', updated_at = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), runId);
    const selected = creatingBaseline
      ? []
      : (this.database
          .prepare(
            `SELECT a.id, a.title, m.summary FROM watch_matches m
           JOIN watch_articles a ON a.id = m.article_id
           JOIN watch_sources ws ON ws.watch_id = m.watch_id
             AND ws.feed_id = a.feed_id
          WHERE m.watch_id = ? AND m.baseline = 0 AND m.relevant = 1
            AND m.analyzed_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM watch_digest_articles da WHERE da.article_id = a.id)
          ORDER BY COALESCE(a.published_at, a.collected_at) DESC LIMIT 10`,
          )
          .all(watchId) as Array<{
          id: string;
          summary: string;
          title: string;
        }>);
    if (selected.length > 0) {
      this.database
        .prepare(
          `UPDATE watch_runs SET stage = 'synthesizing', updated_at = ? WHERE id = ?`,
        )
        .run(new Date().toISOString(), runId);
      const digestId = randomUUID();
      const articleSummary = selected
        .map((article) => `${article.title} — ${article.summary}`)
        .join('\n')
        .slice(0, 8_000);
      const topics = this.listTopics(profileId)
        .filter(
          (topic) =>
            topic.watchId === watchId &&
            topic.articleIds.some((articleId) =>
              selected.some((article) => article.id === articleId),
            ),
        )
        .slice(0, 10);
      let synthesis: WatchSynthesis | null = null;
      if (this.engine.synthesizeWatchTopics)
        try {
          synthesis = await this.engine.synthesizeWatchTopics(
            {
              question: watch.question,
              topics: topics.map((topic) => ({
                title: topic.title,
                summary: topic.summary,
                eventKind: topic.eventKind,
                articleTitles: selected
                  .filter((article) => topic.articleIds.includes(article.id))
                  .map((article) => article.title),
              })),
            },
            new AbortController().signal,
          );
        } catch {
          // The factual article summaries remain a safe digest fallback.
        }
      const summary = (synthesis?.summary ?? articleSummary).slice(0, 8_000);
      this.database.transaction(() => {
        this.database
          .prepare(
            `INSERT INTO watch_digests(id, watch_id, profile_id, title, summary, new_count, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            digestId,
            watchId,
            profileId,
            `${selected.length.toString()} nouveauté${selected.length > 1 ? 's' : ''} · ${watch.name}`,
            summary,
            selected.length,
            now.toISOString(),
          );
        selected.forEach((article, index) =>
          this.database
            .prepare(
              'INSERT INTO watch_digest_articles(digest_id, article_id, ordinal) VALUES (?, ?, ?)',
            )
            .run(digestId, article.id, index),
        );
      })();
    }
    this.database
      .prepare(
        'UPDATE watches SET next_digest_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        nextScheduledAt(this.toWatch(watch), now).toISOString(),
        now.toISOString(),
        watchId,
      );
  }

  private queueDueWatches(now: string, atStartup: boolean): void {
    const due = this.database
      .prepare(
        `SELECT id, profile_id FROM watches WHERE status = 'active' AND next_digest_at <= ?`,
      )
      .all(now) as Array<{ id: string; profile_id: string }>;
    for (const watch of due)
      this.queueRun(
        watch.id,
        watch.profile_id,
        atStartup ? 'catch_up' : 'scheduled',
        now,
      );
  }

  private mergeArticleIntoTopic(
    profileId: string,
    watchId: string,
    articleId: string,
    articleTitle: string,
    analysis: WatchAnalysis,
  ): boolean {
    const now = new Date();
    const muted = new Set(
      (
        this.database
          .prepare(
            `SELECT normalized_label FROM watch_concepts
              WHERE watch_id = ? AND profile_id = ? AND state = 'muted'`,
          )
          .all(watchId, profileId) as Array<{ normalized_label: string }>
      ).map((item) => item.normalized_label),
    );
    const conceptLabels = uniqueKeywords(analysis.concepts)
      .filter((label) => !muted.has(normalize(label)))
      .slice(0, 6);
    const proposedTitle = (analysis.topicTitle ?? articleTitle)
      .trim()
      .slice(0, 120);
    const allCandidates = this.listTopics(profileId).filter(
      (topic) => topic.watchId === watchId,
    );
    const exactTheme = allCandidates.find(
      (topic) => normalize(topic.title) === normalize(proposedTitle),
    );
    const ftsIds = this.searchTopicCandidateIds(
      watchId,
      `${proposedTitle} ${articleTitle} ${analysis.entities.join(' ')}`,
    );
    const candidates = (
      ftsIds.length > 0
        ? allCandidates.filter((topic) => ftsIds.includes(topic.id))
        : allCandidates
    ).slice(0, 30);
    let best: WatchTopic | null = exactTheme ?? null;
    let bestScore = exactTheme ? 1 : 0;
    for (const topic of candidates) {
      const score = Math.max(
        tokenSimilarity(proposedTitle, topic.title),
        tokenSimilarity(
          `${articleTitle} ${analysis.entities.join(' ')}`,
          `${topic.title} ${topic.summary}`,
        ),
      );
      if (score > bestScore) {
        best = topic;
        bestScore = score;
      }
    }
    const mergeThreshold = 0.32;
    if (allCandidates.length >= 5 && !exactTheme) return false;
    const canCreate = !best || bestScore < mergeThreshold;
    if (canCreate) {
      const sourceCount = (
        this.database
          .prepare(
            'SELECT COUNT(*) AS count FROM watch_sources WHERE watch_id = ?',
          )
          .get(watchId) as { count: number }
      ).count;
      const trackedConceptCount = (
        this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM watch_concepts
              WHERE watch_id = ? AND profile_id = ? AND state = 'tracked'`,
          )
          .get(watchId, profileId) as { count: number }
      ).count;
      const budget = watchTopicBudget(sourceCount, trackedConceptCount);
      if (allCandidates.length >= budget) return false;
    }
    const conceptIds = this.boundedConceptIds(
      watchId,
      profileId,
      conceptLabels,
      watchConceptBudget(
        watchTopicBudget(
          (
            this.database
              .prepare(
                'SELECT COUNT(*) AS count FROM watch_sources WHERE watch_id = ?',
              )
              .get(watchId) as { count: number }
          ).count,
          (
            this.database
              .prepare(
                `SELECT COUNT(*) AS count FROM watch_concepts
                  WHERE watch_id = ? AND profile_id = ? AND state = 'tracked'`,
              )
              .get(watchId, profileId) as { count: number }
          ).count,
        ),
      ),
      now,
    );
    const kind: WatchTopicEventKind =
      best && bestScore >= mergeThreshold
        ? analysis.novelty === 'evolution'
          ? 'major_update'
          : analysis.novelty === 'confirmation'
            ? 'confirmation'
            : bestScore >= 0.78
              ? 'duplicate'
              : 'additional_detail'
        : 'new_topic';
    this.database.transaction(() => {
      const topicId =
        best && bestScore >= mergeThreshold ? best.id : randomUUID();
      if (!best || bestScore < mergeThreshold) {
        this.database
          .prepare(
            `INSERT INTO watch_topics(
               id, watch_id, profile_id, normalized_title, title, summary,
               event_kind, importance, first_seen_at, last_seen_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            topicId,
            watchId,
            profileId,
            normalize(proposedTitle).slice(0, 300),
            proposedTitle,
            analysis.summary,
            kind,
            analysis.importance,
            now.toISOString(),
            now.toISOString(),
          );
        this.database
          .prepare(
            'INSERT INTO watch_topics_fts(topic_id, title, summary) VALUES (?, ?, ?)',
          )
          .run(topicId, proposedTitle, analysis.summary);
      } else {
        const nextSummary = exactTheme ? best.summary : analysis.summary;
        this.database
          .prepare(
            `UPDATE watch_topics SET summary = ?, event_kind = ?, importance = ?,
               last_seen_at = ? WHERE id = ?`,
          )
          .run(
            nextSummary,
            kind,
            Math.max(best.importance, analysis.importance),
            now.toISOString(),
            topicId,
          );
        this.database
          .prepare('DELETE FROM watch_topics_fts WHERE topic_id = ?')
          .run(topicId);
        this.database
          .prepare(
            'INSERT INTO watch_topics_fts(topic_id, title, summary) VALUES (?, ?, ?)',
          )
          .run(topicId, best.title, nextSummary);
      }
      this.database
        .prepare(
          `INSERT OR IGNORE INTO watch_topic_articles(
             topic_id, article_id, contribution, created_at
           ) VALUES (?, ?, ?, ?)`,
        )
        .run(topicId, articleId, kind, now.toISOString());
      this.database
        .prepare(
          `INSERT OR IGNORE INTO watch_topic_events(
             id, topic_id, article_id, kind, summary, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          topicId,
          articleId,
          kind,
          analysis.summary,
          now.toISOString(),
        );
      for (const conceptId of conceptIds) {
        this.database
          .prepare(
            'INSERT OR IGNORE INTO watch_topic_concepts(topic_id, concept_id) VALUES (?, ?)',
          )
          .run(topicId, conceptId);
      }
    })();
    return true;
  }

  private backfillExistingTopics(): void {
    const rows = this.database
      .prepare(
        `SELECT w.profile_id, w.id AS watch_id, w.include_keywords_json,
                a.id AS article_id, a.title, m.summary, m.novelty
           FROM watch_matches m
           JOIN watches w ON w.id = m.watch_id
           JOIN watch_articles a ON a.id = m.article_id
          WHERE m.relevant = 1 AND m.analyzed_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM watch_topic_articles ta WHERE ta.article_id = a.id
            )
          ORDER BY a.collected_at LIMIT 200`,
      )
      .all() as Array<{
      article_id: string;
      include_keywords_json: string;
      novelty: 'new' | 'evolution' | 'confirmation' | null;
      profile_id: string;
      summary: string | null;
      title: string;
      watch_id: string;
    }>;
    for (const row of rows)
      this.mergeArticleIntoTopic(
        row.profile_id,
        row.watch_id,
        row.article_id,
        row.title,
        {
          concepts: JSON.parse(row.include_keywords_json) as string[],
          entities: [],
          facts: row.summary ? [row.summary] : [],
          importance: 0.5,
          novelty: row.novelty ?? 'new',
          reason: 'Reprise de la mémoire de veille existante',
          relevant: true,
          summary: row.summary ?? row.title,
        },
      );
  }

  private backfillExistingConcepts(): void {
    const rows = this.database
      .prepare(
        'SELECT id, profile_id, include_keywords_json, created_at FROM watches',
      )
      .all() as Array<{
      created_at: string;
      id: string;
      include_keywords_json: string;
      profile_id: string;
    }>;
    for (const row of rows) {
      const seenAt = new Date(row.created_at);
      for (const label of JSON.parse(row.include_keywords_json) as string[])
        this.insertConcept(
          row.id,
          row.profile_id,
          label,
          'tracked',
          'user',
          seenAt,
        );
    }
  }

  private initializeLegacyMemory(now: string): void {
    const pending = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM watches
          WHERE memory_initialized_at IS NULL`,
      )
      .get() as { count: number };
    if (pending.count === 0) return;
    this.backfillExistingConcepts();
    this.backfillExistingTopics();
    // A hub restart must never create inference work. Pending legacy matches
    // remain available for the next manual or scheduled run.
    this.database
      .prepare(
        `UPDATE watches SET memory_initialized_at = ?
          WHERE memory_initialized_at IS NULL`,
      )
      .run(now);
  }

  private searchTopicCandidateIds(watchId: string, text: string): string[] {
    const terms = normalize(text)
      .split(/[^a-z0-9]+/u)
      .filter((term) => term.length >= 4)
      .slice(0, 8);
    if (terms.length === 0) return [];
    const query = terms
      .map((term) => `"${term.replaceAll('"', '')}"`)
      .join(' OR ');
    try {
      return (
        this.database
          .prepare(
            `SELECT t.id FROM watch_topics_fts f
              JOIN watch_topics t ON t.id = f.topic_id
             WHERE watch_topics_fts MATCH ? AND t.watch_id = ? LIMIT 12`,
          )
          .all(query, watchId) as Array<{ id: string }>
      ).map((row) => row.id);
    } catch {
      return [];
    }
  }

  private queueRun(
    watchId: string,
    profileId: string,
    trigger: WatchRunTrigger,
    now: string,
  ): void {
    const existing = this.database
      .prepare(
        `SELECT id FROM watch_runs WHERE watch_id = ? AND status IN ('queued', 'collecting', 'analyzing')`,
      )
      .get(watchId);
    if (existing) return;
    this.database
      .prepare(
        `INSERT INTO watch_runs(
           id, watch_id, profile_id, status, manual, trigger, created_at, updated_at
         ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        watchId,
        profileId,
        trigger === 'manual' ? 1 : 0,
        trigger,
        now,
        now,
      );
  }

  private persistDiscovery(
    profileId: string,
    input: WatchDiscoveryRequest,
    queries: Array<{ kind: string; query: string }>,
    discovery: WatchDiscovery,
  ): void {
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO watch_discovery_runs(
             id, profile_id, name, question, concepts_json, queries_json,
             examined_count, validated_count, credits_used, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          discovery.id,
          profileId,
          input.name,
          input.question,
          JSON.stringify(discovery.concepts),
          JSON.stringify(queries),
          discovery.examinedCount,
          discovery.validatedCount,
          discovery.creditsUsed,
          discovery.createdAt,
        );
      for (const candidate of discovery.candidates)
        this.database
          .prepare(
            `INSERT INTO watch_source_candidates(
               id, discovery_id, title, site_url, feed_url, source_kind,
               language, score, status, reason
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            candidate.id,
            discovery.id,
            candidate.title,
            candidate.siteUrl,
            candidate.feedUrl,
            candidate.kind,
            candidate.language,
            candidate.score,
            candidate.status,
            candidate.reason,
          );
    })();
  }

  private insertInitialTheme(
    watchId: string,
    profileId: string,
    theme: WatchThemeProposal,
    now: Date,
  ): string {
    const existing = this.database
      .prepare(
        `SELECT id FROM watch_topics
          WHERE watch_id = ? AND profile_id = ? AND normalized_title = ?`,
      )
      .get(watchId, profileId, normalize(theme.title).slice(0, 300)) as
      { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO watch_topics(
           id, watch_id, profile_id, normalized_title, title, summary,
           event_kind, importance, first_seen_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'new_topic', 0.5, ?, ?)`,
      )
      .run(
        id,
        watchId,
        profileId,
        normalize(theme.title).slice(0, 300),
        theme.title,
        theme.summary,
        now.toISOString(),
        now.toISOString(),
      );
    this.database
      .prepare(
        'INSERT INTO watch_topics_fts(topic_id, title, summary) VALUES (?, ?, ?)',
      )
      .run(id, theme.title, theme.summary);
    return id;
  }

  private insertConcept(
    watchId: string,
    profileId: string,
    label: string,
    state: WatchConceptState,
    origin: 'user' | 'assistant',
    now: Date,
  ): string {
    const normalized = normalize(label).trim().slice(0, 80);
    const existing = this.database
      .prepare(
        'SELECT id FROM watch_concepts WHERE watch_id = ? AND normalized_label = ?',
      )
      .get(watchId, normalized) as { id: string } | undefined;
    if (existing) {
      this.database
        .prepare('UPDATE watch_concepts SET last_seen_at = ? WHERE id = ?')
        .run(now.toISOString(), existing.id);
      return existing.id;
    }
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO watch_concepts(
           id, watch_id, profile_id, normalized_label, label, state, origin,
           first_seen_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        watchId,
        profileId,
        normalized,
        label.trim().slice(0, 80),
        state,
        origin,
        now.toISOString(),
        now.toISOString(),
      );
    return id;
  }

  private boundedConceptIds(
    watchId: string,
    profileId: string,
    labels: string[],
    assistantBudget: number,
    now: Date,
  ): string[] {
    let assistantCount = (
      this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM watch_concepts
            WHERE watch_id = ? AND profile_id = ? AND origin = 'assistant'`,
        )
        .get(watchId, profileId) as { count: number }
    ).count;
    const ids: string[] = [];
    for (const label of labels) {
      const normalized = normalize(label).trim().slice(0, 80);
      const existing = this.database
        .prepare(
          `SELECT id FROM watch_concepts
            WHERE watch_id = ? AND profile_id = ? AND normalized_label = ?`,
        )
        .get(watchId, profileId, normalized) as { id: string } | undefined;
      if (!existing && assistantCount >= assistantBudget) continue;
      ids.push(
        this.insertConcept(
          watchId,
          profileId,
          label,
          'secondary',
          'assistant',
          now,
        ),
      );
      if (!existing) assistantCount += 1;
    }
    return ids;
  }

  private listConcepts(profileId: string): WatchConcept[] {
    const rows = this.database
      .prepare(
        `SELECT c.*, COUNT(DISTINCT tc.topic_id) AS article_count
           FROM watch_concepts c
           LEFT JOIN watch_topic_concepts tc ON tc.concept_id = c.id
          WHERE c.profile_id = ?
          GROUP BY c.id ORDER BY c.state, c.last_seen_at DESC`,
      )
      .all(profileId) as Array<Record<string, unknown>>;
    return rows.map((row) =>
      WatchConceptSchema.parse({
        id: row.id,
        watchId: row.watch_id,
        label: row.label,
        state: row.state,
        origin: row.origin,
        articleCount: row.article_count,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
      }),
    );
  }

  private listTopics(profileId: string): WatchTopic[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM watch_topics WHERE profile_id = ?
          ORDER BY last_seen_at DESC LIMIT 300`,
      )
      .all(profileId) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const articleIds = (
        this.database
          .prepare(
            'SELECT article_id FROM watch_topic_articles WHERE topic_id = ? ORDER BY created_at',
          )
          .all(row.id) as Array<{ article_id: string }>
      ).map((item) => item.article_id);
      const conceptIds = (
        this.database
          .prepare(
            'SELECT concept_id FROM watch_topic_concepts WHERE topic_id = ?',
          )
          .all(row.id) as Array<{ concept_id: string }>
      ).map((item) => item.concept_id);
      return WatchTopicSchema.parse({
        id: row.id,
        watchId: row.watch_id,
        title: row.title,
        summary: row.summary,
        eventKind: row.event_kind,
        importance: row.importance,
        articleIds,
        conceptIds,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
      });
    });
  }

  private upsertFeed(source: ValidatedFeed, now: string): string {
    const existing = this.database
      .prepare('SELECT id FROM watch_feeds WHERE feed_url = ?')
      .get(source.feedUrl) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO watch_feeds(
           id, feed_url, site_url, title, next_fetch_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, source.feedUrl, source.siteUrl, source.title, now, now, now);
    return id;
  }

  private upsertWebFeed(siteUrl: string, title: string, now: string): string {
    const existing = this.database
      .prepare('SELECT id FROM watch_feeds WHERE feed_url = ?')
      .get(siteUrl) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO watch_feeds(
           id, feed_url, site_url, title, next_fetch_at, source_mode,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'web', ?, ?)`,
      )
      .run(
        id,
        siteUrl,
        siteUrl,
        title.slice(0, 160),
        new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString(),
        now,
        now,
      );
    return id;
  }

  private requireWatchRow(profileId: string, id: string): WatchRow {
    const row = this.database
      .prepare('SELECT * FROM watches WHERE id = ? AND profile_id = ?')
      .get(id, profileId) as WatchRow | undefined;
    if (!row) throw new WatchNotFoundError();
    return row;
  }

  private toWatch(row: WatchRow): Watch {
    const sources = this.database
      .prepare(
        `SELECT f.* FROM watch_feeds f JOIN watch_sources s ON s.feed_id = f.id
          WHERE s.watch_id = ? AND f.source_mode = 'rss' ORDER BY f.title`,
      )
      .all(row.id) as Array<
      FeedRow & { last_error: string | null; last_fetched_at: string | null }
    >;
    return WatchSchema.parse({
      id: row.id,
      name: row.name,
      question: row.question,
      includeKeywords: JSON.parse(row.include_keywords_json),
      excludeKeywords: JSON.parse(row.exclude_keywords_json),
      concepts: (
        this.database
          .prepare(
            `SELECT label FROM watch_concepts
              WHERE watch_id = ? AND state = 'tracked' ORDER BY label`,
          )
          .all(row.id) as Array<{ label: string }>
      ).map((item) => item.label),
      languages: JSON.parse(row.languages_json),
      cadence: row.cadence,
      localTime: row.local_time,
      weekday: row.weekday,
      timeZone: row.time_zone,
      status: row.status,
      sources: sources.map((source) => ({
        id: source.id,
        title: source.title,
        siteUrl: source.site_url,
        feedUrl: source.feed_url,
        lastFetchedAt: source.last_fetched_at,
        lastError: source.last_error,
      })),
      nextDigestAt: row.next_digest_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private listArticles(profileId: string): WatchArticle[] {
    const rows = this.database
      .prepare(
        `SELECT a.id, m.watch_id, a.feed_id, f.title AS source_title, a.title,
                a.canonical_url, a.published_at, a.collected_at, a.excerpt,
                m.summary, m.relevance_reason, m.novelty, m.relevant, m.baseline,
                COALESCE(s.state, 'unread') AS state
           FROM watch_matches m
           JOIN watches w ON w.id = m.watch_id
           JOIN watch_articles a ON a.id = m.article_id
           JOIN watch_feeds f ON f.id = a.feed_id
           LEFT JOIN watch_article_states s ON s.profile_id = w.profile_id
             AND s.watch_id = w.id AND s.article_id = a.id
          WHERE w.profile_id = ?
          ORDER BY COALESCE(a.published_at, a.collected_at) DESC LIMIT 500`,
      )
      .all(profileId) as Array<Record<string, unknown>>;
    return rows.map((row) =>
      WatchArticleSchema.parse({
        id: row.id,
        watchId: row.watch_id,
        sourceId: row.feed_id,
        sourceTitle: row.source_title,
        title: row.title,
        url: row.canonical_url,
        publishedAt: row.published_at,
        collectedAt: row.collected_at,
        excerpt: row.excerpt,
        summary: row.summary,
        relevanceReason: row.relevance_reason,
        novelty: row.novelty,
        relevant: row.relevant === 1,
        baseline: row.baseline === 1,
        state: row.state,
      }),
    );
  }

  private getArticle(
    profileId: string,
    watchId: string,
    articleId: string,
  ): WatchArticle {
    const article = this.listArticles(profileId).find(
      (item) => item.watchId === watchId && item.id === articleId,
    );
    if (!article) throw new WatchNotFoundError();
    return article;
  }

  private listDigests(profileId: string): WatchDigest[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM watch_digests WHERE profile_id = ? ORDER BY created_at DESC LIMIT 100`,
      )
      .all(profileId) as Array<{
      created_at: string;
      id: string;
      new_count: number;
      summary: string;
      title: string;
      watch_id: string;
    }>;
    return rows.map((row) => {
      const articleIds = (
        this.database
          .prepare(
            'SELECT article_id FROM watch_digest_articles WHERE digest_id = ? ORDER BY ordinal',
          )
          .all(row.id) as Array<{ article_id: string }>
      ).map((item) => item.article_id);
      return WatchDigestSchema.parse({
        id: row.id,
        watchId: row.watch_id,
        title: row.title,
        summary: row.summary,
        articleIds,
        newCount: row.new_count,
        createdAt: row.created_at,
      });
    });
  }

  private purgeOldArticles(): void {
    const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
    const ids = this.database
      .prepare(
        `SELECT id FROM watch_articles WHERE collected_at < ?
          AND NOT EXISTS (SELECT 1 FROM watch_article_states s
            WHERE s.article_id = watch_articles.id AND s.state = 'follow_up')`,
      )
      .all(cutoff) as Array<{ id: string }>;
    if (ids.length === 0) return;
    this.database.transaction(() => {
      for (const { id } of ids) {
        this.database
          .prepare('DELETE FROM watch_articles_fts WHERE article_id = ?')
          .run(id);
        this.database
          .prepare('DELETE FROM watch_articles WHERE id = ?')
          .run(id);
      }
    })();
  }
}

function uniqueKeywords(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, 30);
}

function sanitizeSuggestionQuery(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[email retiré]')
    .replace(/(?:\+33|0)[1-9](?:[ .-]?\d{2}){4}/gu, '[téléphone retiré]')
    .slice(0, 400);
}

function sourceReason(kind: WatchSourceKind): string {
  const labels: Record<WatchSourceKind, string> = {
    official: 'Source officielle directement liée au sujet.',
    research: 'Source de recherche ou publication scientifique.',
    specialized_press: 'Média journalistique spécialisé dans le domaine.',
    general_press:
      'Rubrique technologique ou scientifique d’un média généraliste.',
    community: 'Source communautaire complémentaire.',
  };
  return labels[kind];
}

function diversifyCandidates(
  candidates: DiscoveryCandidate[],
  maximum: number,
): DiscoveryCandidate[] {
  const selected: DiscoveryCandidate[] = [];
  const usedOrigins = new Set<string>();
  const byKind = new Map<WatchSourceKind, DiscoveryCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.status !== 'validated') continue;
    const list = byKind.get(candidate.kind) ?? [];
    list.push(candidate);
    byKind.set(candidate.kind, list);
  }
  for (const kind of [
    'official',
    'research',
    'specialized_press',
    'general_press',
    'community',
  ] as const) {
    for (const candidate of byKind.get(kind) ?? []) {
      const origin = new URL(candidate.siteUrl).origin;
      if (usedOrigins.has(origin)) continue;
      selected.push(candidate);
      usedOrigins.add(origin);
      break;
    }
  }
  for (const candidate of candidates.toSorted((a, b) => b.score - a.score)) {
    if (selected.length >= maximum) break;
    if (candidate.status !== 'validated') continue;
    const origin = new URL(candidate.siteUrl).origin;
    if (usedOrigins.has(origin)) continue;
    selected.push(candidate);
    usedOrigins.add(origin);
  }
  return selected;
}

function tokenSimilarity(left: string, right: string): number {
  const tokens = (value: string) =>
    new Set(
      normalize(value)
        .split(/[^a-z0-9]+/u)
        .filter((token) => token.length >= 3),
    );
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

export function watchTopicBudget(
  sourceCount: number,
  trackedConceptCount: number,
): number {
  const signalCount =
    Math.max(0, sourceCount) + Math.max(0, trackedConceptCount);
  return Math.min(8, Math.max(5, 4 + Math.ceil(Math.sqrt(signalCount) / 2)));
}

export function watchConceptBudget(topicBudget: number): number {
  return Math.min(32, Math.max(20, Math.round(topicBudget) * 4));
}

const LATIN_WATCH_LANGUAGES = new Set([
  'ca',
  'cs',
  'da',
  'de',
  'en',
  'es',
  'fi',
  'fr',
  'hu',
  'id',
  'it',
  'nl',
  'no',
  'pl',
  'pt',
  'ro',
  'sk',
  'sv',
  'tr',
  'vi',
]);

export function matchesConfiguredWatchLanguage(
  text: string,
  configuredLanguages: string[],
): boolean {
  if (
    configuredLanguages.some(
      (language) => !LATIN_WATCH_LANGUAGES.has(language.split('-')[0] ?? ''),
    )
  )
    return true;
  const letters = [...text].filter((character) =>
    /\p{Letter}/u.test(character),
  );
  if (letters.length < 12) return true;
  const nonLatin = letters.filter(
    (character) => !/\p{Script=Latin}/u.test(character),
  ).length;
  return nonLatin / letters.length <= 0.45;
}

function fallbackWatchThemes(
  input: Pick<WatchDiscoveryRequest, 'name' | 'question'>,
): WatchThemeProposal[] {
  const scope = input.question.trim().slice(0, 240);
  return [
    ['Actualités principales', 'Les changements directement liés à la veille.'],
    ['Applications et usages', 'Les applications concrètes et leurs usages.'],
    ['Outils et méthodes', 'Les outils, méthodes et pratiques utiles.'],
    [
      'Acteurs et initiatives',
      'Les organisations, projets et initiatives du domaine.',
    ],
    [
      'Risques et réglementation',
      'Les risques, limites, règles et enjeux de fiabilité.',
    ],
    [
      'Recherche et innovations',
      'Les travaux de recherche et innovations émergentes.',
    ],
  ].map(([title, summary]) => ({
    title: `${title} · ${input.name}`.slice(0, 120),
    summary: `${summary} Périmètre : ${scope}`.slice(0, 500),
  }));
}

function stableWatchThemes(
  themes: WatchThemeProposal[],
  input: Pick<WatchDiscoveryRequest, 'name' | 'question'>,
): WatchThemeProposal[] {
  const selected = new Map<string, WatchThemeProposal>();
  for (const theme of themes) {
    const title = theme.title.trim().slice(0, 120);
    const summary = theme.summary.trim().slice(0, 500);
    if (title.length < 3 || summary.length < 3) continue;
    selected.set(normalize(title), { title, summary });
    if (selected.size >= 8) break;
  }
  for (const fallback of fallbackWatchThemes(input)) {
    if (selected.size >= 5) break;
    selected.set(normalize(fallback.title), fallback);
  }
  return [...selected.values()].slice(0, 8);
}

export function selectBalancedWatchCandidates<
  Candidate extends { source_id: string },
>(candidates: Candidate[], maximum: number): Candidate[] {
  if (maximum <= 0) return [];
  const bySource = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const source = bySource.get(candidate.source_id) ?? [];
    source.push(candidate);
    bySource.set(candidate.source_id, source);
  }
  const selected: Candidate[] = [];
  let round = 0;
  while (selected.length < maximum) {
    let added = false;
    for (const source of bySource.values()) {
      const candidate = source[round];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length >= maximum) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr');
}

function assertTimeZone(timeZone: string): void {
  new Intl.DateTimeFormat('fr-FR', { timeZone }).format(new Date());
}

export function nextScheduledAt(
  input: Pick<
    WatchCreateRequest,
    'cadence' | 'localTime' | 'timeZone' | 'weekday'
  >,
  after: Date,
): Date {
  const [targetHour, targetMinute] = input.localTime.split(':').map(Number);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: input.timeZone,
    weekday: 'short',
  });
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const start = Math.floor(after.valueOf() / 60_000) * 60_000 + 60_000;
  for (let offset = 0; offset <= 8 * 24 * 60; offset += 1) {
    const candidate = new Date(start + offset * 60_000);
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
    );
    if (
      Number(parts.hour) === targetHour &&
      Number(parts.minute) === targetMinute &&
      (input.cadence === 'daily' ||
        weekdays[parts.weekday ?? ''] === input.weekday)
    )
      return candidate;
  }
  throw new Error('Impossible de calculer la prochaine échéance de veille.');
}
