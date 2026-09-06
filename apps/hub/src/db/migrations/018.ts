export const MIGRATION_018 = `
  ALTER TABLE watches ADD COLUMN memory_initialized_at TEXT;
  ALTER TABLE watch_runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (trigger IN ('initialization', 'scheduled', 'catch_up', 'manual', 'resume'));
  UPDATE watch_runs
     SET trigger = CASE WHEN manual = 1 THEN 'manual' ELSE 'scheduled' END;
`;
