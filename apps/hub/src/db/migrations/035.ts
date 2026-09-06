export const MIGRATION_035 = `
  ALTER TABLE assistant_runs
    ADD COLUMN evidence_assessment_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE assistant_runs
    ADD COLUMN evidence_review_count INTEGER NOT NULL DEFAULT 0
    CHECK (evidence_review_count BETWEEN 0 AND 2);
  ALTER TABLE assistant_runs
    ADD COLUMN audit_pass_count INTEGER NOT NULL DEFAULT 0
    CHECK (audit_pass_count BETWEEN 0 AND 2);
`;
