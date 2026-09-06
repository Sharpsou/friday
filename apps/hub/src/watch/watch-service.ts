import { generateWatchDigest } from './watch-digest.js';
import {
  WatchArticleSchema,
  WatchConceptSchema,
  WatchDiscoverySchema,
  WatchOverviewSchema,
  WatchRunProgressSchema,
  type Watch,
  type WatchArticle,
  type WatchArticleStateValue,
  type WatchConcept,
  type WatchConceptState,
  type WatchCreateRequest,
  type WatchDiscovery,
  type WatchDiscoveryRequest,
  type WatchOverview,
  type WatchSourceKind,
} from '@friday/contracts';
import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { SecureFeedClient, type ValidatedFeed } from './feed-client.js';
import type { WatchLanguageEngine } from './ollama-watch-engine.js';
import { TavilySearchClient } from './tavily-search.js';
import { WatchNotFoundError } from './watch-errors.js';
import {
  diversifyCandidates,
  fallbackWatchThemes,
  FETCH_INTERVAL_MS,
  sanitizeSuggestionQuery,
  sourceReason,
  stableWatchThemes,
  uniqueKeywords,
} from './watch-policy.js';
import type {
  DiscoveryCandidate,
  FeedRow,
  WatchRow,
  WatchRunTrigger,
} from './watch-records.js';
import { WatchRepository } from './watch-repository.js';
import { assertTimeZone, nextScheduledAt } from './watch-schedule.js';
import { WatchTopicRepository } from './watch-topic-repository.js';

export class WatchService {
  private readonly topics: WatchTopicRepository;
  private readonly repository: WatchRepository;

  private processing: Promise<void> | null = null;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: Database.Database,
    private readonly engine: WatchLanguageEngine,
    private readonly feedClient = new SecureFeedClient(),
    private readonly tavily = new TavilySearchClient(undefined),
  ) {
    this.topics = new WatchTopicRepository(this.database);
    this.repository = new WatchRepository(this.database);

    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE watch_runs SET status = 'queued', stage = 'queued', trigger = 'resume',
                error_message = NULL, updated_at = ?
          WHERE status IN ('collecting', 'analyzing')`,
      )
      .run(now);
    this.topics.initializeLegacyMemory(now);
    this.repository.queueDueWatches(now, true);
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
      this.repository.persistDiscovery(
        profileId,
        input,
        plan.queries,
        discovery,
      );
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
        const feedId = this.repository.upsertFeed(source, now.toISOString());
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
        this.topics.insertConcept(id, profileId, label, 'tracked', 'user', now);
      for (const theme of themes)
        this.topics.insertInitialTheme(id, profileId, theme, now);
      this.repository.queueRun(
        id,
        profileId,
        'initialization',
        now.toISOString(),
      );
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
          const feedId = this.repository.upsertFeed(source, now.toISOString());
          this.database
            .prepare(
              'INSERT INTO watch_sources(watch_id, feed_id) VALUES (?, ?)',
            )
            .run(id, feedId);
        }
      }
      if (input.concepts)
        for (const label of uniqueKeywords(input.concepts))
          this.topics.insertConcept(
            id,
            profileId,
            label,
            'tracked',
            'user',
            now,
          );
    })();
    return this.get(profileId, id);
  }

  addDiscoveredSources(
    profileId: string,
    watchId: string,
    discoveryId: string,
    candidateIds: string[],
  ): { addedCount: number; watch: Watch } {
    this.repository.requireWatchRow(profileId, watchId);
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
        const feedId = this.repository.upsertFeed(
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
    this.repository.queueRun(id, profileId, 'manual', new Date().toISOString());
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
        const row = this.repository.requireWatchRow(profileId, watchId);
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
    const article = this.repository.getArticle(profileId, watchId, articleId);
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
    ).map((row) => this.repository.toWatch(row));
    const articles = this.repository.listArticles(profileId);
    const digests = this.repository.listDigests(profileId);
    const concepts = this.topics.listConcepts(profileId);
    const topics = this.topics.listTopics(profileId);
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
    return this.repository.toWatch(
      this.repository.requireWatchRow(profileId, id),
    );
  }

  setConceptState(
    profileId: string,
    watchId: string,
    conceptId: string,
    operationId: string,
    state: WatchConceptState,
  ): WatchConcept {
    this.repository.requireWatchRow(profileId, watchId);
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
    const concept = this.topics
      .listConcepts(profileId)
      .find((item) => item.id === conceptId && item.watchId === watchId);
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
    this.repository.queueDueWatches(new Date().toISOString(), false);
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
      this.repository.purgeOldArticles();
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
      await generateWatchDigest(
        {
          repository: this.repository,
          topics: this.topics,
          database: this.database,
          feedClient: this.feedClient,
          engine: this.engine,
        },
        run.profile_id,
        run.watch_id,
        run.id,
      );
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
            nextScheduledAt(
              this.repository.toWatch(watch),
              failedAt,
            ).toISOString(),
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
    const watch = this.repository.requireWatchRow(profileId, watchId);
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
        const feedId = this.repository.upsertWebFeed(
          origin,
          evidence.title,
          now,
        );
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
          this.repository.matchArticle(
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
            this.repository.matchArticle(
              row.id,
              id,
              article.title,
              article.excerpt,
            );
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
}

export { WatchNotFoundError } from './watch-errors.js';
export {
  matchesConfiguredWatchLanguage,
  selectBalancedWatchCandidates,
  watchConceptBudget,
  watchTopicBudget,
} from './watch-policy.js';
export { nextScheduledAt } from './watch-schedule.js';
