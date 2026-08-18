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
