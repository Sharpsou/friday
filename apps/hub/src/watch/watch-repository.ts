import {
  WatchArticleSchema,
  WatchDigestSchema,
  WatchSchema,
  type Watch,
  type WatchArticle,
  type WatchDigest,
  type WatchDiscovery,
  type WatchDiscoveryRequest,
} from '@friday/contracts';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { type ValidatedFeed } from './feed-client.js';
import { WatchNotFoundError } from './watch-errors.js';
import { normalize, RETENTION_MS } from './watch-policy.js';
import type { FeedRow, WatchRow, WatchRunTrigger } from './watch-records.js';
export class WatchRepository {
  constructor(private readonly database: Database.Database) {}
  matchArticle(
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
  queueDueWatches(now: string, atStartup: boolean): void {
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
  queueRun(
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
  persistDiscovery(
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
  upsertFeed(source: ValidatedFeed, now: string): string {
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
  upsertWebFeed(siteUrl: string, title: string, now: string): string {
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
  requireWatchRow(profileId: string, id: string): WatchRow {
    const row = this.database
      .prepare('SELECT * FROM watches WHERE id = ? AND profile_id = ?')
      .get(id, profileId) as WatchRow | undefined;
    if (!row) throw new WatchNotFoundError();
    return row;
  }
  toWatch(row: WatchRow): Watch {
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
  listArticles(profileId: string): WatchArticle[] {
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
  getArticle(
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
  listDigests(profileId: string): WatchDigest[] {
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
  purgeOldArticles(): void {
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
