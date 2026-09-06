export const MIGRATION_010 = `
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
