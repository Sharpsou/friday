export const MIGRATION_040 = `
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
