export const MIGRATION_008 = `
  CREATE TABLE IF NOT EXISTS budget_entries (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_recurring_templates (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_envelopes (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_planned_expenses (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_savings_months (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_budget_entries_household_updated
    ON budget_entries(household_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_budget_templates_household_updated
    ON budget_recurring_templates(household_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_budget_envelopes_household_updated
    ON budget_envelopes(household_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_budget_planned_household_updated
    ON budget_planned_expenses(household_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_budget_savings_household_updated
    ON budget_savings_months(household_id, updated_at);
  CREATE TABLE IF NOT EXISTS budget_seed_markers (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL,
    source_digest TEXT NOT NULL,
    summary_json TEXT NOT NULL
  );
`;
