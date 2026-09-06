export const MIGRATION_043 = `
  ALTER TABLE chat_runs ADD COLUMN axis_count INTEGER NOT NULL DEFAULT 0
    CHECK (axis_count BETWEEN 0 AND 5);
  ALTER TABLE chat_runs ADD COLUMN required_axis_count INTEGER NOT NULL DEFAULT 0
    CHECK (required_axis_count BETWEEN 0 AND 5);
  ALTER TABLE chat_runs ADD COLUMN covered_axis_count INTEGER NOT NULL DEFAULT 0
    CHECK (covered_axis_count BETWEEN 0 AND 5);
  ALTER TABLE chat_runs ADD COLUMN rejected_unit_count INTEGER NOT NULL DEFAULT 0
    CHECK (rejected_unit_count BETWEEN 0 AND 100);
`;
