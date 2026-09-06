export const MIGRATION_039 = `
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
