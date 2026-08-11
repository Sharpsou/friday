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
