export const MIGRATION_002 = `
  ALTER TABLE tasks ADD COLUMN due_time TEXT;
  ALTER TABLE tasks ADD COLUMN duration_minutes INTEGER
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440);
`;
