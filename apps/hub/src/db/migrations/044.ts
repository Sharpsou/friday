export const MIGRATION_044 = `
  ALTER TABLE chat_sources ADD COLUMN evidence_level TEXT NOT NULL DEFAULT 'readable'
    CHECK (evidence_level IN ('readable', 'discovery_only'));
  ALTER TABLE chat_runs ADD COLUMN discovered_page_count INTEGER NOT NULL DEFAULT 0
    CHECK (discovered_page_count BETWEEN 0 AND 100);
  ALTER TABLE chat_runs ADD COLUMN readable_page_count INTEGER NOT NULL DEFAULT 0
    CHECK (readable_page_count BETWEEN 0 AND 20);
  ALTER TABLE chat_runs ADD COLUMN rejected_page_count INTEGER NOT NULL DEFAULT 0
    CHECK (rejected_page_count BETWEEN 0 AND 100);
  ALTER TABLE chat_runs ADD COLUMN lead_count INTEGER NOT NULL DEFAULT 0
    CHECK (lead_count BETWEEN 0 AND 4);
`;
