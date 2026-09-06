import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SecureFeedClient } from './feed-client.js';
import type {
  WatchAnalysis,
  WatchLanguageEngine,
  WatchSynthesis,
} from './ollama-watch-engine.js';
import {
  matchesConfiguredWatchLanguage,
  selectBalancedWatchCandidates,
} from './watch-policy.js';
import type { WatchAnalysisCandidate } from './watch-records.js';
import { WatchRepository } from './watch-repository.js';
import { nextScheduledAt } from './watch-schedule.js';
import { WatchTopicRepository } from './watch-topic-repository.js';
interface WatchDigestServices {
  repository: WatchRepository;
  topics: WatchTopicRepository;
  database: Database.Database;
  feedClient: SecureFeedClient;
  engine: WatchLanguageEngine;
}
export async function generateWatchDigest(
  services: WatchDigestServices,
  profileId: string,
  watchId: string,
  runId: string,
): Promise<void> {
  const watch = services.repository.requireWatchRow(profileId, watchId);
  const allowedLanguages = JSON.parse(watch.languages_json) as string[];
  const themes = services.topics
    .listTopics(profileId)
    .filter((topic) => topic.watchId === watchId)
    .map(({ summary, title }) => ({ summary, title }));
  const now = new Date();
  const creatingBaseline = !watch.baseline_completed_at;
  if (creatingBaseline) {
    services.database
      .prepare(
        'UPDATE watches SET baseline_completed_at = ?, next_digest_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        now.toISOString(),
        nextScheduledAt(services.repository.toWatch(watch), now).toISOString(),
        now.toISOString(),
        watchId,
      );
  }
  const candidates = selectBalancedWatchCandidates(
    services.database
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
  services.database
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
        text = await services.feedClient.fetchArticleText(
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
    } else if (services.engine.analyzeWatchArticle) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          analysis = await services.engine.analyzeWatchArticle(
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
    services.database
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
      !services.topics.mergeArticleIntoTopic(
        profileId,
        watchId,
        candidate.id,
        candidate.title,
        analysis,
      )
    ) {
      services.database
        .prepare(
          `UPDATE watch_matches SET relevant = 0,
               relevance_reason = 'Aucun thème stable ne correspond à cet article'
             WHERE watch_id = ? AND article_id = ?`,
        )
        .run(watchId, candidate.id);
    }
    completed += 1;
    services.database
      .prepare(
        'UPDATE watch_runs SET progress_current = ?, updated_at = ? WHERE id = ?',
      )
      .run(completed, new Date().toISOString(), runId);
  }
  services.database
    .prepare(
      `UPDATE watch_runs SET stage = 'clustering', updated_at = ? WHERE id = ?`,
    )
    .run(new Date().toISOString(), runId);
  const selected = creatingBaseline
    ? []
    : (services.database
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
    services.database
      .prepare(
        `UPDATE watch_runs SET stage = 'synthesizing', updated_at = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), runId);
    const digestId = randomUUID();
    const articleSummary = selected
      .map((article) => `${article.title} — ${article.summary}`)
      .join('\n')
      .slice(0, 8_000);
    const topics = services.topics
      .listTopics(profileId)
      .filter(
        (topic) =>
          topic.watchId === watchId &&
          topic.articleIds.some((articleId) =>
            selected.some((article) => article.id === articleId),
          ),
      )
      .slice(0, 10);
    let synthesis: WatchSynthesis | null = null;
    if (services.engine.synthesizeWatchTopics)
      try {
        synthesis = await services.engine.synthesizeWatchTopics(
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
    services.database.transaction(() => {
      services.database
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
        services.database
          .prepare(
            'INSERT INTO watch_digest_articles(digest_id, article_id, ordinal) VALUES (?, ?, ?)',
          )
          .run(digestId, article.id, index),
      );
    })();
  }
  services.database
    .prepare(
      'UPDATE watches SET next_digest_at = ?, updated_at = ? WHERE id = ?',
    )
    .run(
      nextScheduledAt(services.repository.toWatch(watch), now).toISOString(),
      now.toISOString(),
      watchId,
    );
}
