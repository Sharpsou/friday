export const MIGRATION_001 = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    title TEXT NOT NULL,
    due_date TEXT,
    assignee_profile_id TEXT,
    recurrence TEXT,
    note TEXT,
    status TEXT NOT NULL CHECK (status IN ('todo', 'done')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    created_by_profile_id TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS applied_operations (
    operation_id TEXT PRIMARY KEY,
    result_json TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS change_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;
