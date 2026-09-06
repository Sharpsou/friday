export const MIGRATION_005 = `
  CREATE TABLE IF NOT EXISTS grocery_items (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    label TEXT NOT NULL,
    quantity_text TEXT,
    checked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    created_by_profile_id TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS grocery_items_household_checked_idx
    ON grocery_items (household_id, checked_at, created_at);
`;
