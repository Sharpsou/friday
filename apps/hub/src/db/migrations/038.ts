export const MIGRATION_038 = `
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
