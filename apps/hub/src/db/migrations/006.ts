export const MIGRATION_006 = `
  CREATE TABLE IF NOT EXISTS grocery_classification_jobs (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    taxonomy_id TEXT NOT NULL,
    requested_by_profile_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled')
    ),
    progress_completed INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    snapshot_json TEXT NOT NULL,
    result_json TEXT,
    applied_response_json TEXT,
    applied_at TEXT,
    error_code TEXT,
    error_message TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE INDEX IF NOT EXISTS grocery_classification_jobs_active_idx
    ON grocery_classification_jobs (household_id, taxonomy_id, status, created_at);

  CREATE TABLE IF NOT EXISTS grocery_classifications (
    item_id TEXT PRIMARY KEY REFERENCES grocery_items (id) ON DELETE CASCADE,
    household_id TEXT NOT NULL,
    taxonomy_id TEXT NOT NULL,
    store_family_id TEXT NOT NULL,
    aisle_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('llm', 'rule', 'manual')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    item_revision INTEGER NOT NULL,
    label_fingerprint TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS grocery_classifications_household_idx
    ON grocery_classifications (household_id, taxonomy_id, store_family_id, aisle_id);

  CREATE TABLE IF NOT EXISTS grocery_classification_rules (
    household_id TEXT NOT NULL,
    taxonomy_id TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    store_family_id TEXT NOT NULL,
    aisle_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL,
    PRIMARY KEY (household_id, taxonomy_id, normalized_label)
  );

  CREATE TABLE IF NOT EXISTS grocery_classification_change_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;
