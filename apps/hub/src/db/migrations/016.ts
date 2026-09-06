export const MIGRATION_016 = `
  CREATE TABLE watch_feeds (
    id TEXT PRIMARY KEY,
    feed_url TEXT NOT NULL UNIQUE,
    site_url TEXT NOT NULL,
    title TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT,
    last_fetched_at TEXT,
    next_fetch_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX watch_feeds_due_idx ON watch_feeds(next_fetch_at);

  CREATE TABLE watches (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    question TEXT NOT NULL,
    include_keywords_json TEXT NOT NULL,
    exclude_keywords_json TEXT NOT NULL,
    cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly')),
    local_time TEXT NOT NULL,
    weekday INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
    time_zone TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
    baseline_completed_at TEXT,
    next_digest_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX watches_profile_idx ON watches(profile_id, status, updated_at);
  CREATE INDEX watches_due_idx ON watches(status, next_digest_at);

  CREATE TABLE watch_sources (
    watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
    feed_id TEXT NOT NULL REFERENCES watch_feeds(id) ON DELETE CASCADE,
    PRIMARY KEY(watch_id, feed_id)
  );

  CREATE TABLE watch_articles (
    id TEXT PRIMARY KEY,
    feed_id TEXT NOT NULL REFERENCES watch_feeds(id) ON DELETE CASCADE,
    external_id TEXT,
    canonical_url TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT,
    collected_at TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    UNIQUE(feed_id, canonical_url),
    UNIQUE(feed_id, fingerprint)
  );
  CREATE INDEX watch_articles_feed_date_idx
    ON watch_articles(feed_id, published_at, collected_at);
  CREATE VIRTUAL TABLE watch_articles_fts USING fts5(
    article_id UNINDEXED, title, excerpt, tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TABLE watch_matches (
    watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL REFERENCES watch_articles(id) ON DELETE CASCADE,
    relevant INTEGER NOT NULL CHECK (relevant IN (0, 1)),
    baseline INTEGER NOT NULL CHECK (baseline IN (0, 1)),
    novelty TEXT CHECK (novelty IN ('new', 'evolution', 'confirmation')),
    summary TEXT,
    relevance_reason TEXT,
    model_id TEXT,
    prompt_version TEXT,
    analyzed_at TEXT,
    PRIMARY KEY(watch_id, article_id)
  );

  CREATE TABLE watch_article_states (
    profile_id TEXT NOT NULL,
    watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL REFERENCES watch_articles(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('unread', 'read', 'useful', 'follow_up', 'hidden')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(profile_id, watch_id, article_id)
  );
  CREATE TABLE watch_state_operations (
    operation_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE watch_digests (
    id TEXT PRIMARY KEY,
    watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    new_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX watch_digests_profile_idx ON watch_digests(profile_id, created_at);
  CREATE TABLE watch_digest_articles (
    digest_id TEXT NOT NULL REFERENCES watch_digests(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL REFERENCES watch_articles(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    PRIMARY KEY(digest_id, article_id)
  );

  CREATE TABLE watch_runs (
    id TEXT PRIMARY KEY,
    watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'collecting', 'analyzing', 'completed', 'failed')),
    manual INTEGER NOT NULL CHECK (manual IN (0, 1)),
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX watch_runs_queue_idx ON watch_runs(status, created_at);
`;
