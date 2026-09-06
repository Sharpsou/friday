export const MIGRATION_023 = `
  CREATE TABLE robot_memory_keyframes (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    frame_id INTEGER NOT NULL,
    image_jpeg BLOB NOT NULL CHECK (length(image_jpeg) BETWEEN 1 AND 262144),
    image_width INTEGER NOT NULL CHECK (image_width BETWEEN 1 AND 4096),
    image_height INTEGER NOT NULL CHECK (image_height BETWEEN 1 AND 4096),
    pan REAL NOT NULL CHECK (pan BETWEEN -1 AND 1),
    tilt REAL NOT NULL CHECK (tilt BETWEEN -1 AND 1),
    map_x REAL NOT NULL,
    map_y REAL NOT NULL,
    map_heading REAL NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('confirmed_object', 'new_viewpoint')),
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(household_id, frame_id)
  );
  CREATE INDEX robot_memory_keyframes_household_idx
    ON robot_memory_keyframes(household_id, observed_at);

  CREATE TABLE robot_memory_keyframe_entities (
    keyframe_id TEXT NOT NULL REFERENCES robot_memory_keyframes(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES robot_memory_entities(id) ON DELETE CASCADE,
    PRIMARY KEY(keyframe_id, entity_id)
  );
  CREATE INDEX robot_memory_keyframe_entities_entity_idx
    ON robot_memory_keyframe_entities(entity_id, keyframe_id);

  ALTER TABLE robot_memory_observations ADD COLUMN keyframe_id TEXT
    REFERENCES robot_memory_keyframes(id) ON DELETE SET NULL;

  CREATE TABLE robot_map_viewpoints (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    cell_x INTEGER NOT NULL,
    cell_y INTEGER NOT NULL,
    pan_bucket INTEGER NOT NULL,
    tilt_bucket INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    heading REAL NOT NULL,
    pan REAL NOT NULL CHECK (pan BETWEEN -1 AND 1),
    tilt REAL NOT NULL CHECK (tilt BETWEEN -1 AND 1),
    observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count > 0),
    last_frame_id INTEGER NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE(household_id, cell_x, cell_y, pan_bucket, tilt_bucket)
  );
  CREATE INDEX robot_map_viewpoints_household_idx
    ON robot_map_viewpoints(household_id, last_seen_at);
`;
