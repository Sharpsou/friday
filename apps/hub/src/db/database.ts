import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

const MIGRATION_001 = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    title TEXT NOT NULL,
    due_date TEXT,
    assignee_profile_id TEXT,
    recurrence TEXT,
    note TEXT,
    status TEXT NOT NULL CHECK (status IN ('todo', 'done')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    created_by_profile_id TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS applied_operations (
    operation_id TEXT PRIMARY KEY,
    result_json TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS change_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

const MIGRATION_002 = `
  ALTER TABLE tasks ADD COLUMN due_time TEXT;
  ALTER TABLE tasks ADD COLUMN duration_minutes INTEGER
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440);
`;

const MIGRATION_003 = `
  CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "emailVerified" INTEGER NOT NULL,
    "image" TEXT,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATE NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "deviceId" TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATE,
    "refreshTokenExpiresAt" DATE,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATE NOT NULL,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  );

  CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
  CREATE INDEX IF NOT EXISTS "session_deviceId_idx" ON "session" ("deviceId");
  CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
  CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

  CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS household_members (
    user_id TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'adult')),
    created_at TEXT NOT NULL,
    UNIQUE (household_id, role)
  );

  CREATE TABLE IF NOT EXISTS friday_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS pairing_codes (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    created_by_user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by_user_id TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_audit_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    user_id TEXT,
    device_id TEXT,
    ip_address TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
  );
`;

const MIGRATION_004 = `
  ALTER TABLE household_members ADD COLUMN login_identifier TEXT;

  UPDATE household_members
     SET login_identifier = (
       SELECT substr(u.email, 1, instr(u.email, '@') - 1)
         FROM "user" u
        WHERE u.id = household_members.user_id
     )
   WHERE login_identifier IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS household_members_login_identifier_idx
    ON household_members (lower(login_identifier))
    WHERE login_identifier IS NOT NULL;
`;

const MIGRATION_005 = `
  CREATE TABLE IF NOT EXISTS grocery_items (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    label TEXT NOT NULL,
    quantity_text TEXT,
    checked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    created_by_profile_id TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS grocery_items_household_checked_idx
    ON grocery_items (household_id, checked_at, created_at);
`;

const MIGRATION_006 = `
  CREATE TABLE IF NOT EXISTS grocery_classification_jobs (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    taxonomy_id TEXT NOT NULL,
    requested_by_profile_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled')
    ),
    progress_completed INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    snapshot_json TEXT NOT NULL,
    result_json TEXT,
    applied_response_json TEXT,
    applied_at TEXT,
    error_code TEXT,
    error_message TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE INDEX IF NOT EXISTS grocery_classification_jobs_active_idx
    ON grocery_classification_jobs (household_id, taxonomy_id, status, created_at);

  CREATE TABLE IF NOT EXISTS grocery_classifications (
    item_id TEXT PRIMARY KEY REFERENCES grocery_items (id) ON DELETE CASCADE,
    household_id TEXT NOT NULL,
    taxonomy_id TEXT NOT NULL,
    store_family_id TEXT NOT NULL,
    aisle_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('llm', 'rule', 'manual')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    item_revision INTEGER NOT NULL,
    label_fingerprint TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS grocery_classifications_household_idx
    ON grocery_classifications (household_id, taxonomy_id, store_family_id, aisle_id);

  CREATE TABLE IF NOT EXISTS grocery_classification_rules (
    household_id TEXT NOT NULL,
    taxonomy_id TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    store_family_id TEXT NOT NULL,
    aisle_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL,
    PRIMARY KEY (household_id, taxonomy_id, normalized_label)
  );

  CREATE TABLE IF NOT EXISTS grocery_classification_change_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

const MIGRATION_007 = `
  ALTER TABLE grocery_items ADD COLUMN manual_store_family_id TEXT;
  ALTER TABLE grocery_items ADD COLUMN manual_aisle_id TEXT;
`;

const MIGRATION_008 = `
  CREATE TABLE IF NOT EXISTS budget_entries (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_recurring_templates (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_envelopes (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_planned_expenses (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_savings_months (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_budget_entries_household_updated
    ON budget_entries(household_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_budget_templates_household_updated
    ON budget_recurring_templates(household_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_budget_envelopes_household_updated
    ON budget_envelopes(household_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_budget_planned_household_updated
    ON budget_planned_expenses(household_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_budget_savings_household_updated
    ON budget_savings_months(household_id, updated_at);
  CREATE TABLE IF NOT EXISTS budget_seed_markers (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL,
    source_digest TEXT NOT NULL,
    summary_json TEXT NOT NULL
  );
`;

const MIGRATION_009 = `
  CREATE TABLE friday_devices_next (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT
  );

  INSERT OR IGNORE INTO friday_devices_next (
    id, user_id, household_id, name, created_at, last_seen_at, revoked_at
  )
  SELECT id, user_id, household_id, name, created_at, last_seen_at, revoked_at
    FROM friday_devices;

  DROP TABLE friday_devices;
  ALTER TABLE friday_devices_next RENAME TO friday_devices;

  CREATE INDEX IF NOT EXISTS friday_devices_user_active_idx
    ON friday_devices (user_id, revoked_at, last_seen_at);

  CREATE TABLE IF NOT EXISTS device_approval_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    request_ip TEXT,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'approved', 'rejected', 'expired')
    ),
    status_token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    approved_by_device_id TEXT REFERENCES friday_devices (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS device_approval_requests_user_pending_idx
    ON device_approval_requests (user_id, status, expires_at);
  CREATE UNIQUE INDEX IF NOT EXISTS device_approval_requests_pending_device_idx
    ON device_approval_requests (user_id, device_id)
    WHERE status = 'pending';
`;

const MIGRATION_010 = `
  CREATE TABLE IF NOT EXISTS assistant_conversations (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    title TEXT NOT NULL,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assistant_conversations_profile_idx
    ON assistant_conversations(profile_id, archived_at, updated_at);

  CREATE TABLE IF NOT EXISTS assistant_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    requested_mode TEXT CHECK (requested_mode IN ('auto', 'web', 'classic')),
    effective_mode TEXT CHECK (effective_mode IN ('web', 'classic')),
    run_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assistant_messages_conversation_idx
    ON assistant_messages(conversation_id, created_at, id);

  CREATE TABLE IF NOT EXISTS assistant_runs (
    id TEXT PRIMARY KEY,
    client_request_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    user_message_id TEXT NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
    assistant_message_id TEXT REFERENCES assistant_messages(id) ON DELETE SET NULL,
    requested_mode TEXT NOT NULL CHECK (requested_mode IN ('auto', 'web', 'classic')),
    effective_mode TEXT CHECK (effective_mode IN ('web', 'classic')),
    status TEXT NOT NULL,
    stage_label TEXT NOT NULL,
    search_queries_json TEXT NOT NULL DEFAULT '[]',
    search_consent INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    lease_until TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(profile_id, client_request_id)
  );
  CREATE INDEX IF NOT EXISTS assistant_runs_queue_idx
    ON assistant_runs(status, created_at, profile_id);

  CREATE TABLE IF NOT EXISTS assistant_sources (
    run_id TEXT NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    domain TEXT NOT NULL,
    published_at TEXT,
    retrieved_at TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    PRIMARY KEY(run_id, source_id)
  );

  CREATE TABLE IF NOT EXISTS assistant_run_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    status TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assistant_run_events_profile_idx
    ON assistant_run_events(profile_id, sequence);

  CREATE TABLE IF NOT EXISTS assistant_scheduler (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_profile_id TEXT
  );
  INSERT OR IGNORE INTO assistant_scheduler(id, last_profile_id) VALUES (1, NULL);
`;

const MIGRATION_011 = `
  ALTER TABLE assistant_messages ADD COLUMN web_depth TEXT
    CHECK (web_depth IN ('fast', 'deep'));
  ALTER TABLE assistant_runs ADD COLUMN web_depth TEXT
    CHECK (web_depth IN ('fast', 'deep'));
`;

const REMOVE_WEB_RESEARCH_TABLES = `
  DROP TABLE IF EXISTS assistant_research_attempts;
  DROP TRIGGER IF EXISTS web_documents_ai;
  DROP TRIGGER IF EXISTS web_documents_ad;
  DROP TRIGGER IF EXISTS web_documents_au;
  DROP TABLE IF EXISTS web_documents_fts;
  DROP TABLE IF EXISTS web_documents;
  DROP TABLE IF EXISTS web_connector_health;
`;

const MIGRATION_014 = `
  ALTER TABLE assistant_conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'local'
    CHECK (mode IN ('local', 'web_light', 'web_deep'));

  ALTER TABLE assistant_messages ADD COLUMN conversation_mode TEXT NOT NULL DEFAULT 'local'
    CHECK (conversation_mode IN ('local', 'web_light', 'web_deep'));
  ALTER TABLE assistant_messages ADD COLUMN thinking_policy TEXT NOT NULL DEFAULT 'auto'
    CHECK (thinking_policy IN ('auto', 'forced'));
  ALTER TABLE assistant_messages ADD COLUMN thinking_used INTEGER NOT NULL DEFAULT 0
    CHECK (thinking_used IN (0, 1));
  ALTER TABLE assistant_messages ADD COLUMN research_outcome TEXT NOT NULL DEFAULT 'not_needed'
    CHECK (research_outcome IN ('not_needed', 'completed', 'partial', 'unavailable', 'quota_exhausted'));
  ALTER TABLE assistant_messages ADD COLUMN credits_used INTEGER NOT NULL DEFAULT 0
    CHECK (credits_used >= 0);

  ALTER TABLE assistant_runs ADD COLUMN conversation_mode TEXT NOT NULL DEFAULT 'local'
    CHECK (conversation_mode IN ('local', 'web_light', 'web_deep'));
  ALTER TABLE assistant_runs ADD COLUMN thinking_policy TEXT NOT NULL DEFAULT 'auto'
    CHECK (thinking_policy IN ('auto', 'forced'));
  ALTER TABLE assistant_runs ADD COLUMN thinking_used INTEGER NOT NULL DEFAULT 0
    CHECK (thinking_used IN (0, 1));
  ALTER TABLE assistant_runs ADD COLUMN research_outcome TEXT NOT NULL DEFAULT 'not_needed'
    CHECK (research_outcome IN ('not_needed', 'completed', 'partial', 'unavailable', 'quota_exhausted'));
  ALTER TABLE assistant_runs ADD COLUMN credits_used INTEGER NOT NULL DEFAULT 0
    CHECK (credits_used >= 0);

  CREATE TABLE assistant_research_attempts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('explore', 'gap', 'adversarial')),
    query TEXT NOT NULL,
    search_depth TEXT NOT NULL CHECK (search_depth IN ('basic', 'advanced')),
    status TEXT NOT NULL CHECK (status IN ('planned', 'completed', 'failed')),
    credits_used INTEGER NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE(run_id, ordinal)
  );
  CREATE INDEX assistant_research_attempts_run_idx
    ON assistant_research_attempts(run_id, ordinal);

  CREATE TABLE assistant_web_usage (
    month TEXT PRIMARY KEY,
    credits_used INTEGER NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
    searches_used INTEGER NOT NULL DEFAULT 0 CHECK (searches_used >= 0),
    updated_at TEXT NOT NULL
  );
`;

const MIGRATION_015 = `
  ALTER TABLE assistant_messages ADD COLUMN assistant_model TEXT NOT NULL DEFAULT 'gemma4'
    CHECK (assistant_model IN ('gemma4', 'qwen3.5'));
  ALTER TABLE assistant_runs ADD COLUMN assistant_model TEXT NOT NULL DEFAULT 'gemma4'
    CHECK (assistant_model IN ('gemma4', 'qwen3.5'));
`;

const MIGRATION_016 = `
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

const MIGRATION_017 = `
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

const MIGRATION_018 = `
  ALTER TABLE watches ADD COLUMN memory_initialized_at TEXT;
  ALTER TABLE watch_runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (trigger IN ('initialization', 'scheduled', 'catch_up', 'manual', 'resume'));
  UPDATE watch_runs
     SET trigger = CASE WHEN manual = 1 THEN 'manual' ELSE 'scheduled' END;
`;

const MIGRATION_019 = `
  CREATE TABLE assistant_exa_usage (
    month TEXT PRIMARY KEY,
    calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
    successes INTEGER NOT NULL DEFAULT 0 CHECK (successes >= 0),
    empty_results INTEGER NOT NULL DEFAULT 0 CHECK (empty_results >= 0),
    rate_limits INTEGER NOT NULL DEFAULT 0 CHECK (rate_limits >= 0),
    failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE assistant_exa_health (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL CHECK (status IN ('untested', 'available', 'rate_limited', 'unavailable')),
    last_attempt_at TEXT,
    last_message TEXT,
    cooldown_until TEXT
  );
  INSERT INTO assistant_exa_health(id, status) VALUES (1, 'untested');

  UPDATE assistant_sources SET provider = 'tavily' WHERE provider = 'legacy';
`;

const MIGRATION_019_COLUMNS = [
  {
    table: 'assistant_research_attempts',
    column: 'provider',
    definition:
      "provider TEXT NOT NULL DEFAULT 'tavily' CHECK (provider IN ('tavily', 'exa'))",
  },
  {
    table: 'assistant_research_attempts',
    column: 'diagnostic_status',
    definition:
      "diagnostic_status TEXT CHECK (diagnostic_status IN ('success', 'empty', 'rate_limited', 'unavailable', 'failed', 'skipped'))",
  },
  {
    table: 'assistant_research_attempts',
    column: 'result_count',
    definition:
      'result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0)',
  },
  {
    table: 'assistant_research_attempts',
    column: 'duration_ms',
    definition:
      'duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0)',
  },
  {
    table: 'assistant_sources',
    column: 'provider',
    definition:
      "provider TEXT NOT NULL DEFAULT 'tavily' CHECK (provider IN ('tavily', 'exa'))",
  },
] as const;

const MIGRATION_020 = `
  ALTER TABLE assistant_conversations ADD COLUMN mode_v2 TEXT
    CHECK (mode_v2 IS NULL OR mode_v2 = 'friday');
  ALTER TABLE assistant_messages ADD COLUMN conversation_mode_v2 TEXT
    CHECK (conversation_mode_v2 IS NULL OR conversation_mode_v2 = 'friday');
  ALTER TABLE assistant_runs ADD COLUMN conversation_mode_v2 TEXT
    CHECK (conversation_mode_v2 IS NULL OR conversation_mode_v2 = 'friday');

  CREATE TABLE robot_rooms (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, name)
  );

  CREATE TABLE robot_memory_entities (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    room_id TEXT NOT NULL REFERENCES robot_rooms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('object', 'light')),
    class_label TEXT NOT NULL,
    display_name TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    spatial_key TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'uncertain')),
    sighting_count INTEGER NOT NULL DEFAULT 0 CHECK (sighting_count >= 0),
    viewpoint_keys_json TEXT NOT NULL DEFAULT '[]',
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_x REAL NOT NULL CHECK (last_x BETWEEN 0 AND 1),
    last_y REAL NOT NULL CHECK (last_y BETWEEN 0 AND 1),
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, room_id, kind, class_label, spatial_key)
  );
  CREATE INDEX robot_memory_entities_household_idx
    ON robot_memory_entities(household_id, status, last_seen_at);

  CREATE TABLE robot_memory_observations (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    entity_id TEXT REFERENCES robot_memory_entities(id) ON DELETE CASCADE,
    frame_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('object', 'person', 'light')),
    class_label TEXT NOT NULL,
    confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    room_name TEXT NOT NULL,
    x REAL NOT NULL CHECK (x BETWEEN 0 AND 1),
    y REAL NOT NULL CHECK (y BETWEEN 0 AND 1),
    observed_at TEXT NOT NULL,
    UNIQUE(household_id, frame_id, kind, class_label, x, y)
  );
  CREATE INDEX robot_memory_observations_expiry_idx
    ON robot_memory_observations(household_id, observed_at);

  CREATE TABLE robot_presence_events (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    room_name TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX robot_presence_events_expiry_idx
    ON robot_presence_events(household_id, last_seen_at);

  CREATE TABLE robot_navigation_policies (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('shadow', 'candidate', 'validated', 'regressed', 'forbidden')),
    parameters_json TEXT NOT NULL,
    episode_count INTEGER NOT NULL DEFAULT 0 CHECK (episode_count >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, version)
  );

  CREATE TABLE robot_learning_episodes (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    policy_id TEXT REFERENCES robot_navigation_policies(id) ON DELETE SET NULL,
    context_json TEXT NOT NULL,
    baseline_action_json TEXT NOT NULL,
    proposed_action_json TEXT NOT NULL,
    applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
    reward REAL,
    outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'success', 'blocked', 'intervention', 'safety_stop')),
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX robot_learning_episodes_household_idx
    ON robot_learning_episodes(household_id, created_at);
`;

const MIGRATION_021 = `
  ALTER TABLE robot_memory_entities ADD COLUMN map_x REAL;
  ALTER TABLE robot_memory_entities ADD COLUMN map_y REAL;
  ALTER TABLE robot_memory_entities ADD COLUMN map_uncertainty REAL;
  ALTER TABLE robot_memory_entities ADD COLUMN map_session_id TEXT;

  CREATE TABLE robot_mapping_sessions (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('recording', 'paused', 'processing', 'draft', 'explored', 'certified')),
    point_count INTEGER NOT NULL DEFAULT 0 CHECK (point_count BETWEEN 0 AND 2000),
    storage_bytes INTEGER NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX robot_mapping_sessions_household_idx
    ON robot_mapping_sessions(household_id, updated_at);

  CREATE TABLE robot_map_points (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES robot_mapping_sessions(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    x REAL NOT NULL,
    y REAL NOT NULL,
    heading REAL NOT NULL,
    uncertainty REAL NOT NULL CHECK (uncertainty BETWEEN 0 AND 100),
    direction TEXT CHECK (direction IN ('forward', 'backward', 'left', 'right')),
    intensity REAL CHECK (intensity IS NULL OR intensity BETWEEN 0.1 AND 0.35),
    steering REAL CHECK (steering IS NULL OR steering BETWEEN -1 AND 1),
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 100 AND 500),
    frame_id INTEGER,
    recorded_at TEXT NOT NULL,
    UNIQUE(session_id, sequence)
  );
  CREATE INDEX robot_map_points_session_idx
    ON robot_map_points(session_id, sequence);

  CREATE TABLE robot_map_runtime (
    household_id TEXT PRIMARY KEY,
    operating_mode TEXT NOT NULL CHECK (operating_mode IN ('manual', 'autonomous')),
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    heading REAL NOT NULL DEFAULT 0,
    uncertainty REAL NOT NULL DEFAULT 1 CHECK (uncertainty BETWEEN 0 AND 100),
    last_frame_id INTEGER,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE robot_mission_previews (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    target_point_id TEXT NOT NULL REFERENCES robot_map_points(id) ON DELETE CASCADE,
    allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
    blocked_reason TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX robot_mission_previews_expiry_idx
    ON robot_mission_previews(household_id, expires_at);
`;

const MIGRATION_022 = `
  CREATE TABLE robot_autonomy_runs (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    map_session_id TEXT REFERENCES robot_mapping_sessions(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('inactive', 'exploring', 'navigating', 'analyzing', 'recovering', 'fault', 'completed')),
    goal TEXT,
    initial_power_percent INTEGER NOT NULL CHECK (initial_power_percent BETWEEN 10 AND 35),
    steering_trim_percent INTEGER NOT NULL CHECK (steering_trim_percent BETWEEN -10 AND 10),
    reward_total REAL NOT NULL DEFAULT 0,
    step_count INTEGER NOT NULL DEFAULT 0 CHECK (step_count >= 0),
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    ended_at TEXT,
    stop_reason TEXT
  );
  CREATE INDEX robot_autonomy_runs_household_idx
    ON robot_autonomy_runs(household_id, started_at);

  CREATE TABLE robot_map_cells (
    household_id TEXT NOT NULL,
    cell_x INTEGER NOT NULL,
    cell_y INTEGER NOT NULL,
    visit_count INTEGER NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
    visual_observation_count INTEGER NOT NULL DEFAULT 0 CHECK (visual_observation_count >= 0),
    uncertainty REAL NOT NULL DEFAULT 1 CHECK (uncertainty BETWEEN 0 AND 100),
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY(household_id, cell_x, cell_y)
  );
  CREATE INDEX robot_map_cells_recent_idx
    ON robot_map_cells(household_id, last_seen_at);

  CREATE TABLE robot_cognition_journal (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    autonomy_run_id TEXT REFERENCES robot_autonomy_runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('analysis_requested', 'goal_accepted', 'goal_rejected', 'learning', 'recovery', 'status')),
    message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
    goal TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX robot_cognition_journal_household_idx
    ON robot_cognition_journal(household_id, created_at);
`;

const MIGRATION_023 = `
  CREATE TABLE robot_memory_keyframes (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    frame_id INTEGER NOT NULL,
    image_jpeg BLOB NOT NULL CHECK (length(image_jpeg) BETWEEN 1 AND 262144),
    image_width INTEGER NOT NULL CHECK (image_width BETWEEN 1 AND 4096),
    image_height INTEGER NOT NULL CHECK (image_height BETWEEN 1 AND 4096),
    pan REAL NOT NULL CHECK (pan BETWEEN -1 AND 1),
    tilt REAL NOT NULL CHECK (tilt BETWEEN -1 AND 1),
    map_x REAL NOT NULL,
    map_y REAL NOT NULL,
    map_heading REAL NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('confirmed_object', 'new_viewpoint')),
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(household_id, frame_id)
  );
  CREATE INDEX robot_memory_keyframes_household_idx
    ON robot_memory_keyframes(household_id, observed_at);

  CREATE TABLE robot_memory_keyframe_entities (
    keyframe_id TEXT NOT NULL REFERENCES robot_memory_keyframes(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES robot_memory_entities(id) ON DELETE CASCADE,
    PRIMARY KEY(keyframe_id, entity_id)
  );
  CREATE INDEX robot_memory_keyframe_entities_entity_idx
    ON robot_memory_keyframe_entities(entity_id, keyframe_id);

  ALTER TABLE robot_memory_observations ADD COLUMN keyframe_id TEXT
    REFERENCES robot_memory_keyframes(id) ON DELETE SET NULL;

  CREATE TABLE robot_map_viewpoints (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    cell_x INTEGER NOT NULL,
    cell_y INTEGER NOT NULL,
    pan_bucket INTEGER NOT NULL,
    tilt_bucket INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    heading REAL NOT NULL,
    pan REAL NOT NULL CHECK (pan BETWEEN -1 AND 1),
    tilt REAL NOT NULL CHECK (tilt BETWEEN -1 AND 1),
    observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count > 0),
    last_frame_id INTEGER NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE(household_id, cell_x, cell_y, pan_bucket, tilt_bucket)
  );
  CREATE INDEX robot_map_viewpoints_household_idx
    ON robot_map_viewpoints(household_id, last_seen_at);
`;

const MIGRATION_024 = `
  ALTER TABLE robot_map_runtime ADD COLUMN localization_status TEXT NOT NULL DEFAULT 'estimated'
    CHECK (localization_status IN ('unknown', 'estimated', 'uncertain', 'relocalizing', 'lost'));
  ALTER TABLE robot_map_runtime ADD COLUMN localization_confidence REAL NOT NULL DEFAULT 0.35
    CHECK (localization_confidence BETWEEN 0 AND 1);
  ALTER TABLE robot_map_runtime ADD COLUMN pose_source TEXT NOT NULL DEFAULT 'odometry'
    CHECK (pose_source IN ('odometry', 'visual_loop', 'visual_relocalization'));
  ALTER TABLE robot_map_runtime ADD COLUMN segment_id TEXT;
  ALTER TABLE robot_map_runtime ADD COLUMN correction_revision INTEGER NOT NULL DEFAULT 0
    CHECK (correction_revision >= 0);
  ALTER TABLE robot_map_runtime ADD COLUMN last_relocalized_at TEXT;
  ALTER TABLE robot_map_runtime ADD COLUMN localization_started_at TEXT;
  ALTER TABLE robot_map_runtime ADD COLUMN drive_sequence INTEGER NOT NULL DEFAULT 0
    CHECK (drive_sequence >= 0);

  ALTER TABLE robot_map_points ADD COLUMN raw_x REAL;
  ALTER TABLE robot_map_points ADD COLUMN raw_y REAL;
  ALTER TABLE robot_map_points ADD COLUMN raw_heading REAL;
  ALTER TABLE robot_map_points ADD COLUMN segment_id TEXT;
  ALTER TABLE robot_map_points ADD COLUMN correction_revision INTEGER NOT NULL DEFAULT 0
    CHECK (correction_revision >= 0);
  ALTER TABLE robot_map_points ADD COLUMN pose_source TEXT NOT NULL DEFAULT 'odometry'
    CHECK (pose_source IN ('odometry', 'visual_loop', 'visual_relocalization'));

  ALTER TABLE robot_map_viewpoints ADD COLUMN segment_id TEXT;
  ALTER TABLE robot_memory_entities ADD COLUMN map_segment_id TEXT;
  ALTER TABLE robot_memory_keyframes ADD COLUMN segment_id TEXT;

  UPDATE robot_map_points
     SET raw_x = x, raw_y = y, raw_heading = heading,
         segment_id = COALESCE(segment_id, session_id);
  UPDATE robot_map_runtime
     SET segment_id = COALESCE(
       segment_id,
       (SELECT session_id FROM robot_map_points
         WHERE household_id = robot_map_runtime.household_id
         ORDER BY recorded_at DESC LIMIT 1),
       lower(hex(randomblob(16)))
     );
  UPDATE robot_map_viewpoints
     SET segment_id = COALESCE(segment_id, (
       SELECT p.segment_id FROM robot_map_points p
        WHERE p.household_id = robot_map_viewpoints.household_id
        ORDER BY ((p.x - robot_map_viewpoints.x) * (p.x - robot_map_viewpoints.x) +
                  (p.y - robot_map_viewpoints.y) * (p.y - robot_map_viewpoints.y))
        LIMIT 1
     ));
  UPDATE robot_memory_entities
     SET map_segment_id = COALESCE(map_segment_id, map_session_id);
  UPDATE robot_memory_keyframes
     SET segment_id = COALESCE(segment_id, (
       SELECT p.segment_id FROM robot_map_points p
        WHERE p.household_id = robot_memory_keyframes.household_id
        ORDER BY ((p.x - robot_memory_keyframes.map_x) * (p.x - robot_memory_keyframes.map_x) +
                  (p.y - robot_memory_keyframes.map_y) * (p.y - robot_memory_keyframes.map_y))
        LIMIT 1
     ));

  CREATE TABLE robot_place_signatures (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    map_point_id TEXT REFERENCES robot_map_points(id) ON DELETE SET NULL,
    keyframe_id TEXT REFERENCES robot_memory_keyframes(id) ON DELETE SET NULL,
    session_id TEXT REFERENCES robot_mapping_sessions(id) ON DELETE SET NULL,
    segment_id TEXT NOT NULL,
    frame_id INTEGER NOT NULL,
    drive_sequence INTEGER NOT NULL CHECK (drive_sequence >= 0),
    perceptual_hash TEXT NOT NULL CHECK (length(perceptual_hash) = 16),
    keypoints_json TEXT NOT NULL,
    descriptors BLOB NOT NULL,
    feature_count INTEGER NOT NULL CHECK (feature_count BETWEEN 0 AND 500),
    quality REAL NOT NULL CHECK (quality >= 0),
    pan REAL NOT NULL CHECK (pan BETWEEN -1 AND 1),
    tilt REAL NOT NULL CHECK (tilt BETWEEN -1 AND 1),
    map_x REAL NOT NULL,
    map_y REAL NOT NULL,
    map_heading REAL NOT NULL,
    object_labels_json TEXT NOT NULL,
    protected INTEGER NOT NULL DEFAULT 0 CHECK (protected IN (0, 1)),
    storage_bytes INTEGER NOT NULL CHECK (storage_bytes >= 0),
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(household_id, frame_id)
  );
  CREATE INDEX robot_place_signatures_household_idx
    ON robot_place_signatures(household_id, observed_at);
  CREATE INDEX robot_place_signatures_segment_idx
    ON robot_place_signatures(household_id, segment_id, observed_at);

  CREATE TABLE robot_pose_constraints (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    source_point_id TEXT NOT NULL REFERENCES robot_map_points(id) ON DELETE CASCADE,
    target_point_id TEXT NOT NULL REFERENCES robot_map_points(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('visual_loop', 'manual_relocation')),
    dx REAL NOT NULL,
    dy REAL NOT NULL,
    dheading REAL NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    inlier_count INTEGER NOT NULL CHECK (inlier_count >= 0),
    inlier_ratio REAL NOT NULL CHECK (inlier_ratio BETWEEN 0 AND 1),
    created_at TEXT NOT NULL
  );
  CREATE INDEX robot_pose_constraints_household_idx
    ON robot_pose_constraints(household_id, created_at);

  CREATE TABLE robot_localization_events (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('loop_closure', 'manual_relocation', 'lost', 'recovered', 'rejected')),
    old_x REAL NOT NULL,
    old_y REAL NOT NULL,
    old_heading REAL NOT NULL,
    new_x REAL NOT NULL,
    new_y REAL NOT NULL,
    new_heading REAL NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    created_at TEXT NOT NULL
  );
  CREATE INDEX robot_localization_events_household_idx
    ON robot_localization_events(household_id, created_at);

  CREATE TABLE robot_odometry_calibration (
    household_id TEXT PRIMARY KEY,
    forward_mps REAL NOT NULL DEFAULT 0.55 CHECK (forward_mps BETWEEN 0.4675 AND 0.6325),
    backward_mps REAL NOT NULL DEFAULT 0.45 CHECK (backward_mps BETWEEN 0.3825 AND 0.5175),
    steering_rps REAL NOT NULL DEFAULT 2.0 CHECK (steering_rps BETWEEN 1.7 AND 2.3),
    reverse_steering_rps REAL NOT NULL DEFAULT 1.6 CHECK (reverse_steering_rps BETWEEN 1.36 AND 1.84),
    turn_rps REAL NOT NULL DEFAULT 4.0 CHECK (turn_rps BETWEEN 3.4 AND 4.6),
    accepted_closure_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_closure_count >= 0),
    updated_at TEXT NOT NULL
  );
`;

const MIGRATION_025 = `
  CREATE TABLE robot_human_recovery_demonstrations (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    source_run_id TEXT REFERENCES robot_autonomy_runs(id) ON DELETE SET NULL,
    trigger_kind TEXT NOT NULL
      CHECK (trigger_kind IN ('explicit_recovery', 'manual_takeover')),
    status TEXT NOT NULL
      CHECK (status IN ('collecting', 'applied', 'rejected')),
    source_state TEXT NOT NULL,
    source_action TEXT,
    commands_json TEXT NOT NULL DEFAULT '[]',
    command_count INTEGER NOT NULL DEFAULT 0 CHECK (command_count >= 0),
    total_duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_duration_ms >= 0),
    start_x REAL NOT NULL,
    start_y REAL NOT NULL,
    start_heading REAL NOT NULL,
    end_x REAL,
    end_y REAL,
    end_heading REAL,
    score REAL,
    reason TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX robot_human_recovery_household_idx
    ON robot_human_recovery_demonstrations(household_id, started_at);
`;

// The former Robot subsystem accumulated metric mapping, localization,
// episodic memory and Dyna-Q tables. Version 26 is an intentional clean break:
// the pre-migration SQLite backup is the rollback path, not an implicit import.
const MIGRATION_026 = `
  DROP TABLE robot_memory_keyframe_entities;
  DROP TABLE robot_memory_observations;
  DROP TABLE robot_pose_constraints;
  DROP TABLE robot_place_signatures;
  DROP TABLE robot_mission_previews;
  DROP TABLE robot_cognition_journal;
  DROP TABLE robot_human_recovery_demonstrations;
  DROP TABLE robot_learning_episodes;
  DROP TABLE robot_map_viewpoints;
  DROP TABLE robot_map_cells;
  DROP TABLE robot_localization_events;
  DROP TABLE robot_odometry_calibration;
  DROP TABLE robot_autonomy_runs;
  DROP TABLE robot_map_points;
  DROP TABLE robot_navigation_policies;
  DROP TABLE robot_memory_keyframes;
  DROP TABLE robot_memory_entities;
  DROP TABLE robot_presence_events;
  DROP TABLE robot_map_runtime;
  DROP TABLE robot_mapping_sessions;
  DROP TABLE robot_rooms;
`;

const MIGRATION_027 = `
  CREATE TABLE robot_visual_places (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('provisional', 'confirmed', 'ambiguous')),
    label TEXT,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count > 0),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX robot_visual_places_household_idx
    ON robot_visual_places(household_id, last_seen_at);

  CREATE TABLE robot_visual_place_views (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    frame_id INTEGER NOT NULL,
    perceptual_hash TEXT NOT NULL CHECK (length(perceptual_hash) = 16),
    keypoints_json TEXT NOT NULL,
    descriptors BLOB NOT NULL,
    feature_count INTEGER NOT NULL CHECK (feature_count BETWEEN 0 AND 500),
    quality REAL NOT NULL CHECK (quality >= 0),
    luminance REAL NOT NULL CHECK (luminance BETWEEN 0 AND 255),
    pan REAL NOT NULL CHECK (pan BETWEEN -1 AND 1),
    tilt REAL NOT NULL CHECK (tilt BETWEEN -1 AND 1),
    image_jpeg BLOB CHECK (image_jpeg IS NULL OR length(image_jpeg) BETWEEN 1 AND 131072),
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(household_id, frame_id)
  );
  CREATE INDEX robot_visual_place_views_place_idx
    ON robot_visual_place_views(place_id, observed_at);

  CREATE TABLE robot_visual_transitions (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    from_place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    to_place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('forward', 'backward', 'left', 'right', 'unknown')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    traversal_count INTEGER NOT NULL DEFAULT 1 CHECK (traversal_count > 0),
    first_traversed_at TEXT NOT NULL,
    last_traversed_at TEXT NOT NULL,
    UNIQUE(household_id, from_place_id, to_place_id, direction)
  );

  CREATE TABLE robot_visual_objects (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    class_label TEXT NOT NULL,
    display_name TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    sighting_count INTEGER NOT NULL DEFAULT 1 CHECK (sighting_count > 0),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, place_id, class_label)
  );
  CREATE INDEX robot_visual_objects_household_idx
    ON robot_visual_objects(household_id, last_seen_at);

  CREATE TABLE robot_visual_q_values (
    household_id TEXT NOT NULL,
    state_key TEXT NOT NULL,
    action TEXT NOT NULL,
    q_value REAL NOT NULL DEFAULT 0,
    visit_count INTEGER NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(household_id, state_key, action)
  );

  CREATE TABLE robot_recovery_skills (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    situation_key TEXT NOT NULL,
    commands_json TEXT NOT NULL,
    command_count INTEGER NOT NULL CHECK (command_count BETWEEN 1 AND 100),
    success_count INTEGER NOT NULL DEFAULT 1 CHECK (success_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, situation_key)
  );
`;

const MIGRATION_028 = `
  CREATE TABLE robot_display_preferences (
    household_id TEXT PRIMARY KEY,
    recognition_visible INTEGER NOT NULL DEFAULT 1
      CHECK (recognition_visible IN (0, 1)),
    updated_at TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL
  );
`;

const MIGRATION_029 = `
  CREATE TABLE robot_control_preferences (
    household_id TEXT PRIMARY KEY,
    steering_trim_percent INTEGER NOT NULL DEFAULT 0
      CHECK (steering_trim_percent BETWEEN -10 AND 10),
    updated_at TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL
  );
`;

// Version 30 is a deliberate reset of the unvalidated visual graph.  The
// preceding schema rewarded UUID churn and could connect a camera scan to the
// last wheel command.  Preferences live in separate tables and are preserved.
const MIGRATION_030 = `
  DROP TABLE robot_recovery_skills;
  DROP TABLE robot_visual_q_values;
  DROP TABLE robot_visual_objects;
  DROP TABLE robot_visual_transitions;
  DROP TABLE robot_visual_place_views;
  DROP TABLE robot_visual_places;

  CREATE TABLE robot_visual_places (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('provisional', 'confirmed', 'ambiguous')),
    label TEXT,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count > 0),
    panorama_status TEXT NOT NULL DEFAULT 'absent'
      CHECK (panorama_status IN ('absent', 'incomplete', 'complete')),
    canonical_sector_id TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX robot_visual_places_household_idx
    ON robot_visual_places(household_id, last_seen_at);

  CREATE TABLE robot_visual_place_views (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    frame_id INTEGER NOT NULL,
    perceptual_hash TEXT NOT NULL CHECK (length(perceptual_hash) = 16),
    keypoints_json TEXT NOT NULL,
    descriptors BLOB NOT NULL,
    feature_count INTEGER NOT NULL CHECK (feature_count BETWEEN 0 AND 500),
    quality REAL NOT NULL CHECK (quality >= 0),
    luminance REAL NOT NULL CHECK (luminance BETWEEN 0 AND 255),
    pan REAL NOT NULL CHECK (pan BETWEEN -1 AND 1),
    tilt REAL NOT NULL CHECK (tilt BETWEEN -1 AND 1),
    image_jpeg BLOB CHECK (image_jpeg IS NULL OR length(image_jpeg) BETWEEN 1 AND 131072),
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(household_id, frame_id)
  );
  CREATE INDEX robot_visual_place_views_place_idx
    ON robot_visual_place_views(place_id, observed_at);

  CREATE TABLE robot_visual_anchor_sectors (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 11),
    perceptual_hash TEXT NOT NULL CHECK (length(perceptual_hash) = 16),
    keypoints_json TEXT NOT NULL,
    descriptors BLOB NOT NULL,
    feature_count INTEGER NOT NULL CHECK (feature_count BETWEEN 0 AND 150),
    quality REAL NOT NULL CHECK (quality >= 0),
    observed_at TEXT NOT NULL,
    is_canonical INTEGER NOT NULL DEFAULT 0 CHECK (is_canonical IN (0, 1)),
    UNIQUE(household_id, place_id, ordinal)
  );
  CREATE INDEX robot_visual_anchor_sectors_place_idx
    ON robot_visual_anchor_sectors(place_id, ordinal);

  CREATE TABLE robot_visual_ports (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    sector_id TEXT NOT NULL REFERENCES robot_visual_anchor_sectors(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN (
      'unknown', 'candidate', 'exploring', 'passage_candidate',
      'passage_confirmed', 'temporarily_blocked',
      'dead_end_probable', 'dead_end_confirmed'
    )),
    evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    blocked_until TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, place_id, sector_id)
  );

  CREATE TABLE robot_visual_transitions (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    from_place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    to_place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    from_sector_id TEXT REFERENCES robot_visual_anchor_sectors(id) ON DELETE SET NULL,
    to_sector_id TEXT REFERENCES robot_visual_anchor_sectors(id) ON DELETE SET NULL,
    direction TEXT NOT NULL CHECK (direction IN ('forward', 'backward', 'left', 'right', 'unknown')),
    status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN (
      'candidate', 'confirmed', 'reverse_hypothesis', 'temporarily_blocked'
    )),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    traversal_count INTEGER NOT NULL DEFAULT 1 CHECK (traversal_count > 0),
    success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    expected_duration_ms INTEGER CHECK (expected_duration_ms BETWEEN 1 AND 120000),
    motion_sequence_json TEXT NOT NULL DEFAULT '[]',
    first_traversed_at TEXT NOT NULL,
    last_traversed_at TEXT NOT NULL,
    UNIQUE(household_id, from_place_id, to_place_id, direction)
  );
  CREATE INDEX robot_visual_transitions_route_idx
    ON robot_visual_transitions(household_id, from_place_id, status);

  CREATE TABLE robot_visual_objects (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    class_label TEXT NOT NULL,
    display_name TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    sighting_count INTEGER NOT NULL DEFAULT 1 CHECK (sighting_count > 0),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, place_id, class_label)
  );
  CREATE INDEX robot_visual_objects_household_idx
    ON robot_visual_objects(household_id, last_seen_at);

  CREATE TABLE robot_habit_values (
    household_id TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    context_key TEXT NOT NULL,
    action TEXT NOT NULL,
    q_value REAL NOT NULL DEFAULT 0 CHECK (q_value BETWEEN -10 AND 10),
    visit_count INTEGER NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
    success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    information_gain_total REAL NOT NULL DEFAULT 0,
    duration_total_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_total_ms >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(household_id, policy_version, context_key, action)
  );

  CREATE TABLE robot_recovery_skills (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    situation_key TEXT NOT NULL,
    commands_json TEXT NOT NULL,
    command_count INTEGER NOT NULL CHECK (command_count BETWEEN 1 AND 100),
    success_count INTEGER NOT NULL DEFAULT 1 CHECK (success_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, situation_key)
  );

  CREATE TABLE robot_route_trials (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    target_place_id TEXT REFERENCES robot_visual_places(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
    transition_ids_json TEXT NOT NULL,
    failure_reason TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX robot_route_trials_household_idx
    ON robot_route_trials(household_id, started_at DESC);
`;

const MIGRATION_031 = `
  ALTER TABLE robot_control_preferences
    ADD COLUMN panorama_pulse_ms INTEGER NOT NULL DEFAULT 220
      CHECK (panorama_pulse_ms BETWEEN 120 AND 500);
`;

const MIGRATION_032 = `
  CREATE TABLE robot_control_preferences_v32 (
    household_id TEXT PRIMARY KEY,
    steering_trim_percent INTEGER NOT NULL DEFAULT 0
      CHECK (steering_trim_percent BETWEEN -10 AND 10),
    panorama_pulse_ms INTEGER NOT NULL DEFAULT 220
      CHECK (panorama_pulse_ms BETWEEN 120 AND 1000),
    updated_at TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL
  );
  INSERT INTO robot_control_preferences_v32(
    household_id, steering_trim_percent, panorama_pulse_ms, updated_at,
    updated_by_profile_id
  )
  SELECT household_id, steering_trim_percent, panorama_pulse_ms, updated_at,
         updated_by_profile_id
    FROM robot_control_preferences;
  DROP TABLE robot_control_preferences;
  ALTER TABLE robot_control_preferences_v32 RENAME TO robot_control_preferences;
`;

const MIGRATION_033 = `
  ALTER TABLE assistant_sources ADD COLUMN evidence_group_id TEXT;
  ALTER TABLE assistant_sources ADD COLUMN evidence_group_confidence TEXT NOT NULL DEFAULT 'single'
    CHECK (evidence_group_confidence IN ('certain', 'probable', 'single'));
  ALTER TABLE assistant_sources ADD COLUMN evidence_group_representative_source_id TEXT;
  ALTER TABLE assistant_sources ADD COLUMN evidence_origin_key TEXT;
  CREATE INDEX assistant_sources_evidence_group_idx
    ON assistant_sources(run_id, evidence_group_id, source_id);
`;

const MIGRATION_034 = `
  ALTER TABLE assistant_runs
    ADD COLUMN research_requirements_json TEXT NOT NULL DEFAULT '[]';
`;

const MIGRATION_035 = `
  ALTER TABLE assistant_runs
    ADD COLUMN evidence_assessment_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE assistant_runs
    ADD COLUMN evidence_review_count INTEGER NOT NULL DEFAULT 0
    CHECK (evidence_review_count BETWEEN 0 AND 2);
  ALTER TABLE assistant_runs
    ADD COLUMN audit_pass_count INTEGER NOT NULL DEFAULT 0
    CHECK (audit_pass_count BETWEEN 0 AND 2);
`;

const MIGRATION_036 = `
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_version TEXT;
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_coverage TEXT
    CHECK (grounding_coverage IS NULL OR grounding_coverage IN ('complete', 'partial', 'insufficient'));
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_accepted_claims INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_accepted_claims >= 0);
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_verified_claims INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_verified_claims >= 0);
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_rejected_claims INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_rejected_claims >= 0);
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_verifier_used INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_verifier_used IN (0, 1));
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_rejection_reasons_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_prompt_versions_json TEXT NOT NULL DEFAULT '{}';
`;

const MIGRATION_037 = `
  CREATE TABLE assistant_processing_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN (
      'local_answer', 'friday_extract', 'web_extract', 'structured_repair',
      'claim_verify', 'continuation', 'title'
    )),
    attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 2),
    model TEXT NOT NULL CHECK (model IN ('gemma4', 'qwen3.5')),
    status TEXT NOT NULL CHECK (status IN (
      'success', 'empty', 'truncated', 'invalid_json', 'invalid_contract',
      'failed', 'skipped'
    )),
    duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
    error_code TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, stage, attempt)
  );
  CREATE INDEX assistant_processing_attempts_run_idx
    ON assistant_processing_attempts(run_id, id);
`;

const MIGRATION_038 = `
  ALTER TABLE assistant_processing_attempts
    RENAME TO assistant_processing_attempts_v37;

  CREATE TABLE assistant_processing_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN (
      'local_answer', 'friday_extract', 'web_extract', 'structured_repair',
      'claim_verify', 'web_editorial', 'continuation', 'title'
    )),
    attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 2),
    model TEXT NOT NULL CHECK (model IN ('gemma4', 'qwen3.5')),
    status TEXT NOT NULL CHECK (status IN (
      'success', 'empty', 'truncated', 'invalid_json', 'invalid_contract',
      'failed', 'skipped'
    )),
    duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
    error_code TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, stage, attempt)
  );

  INSERT INTO assistant_processing_attempts(
    id, run_id, stage, attempt, model, status, duration_ms,
    output_tokens, error_code, created_at
  )
  SELECT id, run_id, stage, attempt, model, status, duration_ms,
         output_tokens, error_code, created_at
    FROM assistant_processing_attempts_v37;

  DROP TABLE assistant_processing_attempts_v37;
  CREATE INDEX assistant_processing_attempts_run_idx
    ON assistant_processing_attempts(run_id, id);
`;

const MIGRATION_039 = `
  ALTER TABLE assistant_runs ADD COLUMN grounding_answer_shape TEXT
    CHECK (grounding_answer_shape IS NULL OR grounding_answer_shape IN (
      'comparison', 'explanation', 'list', 'procedure', 'recommendation'
    ));
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_covered_slots INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_covered_slots >= 0);
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_critical_missing_slots INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_critical_missing_slots >= 0);

  CREATE TABLE assistant_grounding_claim_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
    claim_id TEXT NOT NULL,
    requirement_id TEXT NOT NULL,
    source_ids_json TEXT NOT NULL DEFAULT '[]',
    passage_ids_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK (status IN ('accepted', 'verified', 'rejected')),
    reason_codes_json TEXT NOT NULL DEFAULT '[]',
    event_date TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, claim_id)
  );
  CREATE INDEX assistant_grounding_claim_audits_run_idx
    ON assistant_grounding_claim_audits(run_id, id);
`;

const MIGRATION_040 = `
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_total_claims INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_total_claims >= 0);
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_corrected_claims INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_corrected_claims >= 0);
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_removed_claims INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_removed_claims >= 0);
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_audit_passes INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_audit_passes BETWEEN 0 AND 3);
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_correction_passes INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_correction_passes BETWEEN 0 AND 2);
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_corrective_search_used INTEGER NOT NULL DEFAULT 0
    CHECK (grounding_corrective_search_used IN (0, 1));
  ALTER TABLE assistant_runs
    ADD COLUMN grounding_final_status TEXT
    CHECK (grounding_final_status IS NULL OR grounding_final_status IN (
      'passed', 'trimmed', 'insufficient'
    ));

  CREATE TABLE assistant_answer_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
    audit_pass INTEGER NOT NULL CHECK (audit_pass BETWEEN 1 AND 3),
    claim_id TEXT NOT NULL,
    block_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
      'supported', 'contradicted', 'unsupported', 'overstated',
      'citation_mismatch'
    )),
    materiality TEXT NOT NULL CHECK (materiality IN ('material', 'minor')),
    passage_ids_json TEXT NOT NULL DEFAULT '[]',
    reason_codes_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    UNIQUE(run_id, audit_pass, claim_id)
  );
  CREATE INDEX assistant_answer_audits_run_idx
    ON assistant_answer_audits(run_id, audit_pass, id);

  ALTER TABLE assistant_processing_attempts
    RENAME TO assistant_processing_attempts_v39;
  CREATE TABLE assistant_processing_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN (
      'local_answer', 'friday_extract', 'web_extract', 'structured_repair',
      'claim_verify', 'web_editorial', 'web_draft', 'answer_audit',
      'answer_revision', 'continuation', 'title'
    )),
    attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 3),
    model TEXT NOT NULL CHECK (model IN ('gemma4', 'qwen3.5')),
    status TEXT NOT NULL CHECK (status IN (
      'success', 'empty', 'truncated', 'invalid_json', 'invalid_contract',
      'failed', 'skipped'
    )),
    duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
    error_code TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, stage, attempt)
  );
  INSERT INTO assistant_processing_attempts(
    id, run_id, stage, attempt, model, status, duration_ms,
    output_tokens, error_code, created_at
  )
  SELECT id, run_id, stage, attempt, model, status, duration_ms,
         output_tokens, error_code, created_at
    FROM assistant_processing_attempts_v39;
  DROP TABLE assistant_processing_attempts_v39;
  CREATE INDEX assistant_processing_attempts_run_idx
    ON assistant_processing_attempts(run_id, id);
`;

const MIGRATION_041 = `
  CREATE TABLE chat_conversations (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    title TEXT NOT NULL,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX chat_conversations_profile_idx
    ON chat_conversations(profile_id, archived_at, updated_at DESC);

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    answer_status TEXT CHECK (answer_status IS NULL OR answer_status IN (
      'unverified', 'verified', 'partial', 'abstained', 'audit_error'
    )),
    route TEXT CHECK (route IS NULL OR route IN ('local_unverified', 'web_verified')),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
    created_at TEXT NOT NULL
  );
  CREATE INDEX chat_messages_conversation_idx
    ON chat_messages(profile_id, conversation_id, ordinal);
  CREATE UNIQUE INDEX chat_messages_ordinal_idx
    ON chat_messages(conversation_id, ordinal);

  CREATE TABLE chat_runs (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    client_request_id TEXT NOT NULL,
    user_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    assistant_message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    stage TEXT NOT NULL CHECK (stage IN ('queued', 'routing', 'research', 'writing', 'auditing', 'finalizing', 'completed')),
    route TEXT CHECK (route IS NULL OR route IN ('local_unverified', 'web_verified')),
    retrieval_mode TEXT NOT NULL DEFAULT 'none' CHECK (retrieval_mode IN ('none', 'hybrid', 'lexical_fallback')),
    error_code TEXT,
    model_calls INTEGER NOT NULL DEFAULT 0 CHECK (model_calls BETWEEN 0 AND 6),
    source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count BETWEEN 0 AND 8),
    passage_count INTEGER NOT NULL DEFAULT 0 CHECK (passage_count BETWEEN 0 AND 12),
    duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(profile_id, client_request_id)
  );
  CREATE INDEX chat_runs_queue_idx ON chat_runs(status, created_at, id);
  CREATE UNIQUE INDEX chat_runs_one_active_profile_idx
    ON chat_runs(profile_id) WHERE status = 'running';

  CREATE TABLE chat_sources (
    message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    domain TEXT NOT NULL,
    published_at TEXT,
    retrieved_at TEXT NOT NULL,
    PRIMARY KEY(message_id, source_id)
  );
`;

const MIGRATIONS = [
  { sql: MIGRATION_001, version: 1 },
  { sql: MIGRATION_002, version: 2 },
  { sql: MIGRATION_003, version: 3 },
  { sql: MIGRATION_004, version: 4 },
  { sql: MIGRATION_005, version: 5 },
  { sql: MIGRATION_006, version: 6 },
  { sql: MIGRATION_007, version: 7 },
  { sql: MIGRATION_008, version: 8 },
  { sql: MIGRATION_009, version: 9 },
  { sql: MIGRATION_010, version: 10 },
  { sql: MIGRATION_011, version: 11 },
  { sql: REMOVE_WEB_RESEARCH_TABLES, version: 12 },
  { sql: REMOVE_WEB_RESEARCH_TABLES, version: 13 },
  { sql: MIGRATION_014, version: 14 },
  { sql: MIGRATION_015, version: 15 },
  { sql: MIGRATION_016, version: 16 },
  { sql: MIGRATION_017, version: 17 },
  { sql: MIGRATION_018, version: 18 },
  { sql: MIGRATION_019, version: 19 },
  { sql: MIGRATION_020, version: 20 },
  { sql: MIGRATION_021, version: 21 },
  { sql: MIGRATION_022, version: 22 },
  { sql: MIGRATION_023, version: 23 },
  { sql: MIGRATION_024, version: 24 },
  { sql: MIGRATION_025, version: 25 },
  { sql: MIGRATION_026, version: 26 },
  { sql: MIGRATION_027, version: 27 },
  { sql: MIGRATION_028, version: 28 },
  { sql: MIGRATION_029, version: 29 },
  { sql: MIGRATION_030, version: 30 },
  { sql: MIGRATION_031, version: 31 },
  { sql: MIGRATION_032, version: 32 },
  { sql: MIGRATION_033, version: 33 },
  { sql: MIGRATION_034, version: 34 },
  { sql: MIGRATION_035, version: 35 },
  { sql: MIGRATION_036, version: 36 },
  { sql: MIGRATION_037, version: 37 },
  { sql: MIGRATION_038, version: 38 },
  { sql: MIGRATION_039, version: 39 },
  { sql: MIGRATION_040, version: 40 },
  { sql: MIGRATION_041, version: 41 },
] as const;

export function migrateDatabase(
  database: Database.Database,
  throughVersion = Number.POSITIVE_INFINITY,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  for (const migration of MIGRATIONS) {
    if (migration.version > throughVersion) break;
    const applied = database
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(migration.version);
    if (applied) continue;

    database.transaction(() => {
      if (migration.version === 19) {
        for (const column of MIGRATION_019_COLUMNS) {
          const exists = database
            .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`)
            .get(column.table, column.column);
          if (!exists) {
            database.exec(
              `ALTER TABLE ${column.table} ADD COLUMN ${column.definition}`,
            );
          }
        }
      }
      database.exec(migration.sql);
      database
        .prepare(
          'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        )
        .run(migration.version, new Date().toISOString());
    })();
  }
}

export function openDatabase(filename: string): Database.Database {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  if (filename !== ':memory:') {
    database.pragma('journal_mode = WAL');
  }

  migrateDatabase(database);

  return database;
}
