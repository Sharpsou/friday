export const MIGRATION_020 = `
  ALTER TABLE assistant_conversations ADD COLUMN mode_v2 TEXT
    CHECK (mode_v2 IS NULL OR mode_v2 = 'friday');
  ALTER TABLE assistant_messages ADD COLUMN conversation_mode_v2 TEXT
    CHECK (conversation_mode_v2 IS NULL OR conversation_mode_v2 = 'friday');
  ALTER TABLE assistant_runs ADD COLUMN conversation_mode_v2 TEXT
    CHECK (conversation_mode_v2 IS NULL OR conversation_mode_v2 = 'friday');

  CREATE TABLE robot_rooms (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, name)
  );

  CREATE TABLE robot_memory_entities (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    room_id TEXT NOT NULL REFERENCES robot_rooms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('object', 'light')),
    class_label TEXT NOT NULL,
    display_name TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    spatial_key TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'uncertain')),
    sighting_count INTEGER NOT NULL DEFAULT 0 CHECK (sighting_count >= 0),
    viewpoint_keys_json TEXT NOT NULL DEFAULT '[]',
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_x REAL NOT NULL CHECK (last_x BETWEEN 0 AND 1),
    last_y REAL NOT NULL CHECK (last_y BETWEEN 0 AND 1),
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, room_id, kind, class_label, spatial_key)
  );
  CREATE INDEX robot_memory_entities_household_idx
    ON robot_memory_entities(household_id, status, last_seen_at);

  CREATE TABLE robot_memory_observations (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    entity_id TEXT REFERENCES robot_memory_entities(id) ON DELETE CASCADE,
    frame_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('object', 'person', 'light')),
    class_label TEXT NOT NULL,
    confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    room_name TEXT NOT NULL,
    x REAL NOT NULL CHECK (x BETWEEN 0 AND 1),
    y REAL NOT NULL CHECK (y BETWEEN 0 AND 1),
    observed_at TEXT NOT NULL,
    UNIQUE(household_id, frame_id, kind, class_label, x, y)
  );
  CREATE INDEX robot_memory_observations_expiry_idx
    ON robot_memory_observations(household_id, observed_at);

  CREATE TABLE robot_presence_events (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    room_name TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX robot_presence_events_expiry_idx
    ON robot_presence_events(household_id, last_seen_at);

  CREATE TABLE robot_navigation_policies (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('shadow', 'candidate', 'validated', 'regressed', 'forbidden')),
    parameters_json TEXT NOT NULL,
    episode_count INTEGER NOT NULL DEFAULT 0 CHECK (episode_count >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, version)
  );

  CREATE TABLE robot_learning_episodes (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    policy_id TEXT REFERENCES robot_navigation_policies(id) ON DELETE SET NULL,
    context_json TEXT NOT NULL,
    baseline_action_json TEXT NOT NULL,
    proposed_action_json TEXT NOT NULL,
    applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
    reward REAL,
    outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'success', 'blocked', 'intervention', 'safety_stop')),
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX robot_learning_episodes_household_idx
    ON robot_learning_episodes(household_id, created_at);
`;
