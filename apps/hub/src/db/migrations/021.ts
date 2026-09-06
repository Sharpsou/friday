export const MIGRATION_021 = `
  ALTER TABLE robot_memory_entities ADD COLUMN map_x REAL;
  ALTER TABLE robot_memory_entities ADD COLUMN map_y REAL;
  ALTER TABLE robot_memory_entities ADD COLUMN map_uncertainty REAL;
  ALTER TABLE robot_memory_entities ADD COLUMN map_session_id TEXT;

  CREATE TABLE robot_mapping_sessions (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('recording', 'paused', 'processing', 'draft', 'explored', 'certified')),
    point_count INTEGER NOT NULL DEFAULT 0 CHECK (point_count BETWEEN 0 AND 2000),
    storage_bytes INTEGER NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX robot_mapping_sessions_household_idx
    ON robot_mapping_sessions(household_id, updated_at);

  CREATE TABLE robot_map_points (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES robot_mapping_sessions(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    x REAL NOT NULL,
    y REAL NOT NULL,
    heading REAL NOT NULL,
    uncertainty REAL NOT NULL CHECK (uncertainty BETWEEN 0 AND 100),
    direction TEXT CHECK (direction IN ('forward', 'backward', 'left', 'right')),
    intensity REAL CHECK (intensity IS NULL OR intensity BETWEEN 0.1 AND 0.35),
    steering REAL CHECK (steering IS NULL OR steering BETWEEN -1 AND 1),
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 100 AND 500),
    frame_id INTEGER,
    recorded_at TEXT NOT NULL,
    UNIQUE(session_id, sequence)
  );
  CREATE INDEX robot_map_points_session_idx
    ON robot_map_points(session_id, sequence);

  CREATE TABLE robot_map_runtime (
    household_id TEXT PRIMARY KEY,
    operating_mode TEXT NOT NULL CHECK (operating_mode IN ('manual', 'autonomous')),
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    heading REAL NOT NULL DEFAULT 0,
    uncertainty REAL NOT NULL DEFAULT 1 CHECK (uncertainty BETWEEN 0 AND 100),
    last_frame_id INTEGER,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE robot_mission_previews (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    target_point_id TEXT NOT NULL REFERENCES robot_map_points(id) ON DELETE CASCADE,
    allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
    blocked_reason TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX robot_mission_previews_expiry_idx
    ON robot_mission_previews(household_id, expires_at);
`;
