export const MIGRATION_033 = `
  ALTER TABLE assistant_sources ADD COLUMN evidence_group_id TEXT;
  ALTER TABLE assistant_sources ADD COLUMN evidence_group_confidence TEXT NOT NULL DEFAULT 'single'
    CHECK (evidence_group_confidence IN ('certain', 'probable', 'single'));
  ALTER TABLE assistant_sources ADD COLUMN evidence_group_representative_source_id TEXT;
  ALTER TABLE assistant_sources ADD COLUMN evidence_origin_key TEXT;
  CREATE INDEX assistant_sources_evidence_group_idx
    ON assistant_sources(run_id, evidence_group_id, source_id);
`;
