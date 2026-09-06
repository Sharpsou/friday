export const MIGRATION_014 = `
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
