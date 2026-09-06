import {
  WatchConceptSchema,
  WatchTopicSchema,
  type WatchConcept,
  type WatchConceptState,
  type WatchThemeProposal,
  type WatchTopic,
  type WatchTopicEventKind,
} from '@friday/contracts';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { WatchAnalysis } from './ollama-watch-engine.js';
import {
  normalize,
  tokenSimilarity,
  uniqueKeywords,
  watchConceptBudget,
  watchTopicBudget,
} from './watch-policy.js';
export class WatchTopicRepository {
  constructor(private readonly database: Database.Database) {}
  mergeArticleIntoTopic(
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
  backfillExistingTopics(): void {
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
  backfillExistingConcepts(): void {
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
  initializeLegacyMemory(now: string): void {
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
  searchTopicCandidateIds(watchId: string, text: string): string[] {
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
  insertInitialTheme(
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
  insertConcept(
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
  boundedConceptIds(
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
  listConcepts(profileId: string): WatchConcept[] {
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
  listTopics(profileId: string): WatchTopic[] {
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
}
