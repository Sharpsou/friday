export const MIGRATION_017 = `
  ALTER TABLE watches ADD COLUMN languages_json TEXT NOT NULL DEFAULT '["fr","en"]';
  ALTER TABLE watches ADD COLUMN last_web_search_at TEXT;
  ALTER TABLE watch_feeds ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'rss'
    CHECK (source_mode IN ('rss', 'web'));
  ALTER TABLE watch_runs ADD COLUMN stage TEXT NOT NULL DEFAULT 'queued';
  ALTER TABLE watch_runs ADD COLUMN progress_current INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE watch_runs ADD COLUMN progress_total INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE watch_runs ADD COLUMN checkpoint_json TEXT;

  CREATE TABLE watch_discovery_runs (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    question TEXT NOT NULL,
    concepts_json TEXT NOT NULL,
    queries_json TEXT NOT NULL,
    examined_count INTEGER NOT NULL DEFAULT 0,
    validated_count INTEGER NOT NULL DEFAULT 0,
    credits_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX watch_discovery_profile_idx
    ON watch_discovery_runs(profile_id, created_at);

  CREATE TABLE watch_source_candidates (
    id TEXT PRIMARY KEY,
    discovery_id TEXT NOT NULL REFERENCES watch_discovery_runs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    site_url TEXT NOT NULL,
    feed_url TEXT,
    source_kind TEXT NOT NULL CHECK (source_kind IN (
      'official', 'research', 'specialized_press', 'general_press', 'community'
    )),
    language TEXT NOT NULL,
    score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
    status TEXT NOT NULL CHECK (status IN ('validated', 'rejected')),
    reason TEXT NOT NULL,
    UNIQUE(discovery_id, site_url, feed_url)
  );

  CREATE TABLE watch_concepts (
    id TEXT PRIMARY KEY,
    watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    label TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('tracked', 'secondary', 'muted')),
    origin TEXT NOT NULL CHECK (origin IN ('user', 'assistant')),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE(watch_id, normalized_label)
  );
  CREATE INDEX watch_concepts_profile_idx
    ON watch_concepts(profile_id, watch_id, state);

  CREATE TABLE watch_topics (
    id TEXT PRIMARY KEY,
    watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    event_kind TEXT NOT NULL CHECK (event_kind IN (
      'new_topic', 'major_update', 'additional_detail', 'confirmation',
      'contradiction', 'duplicate', 'noise'
    )),
    importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX watch_topics_profile_idx
    ON watch_topics(profile_id, watch_id, last_seen_at);
  CREATE VIRTUAL TABLE watch_topics_fts USING fts5(
    topic_id UNINDEXED, title, summary, tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TABLE watch_topic_articles (
    topic_id TEXT NOT NULL REFERENCES watch_topics(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL REFERENCES watch_articles(id) ON DELETE CASCADE,
    contribution TEXT NOT NULL CHECK (contribution IN (
      'new_topic', 'major_update', 'additional_detail', 'confirmation',
      'contradiction', 'duplicate', 'noise'
    )),
    created_at TEXT NOT NULL,
    PRIMARY KEY(topic_id, article_id)
  );
  CREATE TABLE watch_topic_concepts (
    topic_id TEXT NOT NULL REFERENCES watch_topics(id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL REFERENCES watch_concepts(id) ON DELETE CASCADE,
    PRIMARY KEY(topic_id, concept_id)
  );
  CREATE TABLE watch_topic_events (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES watch_topics(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL REFERENCES watch_articles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN (
      'new_topic', 'major_update', 'additional_detail', 'confirmation',
      'contradiction', 'duplicate', 'noise'
    )),
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(topic_id, article_id)
  );
  CREATE TABLE watch_concept_state_operations (
    operation_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
  CREATE TABLE watch_web_usage (
    profile_id TEXT NOT NULL,
    month TEXT NOT NULL,
    credits_used INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(profile_id, month)
  );
`;
