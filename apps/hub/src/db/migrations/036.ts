export const MIGRATION_036 = `
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
