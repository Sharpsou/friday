import { describe, expect, it } from 'vitest';

import type { WatchLanguageEngine } from './ollama-watch-engine.js';
import { TavilySearchClient } from './tavily-search.js';
import { openDatabase } from '../db/database.js';
import type { SecureFeedClient } from './feed-client.js';

import {
  nextScheduledAt,
  matchesConfiguredWatchLanguage,
  selectBalancedWatchCandidates,
  watchConceptBudget,
  WatchNotFoundError,
  WatchService,
  watchTopicBudget,
} from './watch-service.js';

describe('watch scheduling', () => {
  it('bounds topics dynamically and balances a noisy source', () => {
    expect(watchTopicBudget(1, 2)).toBe(5);
    expect(watchTopicBudget(6, 15)).toBe(7);
    expect(watchTopicBudget(100, 100)).toBe(8);
    expect(watchConceptBudget(5)).toBe(20);
    expect(watchConceptBudget(8)).toBe(32);

    const candidates = [
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `noisy-${index.toString()}`,
        source_id: 'noisy',
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        id: `press-${index.toString()}`,
        source_id: 'press',
      })),
      { id: 'official-0', source_id: 'official' },
    ];
    expect(
      selectBalancedWatchCandidates(candidates, 6).map(({ id }) => id),
    ).toEqual([
      'noisy-0',
      'press-0',
      'official-0',
      'noisy-1',
      'press-1',
      'noisy-2',
    ]);
  });

  it('rejects text dominated by a script outside the configured languages', () => {
    expect(
      matchesConfiguredWatchLanguage(
        '人工知能の最新ニュースと新しいモデルの詳細情報',
        ['fr', 'en'],
      ),
    ).toBe(false);
    expect(
      matchesConfiguredWatchLanguage('Nouveau modèle local — 人工知能', [
        'fr',
        'en',
      ]),
    ).toBe(true);
    expect(
      matchesConfiguredWatchLanguage(
        '人工知能の最新ニュースと新しいモデルの詳細情報',
        ['ja', 'fr'],
      ),
    ).toBe(true);
  });

  it('schedules a daily digest in the selected local timezone', () => {
    const next = nextScheduledAt(
      {
        cadence: 'daily',
        localTime: '07:30',
        timeZone: 'Europe/Paris',
        weekday: null,
      },
      new Date('2026-08-12T06:00:00.000Z'),
    );
    expect(next.toISOString()).toBe('2026-08-13T05:30:00.000Z');
  });

  it('schedules the selected weekday and survives the autumn DST change', () => {
    const next = nextScheduledAt(
      {
        cadence: 'weekly',
        localTime: '07:30',
        timeZone: 'Europe/Paris',
        weekday: 1,
      },
      new Date('2026-10-25T08:00:00.000Z'),
    );
    expect(next.toISOString()).toBe('2026-10-26T06:30:00.000Z');
  });

  it('does not collect or analyze solely because the hub restarted', async () => {
    const database = openDatabase(':memory:');
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO watches(
           id, profile_id, name, question, include_keywords_json,
           exclude_keywords_json, languages_json, cadence, local_time, weekday,
           time_zone, status, baseline_completed_at, memory_initialized_at,
           next_digest_at, created_at, updated_at
         ) VALUES (?, 'profile-a', 'IA', 'Nouveautes IA', '["IA"]', '[]',
           '["fr"]', 'daily', '07:30', NULL, 'Europe/Paris', 'active', ?, NULL,
           '2099-01-01T06:30:00.000Z', ?, ?)`,
      )
      .run('71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb', now, now, now);
    database
      .prepare(
        `INSERT INTO watch_feeds(
           id, feed_url, site_url, title, next_fetch_at, created_at, updated_at
         ) VALUES (?, 'https://example.com/feed', 'https://example.com',
           'Source', '2000-01-01T00:00:00.000Z', ?, ?)`,
      )
      .run('72bc3ea7-e269-46b3-9ac7-1c8cb7b310bb', now, now);
    database
      .prepare(
        `INSERT INTO watch_articles(
           id, feed_id, external_id, canonical_url, fingerprint, title,
           published_at, collected_at, excerpt
         ) VALUES (?, ?, NULL, 'https://example.com/article', 'fingerprint',
           'Article en attente', ?, ?, 'Extrait')`,
      )
      .run(
        '70bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        '72bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO watch_matches(
           watch_id, article_id, relevant, baseline, analyzed_at
         ) VALUES (?, ?, 1, 1, NULL)`,
      )
      .run(
        '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        '70bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      );
    database
      .prepare('INSERT INTO watch_sources(watch_id, feed_id) VALUES (?, ?)')
      .run(
        '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        '72bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      );
    let fetchCount = 0;
    const feedClient = {
      fetchFeed: async () => {
        fetchCount += 1;
        return {
          articles: [],
          etag: null,
          lastModified: null,
          notModified: false,
          siteUrl: 'https://example.com',
          title: 'Source',
        };
      },
    } as unknown as SecureFeedClient;
    const engine: WatchLanguageEngine = {};
    const first = new WatchService(database, engine, feedClient);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await first.stop();
    const second = new WatchService(database, engine, feedClient);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await second.stop();

    expect(fetchCount).toBe(0);
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM watch_runs').get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  it('returns the latest completed run instead of a previous failure', async () => {
    const database = openDatabase(':memory:');
    const now = new Date().toISOString();
    const watchId = '77bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
    database
      .prepare(
        `INSERT INTO watches(
           id, profile_id, name, question, include_keywords_json,
           exclude_keywords_json, languages_json, cadence, local_time, weekday,
           time_zone, status, baseline_completed_at, memory_initialized_at,
           next_digest_at, created_at, updated_at
         ) VALUES (?, 'profile-a', 'IA', 'Nouveautes IA', '["IA"]', '[]',
           '["fr"]', 'daily', '07:30', NULL, 'Europe/Paris', 'active', ?, ?,
           '2099-01-01T06:30:00.000Z', ?, ?)`,
      )
      .run(watchId, now, now, now, now);
    database
      .prepare(
        `INSERT INTO watch_runs(
           id, watch_id, profile_id, status, manual, trigger, stage,
           progress_current, progress_total, error_message, created_at, updated_at
         ) VALUES
           ('78bc3ea7-e269-46b3-9ac7-1c8cb7b310bb', ?, 'profile-a', 'failed', 1,
            'manual', 'failed', 7, 30, 'Ancienne erreur',
            '2026-08-12T10:00:00.000Z', '2026-08-12T10:01:00.000Z'),
           ('79bc3ea7-e269-46b3-9ac7-1c8cb7b310bb', ?, 'profile-a', 'completed', 1,
            'manual', 'completed', 30, 30, NULL,
            '2026-08-12T11:00:00.000Z', '2026-08-12T11:05:00.000Z')`,
      )
      .run(watchId, watchId);
    const engine: WatchLanguageEngine = {};
    const service = new WatchService(database, engine);
    try {
      expect(service.overview('profile-a').runs).toEqual([
        expect.objectContaining({
          id: '79bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
          stage: 'completed',
          current: 30,
          total: 30,
          error: null,
        }),
      ]);
    } finally {
      await service.stop();
      database.close();
    }
  });

  it('catches up one missed schedule once and preserves the configured hour', async () => {
    const database = openDatabase(':memory:');
    const now = new Date().toISOString();
    const watchId = '73bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
    database
      .prepare(
        `INSERT INTO watches(
           id, profile_id, name, question, include_keywords_json,
           exclude_keywords_json, languages_json, cadence, local_time, weekday,
           time_zone, status, baseline_completed_at, memory_initialized_at,
           next_digest_at, created_at, updated_at
         ) VALUES (?, 'profile-a', 'IA', 'Nouveautes IA', '["IA"]', '[]',
           '["fr"]', 'daily', '07:30', NULL, 'Europe/Paris', 'active', ?, ?,
           '2020-01-01T06:30:00.000Z', ?, ?)`,
      )
      .run(watchId, now, now, now, now);
    database
      .prepare(
        `INSERT INTO watch_feeds(
           id, feed_url, site_url, title, next_fetch_at, created_at, updated_at
         ) VALUES (?, 'https://example.com/feed', 'https://example.com',
           'Source', '2000-01-01T00:00:00.000Z', ?, ?)`,
      )
      .run('74bc3ea7-e269-46b3-9ac7-1c8cb7b310bb', now, now);
    database
      .prepare('INSERT INTO watch_sources(watch_id, feed_id) VALUES (?, ?)')
      .run(watchId, '74bc3ea7-e269-46b3-9ac7-1c8cb7b310bb');
    let fetchCount = 0;
    const feedClient = {
      fetchFeed: async () => {
        fetchCount += 1;
        return {
          articles: [],
          etag: null,
          lastModified: null,
          notModified: false,
          siteUrl: 'https://example.com',
          title: 'Source',
        };
      },
    } as unknown as SecureFeedClient;
    const engine: WatchLanguageEngine = {};
    const first = new WatchService(database, engine, feedClient);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = database
        .prepare(
          'SELECT status FROM watch_runs ORDER BY created_at DESC LIMIT 1',
        )
        .get() as { status: string } | undefined;
      if (run?.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await first.stop();
    const completed = database
      .prepare('SELECT status, trigger FROM watch_runs')
      .get() as { status: string; trigger: string };
    const scheduled = database
      .prepare('SELECT next_digest_at FROM watches WHERE id = ?')
      .get(watchId) as { next_digest_at: string };
    const localParts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      timeZone: 'Europe/Paris',
    }).format(new Date(scheduled.next_digest_at));

    const second = new WatchService(database, engine, feedClient);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await second.stop();

    expect(completed).toEqual({ status: 'completed', trigger: 'catch_up' });
    expect(localParts).toBe('07:30');
    expect(fetchCount).toBe(1);
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM watch_runs').get(),
    ).toEqual({ count: 1 });
    database.close();
  });

  it('resumes one interrupted run without creating another run', async () => {
    const database = openDatabase(':memory:');
    const now = new Date().toISOString();
    const watchId = '75bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
    database
      .prepare(
        `INSERT INTO watches(
           id, profile_id, name, question, include_keywords_json,
           exclude_keywords_json, languages_json, cadence, local_time, weekday,
           time_zone, status, baseline_completed_at, memory_initialized_at,
           next_digest_at, created_at, updated_at
         ) VALUES (?, 'profile-a', 'IA', 'Nouveautes IA', '["IA"]', '[]',
           '["fr"]', 'daily', '07:30', NULL, 'Europe/Paris', 'active', ?, ?,
           '2099-01-01T06:30:00.000Z', ?, ?)`,
      )
      .run(watchId, now, now, now, now);
    database
      .prepare(
        `INSERT INTO watch_runs(
           id, watch_id, profile_id, status, manual, trigger, stage,
           progress_current, progress_total, created_at, updated_at
         ) VALUES (?, ?, 'profile-a', 'analyzing', 1, 'manual', 'extracting',
           0, 0, ?, ?)`,
      )
      .run('76bc3ea7-e269-46b3-9ac7-1c8cb7b310bb', watchId, now, now);
    const engine: WatchLanguageEngine = {};
    const service = new WatchService(database, engine);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = database
        .prepare('SELECT status FROM watch_runs LIMIT 1')
        .get() as { status: string };
      if (run.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await service.stop();

    expect(
      database.prepare('SELECT status, trigger FROM watch_runs').get(),
    ).toEqual({ status: 'completed', trigger: 'resume' });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM watch_runs').get(),
    ).toEqual({ count: 1 });
    database.close();
  });
});

describe('watch profile boundaries and state idempotence', () => {
  it('keeps watches private and applies an article state operation once', async () => {
    const database = openDatabase(':memory:');
    const feedClient = {
      validate: async () => ({
        title: 'Source vérifiée',
        siteUrl: 'https://example.com/',
        feedUrl: 'https://example.com/feed.xml',
      }),
      fetchFeed: async () => ({
        articles: [],
        etag: '"v1"',
        lastModified: null,
        notModified: false,
        siteUrl: 'https://example.com/',
        title: 'Source vérifiée',
      }),
      fetchArticleText: async () => '',
    } as unknown as SecureFeedClient;
    const engine: WatchLanguageEngine = {};
    const service = new WatchService(database, engine, feedClient);
    try {
      const watch = await service.create(
        'profile-a',
        {
          name: 'IA locale',
          question: 'Quelles nouveautés ?',
          includeKeywords: ['IA'],
          excludeKeywords: [],
          concepts: ['IA'],
          languages: ['fr', 'en'],
          cadence: 'daily',
          localTime: '07:30',
          weekday: null,
          timeZone: 'Europe/Paris',
          sources: [
            {
              title: 'Source',
              siteUrl: 'https://example.com/',
              feedUrl: 'https://example.com/feed.xml',
            },
          ],
        },
        new AbortController().signal,
      );
      expect(service.overview('profile-a').watches).toHaveLength(1);
      expect(service.overview('profile-a').topics).toHaveLength(5);
      expect(service.overview('profile-b').watches).toHaveLength(0);

      const rescheduled = await service.update(
        'profile-a',
        watch.id,
        { cadence: 'weekly', localTime: '08:15', weekday: 3 },
        new AbortController().signal,
      );
      expect(rescheduled).toMatchObject({
        cadence: 'weekly',
        localTime: '08:15',
        weekday: 3,
      });
      expect(
        new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          hourCycle: 'h23',
          minute: '2-digit',
          timeZone: 'Europe/Paris',
          weekday: 'short',
        }).format(new Date(rescheduled.nextDigestAt)),
      ).toBe('Wed 08:15');

      const feed = database
        .prepare('SELECT id FROM watch_feeds LIMIT 1')
        .get() as { id: string };
      const articleId = '41bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
      database
        .prepare(
          `INSERT INTO watch_articles(
             id, feed_id, canonical_url, fingerprint, title, collected_at, excerpt
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          articleId,
          feed.id,
          'https://example.com/article',
          'fingerprint',
          'Nouveauté IA',
          '2026-08-12T10:00:00.000Z',
          'Résumé',
        );
      database
        .prepare(
          `INSERT INTO watch_matches(
             watch_id, article_id, relevant, baseline, novelty, summary, relevance_reason
           ) VALUES (?, ?, 1, 0, 'new', 'Résumé', 'Pertinent')`,
        )
        .run(watch.id, articleId);

      const operationId = '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
      const first = service.setArticleState(
        'profile-a',
        watch.id,
        articleId,
        operationId,
        'follow_up',
        null,
      );
      const replay = service.setArticleState(
        'profile-a',
        watch.id,
        articleId,
        operationId,
        'read',
        null,
      );
      expect(first.state).toBe('follow_up');
      expect(replay.state).toBe('follow_up');
      expect(service.overview('profile-b').articles).toHaveLength(0);
    } finally {
      await service.stop();
      database.close();
    }
  });
});

describe('watch topic memory', () => {
  it('does not invent a topic when analysis fails or use a detached source', async () => {
    const database = openDatabase(':memory:');
    const now = '2026-08-12T10:00:00.000Z';
    database
      .prepare(
        `INSERT INTO watches(
           id, profile_id, name, question, include_keywords_json,
           exclude_keywords_json, languages_json, cadence, local_time, weekday,
           time_zone, status, baseline_completed_at, next_digest_at, created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, '[]', '["fr","en"]', 'daily', '07:30',
           NULL, 'Europe/Paris', 'active', ?, ?, ?, ?)`,
      )
      .run(
        '81bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        'profile-a',
        'IA',
        'Nouveautés IA',
        '["LLM","Python"]',
        now,
        '2026-08-13T05:30:00.000Z',
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO watch_feeds(
           id, feed_url, site_url, title, next_fetch_at, created_at, updated_at
         ) VALUES ('91bc3ea7-e269-46b3-9ac7-1c8cb7b310bb', 'https://example.com/feed', 'https://example.com',
           'Source', '2099-01-01T00:00:00.000Z', ?, ?)`,
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO watch_sources(watch_id, feed_id) VALUES (
          '81bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
          '91bc3ea7-e269-46b3-9ac7-1c8cb7b310bb'
        )`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO watch_articles(
           id, feed_id, canonical_url, fingerprint, title, collected_at, excerpt
         ) VALUES ('a1bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
           '91bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
           'https://example.com/a', 'fp-a',
           'Nouveau modèle compact', ?, 'Un modèle compact est publié.')`,
      )
      .run(now);
    database
      .prepare(
        `INSERT INTO watch_feeds(
           id, feed_url, site_url, title, next_fetch_at, created_at, updated_at
         ) VALUES ('92bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
           'https://detached.example/feed', 'https://detached.example',
           'Source retirée', '2099-01-01T00:00:00.000Z', ?, ?)`,
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO watch_articles(
           id, feed_id, canonical_url, fingerprint, title, collected_at, excerpt
         ) VALUES ('a2bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
           '92bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
           'https://detached.example/a', 'fp-detached',
           'Package hors source', ?, 'Ce paquet ne doit plus être analysé.')`,
      )
      .run(now);
    database
      .prepare(
        `INSERT INTO watch_matches(
           watch_id, article_id, relevant, baseline, novelty, summary,
           relevance_reason, model_id, prompt_version, analyzed_at
         ) VALUES ('81bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
           'a1bc3ea7-e269-46b3-9ac7-1c8cb7b310bb', 1, 1, NULL,
           NULL, 'Pertinent', NULL, NULL, NULL)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO watch_matches(
           watch_id, article_id, relevant, baseline, novelty, summary,
           relevance_reason, model_id, prompt_version, analyzed_at
         ) VALUES ('81bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
           'a2bc3ea7-e269-46b3-9ac7-1c8cb7b310bb', 1, 1, NULL,
           NULL, 'Ancienne correspondance', NULL, NULL, NULL)`,
      )
      .run();
    let analysisAttempts = 0;
    const engine: WatchLanguageEngine = {
      analyzeWatchArticle: async () => {
        analysisAttempts += 1;
        throw new Error('Réponse JSON invalide');
      },
    };
    const feedClient = {
      fetchArticleText: async () => 'FridayLM publie un modèle compact.',
    } as unknown as SecureFeedClient;
    const service = new WatchService(database, engine, feedClient);
    try {
      service.runNow('profile-a', '81bc3ea7-e269-46b3-9ac7-1c8cb7b310bb');
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const run = database
          .prepare(
            `SELECT status FROM watch_runs ORDER BY created_at DESC LIMIT 1`,
          )
          .get() as { status: string } | undefined;
        if (run?.status === 'completed') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const overview = service.overview('profile-a');
      expect(overview.concepts.map((concept) => concept.label)).toEqual(
        expect.arrayContaining(['LLM', 'Python']),
      );
      expect(overview.topics).toHaveLength(0);
      expect(analysisAttempts).toBe(2);
      expect(
        database
          .prepare(
            `SELECT analyzed_at FROM watch_matches
              WHERE article_id = 'a2bc3ea7-e269-46b3-9ac7-1c8cb7b310bb'`,
          )
          .get(),
      ).toEqual({ analyzed_at: null });
      expect(overview.digests).toHaveLength(0);
      expect(service.overview('profile-b').topics).toHaveLength(0);
    } finally {
      await service.stop();
      database.close();
    }
  });
});

describe('watch source discovery', () => {
  it('searches complementary source classes and persists validation failures', async () => {
    const database = openDatabase(':memory:');
    const feedClient = {
      validate: async (url: string) => {
        if (url.includes('journal.example'))
          throw new Error('Aucun flux RSS ou Atom vérifiable.');
        return {
          title: 'Laboratoire officiel',
          siteUrl: 'https://official.example/',
          feedUrl: 'https://official.example/feed.xml',
        };
      },
    } as unknown as SecureFeedClient;
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'Laboratoire officiel',
              url: 'https://official.example/news',
              content: 'Actualités',
            },
            {
              title: 'Journal spécialisé',
              url: 'https://journal.example/ia',
              content: 'Actualités',
            },
          ],
          usage: { credits: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const tavily = new TavilySearchClient('test', fetcher as typeof fetch);
    const engine: WatchLanguageEngine = {
      planWatchDiscovery: async () => ({
        concepts: ['Modèles', 'Python'],
        themes: [
          { title: 'Modèles locaux', summary: 'Modèles exécutés localement.' },
          { title: 'Agents IA', summary: 'Agents et automatisation.' },
          { title: 'Outils data', summary: 'Outils pour la data science.' },
          { title: 'Robotique', summary: 'Robotique et systèmes embarqués.' },
          { title: 'Fiabilité', summary: 'Sécurité et gouvernance.' },
        ],
        queries: [
          { kind: 'official', query: 'IA sources officielles' },
          { kind: 'research', query: 'IA recherche' },
          { kind: 'specialized_press', query: 'IA presse spécialisée' },
          { kind: 'general_press', query: 'IA presse généraliste' },
        ],
      }),
    };
    const service = new WatchService(database, engine, feedClient, tavily);
    try {
      const result = await service.discoverSources(
        'profile-a',
        {
          name: 'Veille IA',
          question: 'Quelles nouveautés en intelligence artificielle ?',
          includeKeywords: ['LLM'],
          excludeKeywords: [],
          languages: ['fr', 'en'],
        },
        new AbortController().signal,
      );
      expect(result.creditsUsed).toBe(4);
      expect(result.concepts).toEqual(
        expect.arrayContaining(['Modèles', 'Python', 'LLM']),
      );
      expect(result.themes).toHaveLength(5);
      expect(result.validatedCount).toBe(1);
      expect(result.candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'validated' }),
          expect.objectContaining({ status: 'rejected' }),
        ]),
      );
      expect(
        database
          .prepare('SELECT COUNT(*) AS count FROM watch_source_candidates')
          .get(),
      ).toEqual({ count: 2 });
      const watchId = 'a8bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
      const now = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO watches(
             id, profile_id, name, question, include_keywords_json,
             exclude_keywords_json, languages_json, cadence, local_time,
             weekday, time_zone, status, baseline_completed_at,
             memory_initialized_at, next_digest_at, created_at, updated_at
           ) VALUES (?, 'profile-a', 'IA', 'Nouveautés IA', '["LLM"]', '[]',
             '["fr","en"]', 'daily', '07:30', NULL, 'Europe/Paris', 'active',
             ?, ?, '2099-01-01T06:30:00.000Z', ?, ?)`,
        )
        .run(watchId, now, now, now, now);
      const validated = result.candidates.find(
        (candidate) => candidate.status === 'validated',
      )!;
      const addition = service.addDiscoveredSources(
        'profile-a',
        watchId,
        result.id,
        [validated.id],
      );
      expect(addition.addedCount).toBe(1);
      expect(addition.watch.sources).toEqual([
        expect.objectContaining({ feedUrl: validated.feedUrl }),
      ]);
      expect(
        service.addDiscoveredSources('profile-a', watchId, result.id, [
          validated.id,
        ]).addedCount,
      ).toBe(0);
      expect(() =>
        service.addDiscoveredSources('profile-b', watchId, result.id, [
          validated.id,
        ]),
      ).toThrow(WatchNotFoundError);
    } finally {
      await service.stop();
      database.close();
    }
  });
});
