export const MIGRATION_041 = `
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
