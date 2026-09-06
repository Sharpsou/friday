export const MIGRATION_022 = `
  CREATE TABLE robot_autonomy_runs (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    map_session_id TEXT REFERENCES robot_mapping_sessions(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('inactive', 'exploring', 'navigating', 'analyzing', 'recovering', 'fault', 'completed')),
    goal TEXT,
    initial_power_percent INTEGER NOT NULL CHECK (initial_power_percent BETWEEN 10 AND 35),
    steering_trim_percent INTEGER NOT NULL CHECK (steering_trim_percent BETWEEN -10 AND 10),
    reward_total REAL NOT NULL DEFAULT 0,
    step_count INTEGER NOT NULL DEFAULT 0 CHECK (step_count >= 0),
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    ended_at TEXT,
    stop_reason TEXT
  );
  CREATE INDEX robot_autonomy_runs_household_idx
    ON robot_autonomy_runs(household_id, started_at);

  CREATE TABLE robot_map_cells (
    household_id TEXT NOT NULL,
    cell_x INTEGER NOT NULL,
    cell_y INTEGER NOT NULL,
    visit_count INTEGER NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
    visual_observation_count INTEGER NOT NULL DEFAULT 0 CHECK (visual_observation_count >= 0),
    uncertainty REAL NOT NULL DEFAULT 1 CHECK (uncertainty BETWEEN 0 AND 100),
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY(household_id, cell_x, cell_y)
  );
  CREATE INDEX robot_map_cells_recent_idx
    ON robot_map_cells(household_id, last_seen_at);

  CREATE TABLE robot_cognition_journal (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    autonomy_run_id TEXT REFERENCES robot_autonomy_runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('analysis_requested', 'goal_accepted', 'goal_rejected', 'learning', 'recovery', 'status')),
    message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
    goal TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX robot_cognition_journal_household_idx
    ON robot_cognition_journal(household_id, created_at);
`;
