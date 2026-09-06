export const MIGRATION_025 = `
  CREATE TABLE robot_human_recovery_demonstrations (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    source_run_id TEXT REFERENCES robot_autonomy_runs(id) ON DELETE SET NULL,
    trigger_kind TEXT NOT NULL
      CHECK (trigger_kind IN ('explicit_recovery', 'manual_takeover')),
    status TEXT NOT NULL
      CHECK (status IN ('collecting', 'applied', 'rejected')),
    source_state TEXT NOT NULL,
    source_action TEXT,
    commands_json TEXT NOT NULL DEFAULT '[]',
    command_count INTEGER NOT NULL DEFAULT 0 CHECK (command_count >= 0),
    total_duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_duration_ms >= 0),
    start_x REAL NOT NULL,
    start_y REAL NOT NULL,
    start_heading REAL NOT NULL,
    end_x REAL,
    end_y REAL,
    end_heading REAL,
    score REAL,
    reason TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX robot_human_recovery_household_idx
    ON robot_human_recovery_demonstrations(household_id, started_at);
`;
