export const MIGRATION_027 = `
  CREATE TABLE robot_visual_places (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('provisional', 'confirmed', 'ambiguous')),
    label TEXT,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count > 0),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX robot_visual_places_household_idx
    ON robot_visual_places(household_id, last_seen_at);

  CREATE TABLE robot_visual_place_views (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    frame_id INTEGER NOT NULL,
    perceptual_hash TEXT NOT NULL CHECK (length(perceptual_hash) = 16),
    keypoints_json TEXT NOT NULL,
    descriptors BLOB NOT NULL,
    feature_count INTEGER NOT NULL CHECK (feature_count BETWEEN 0 AND 500),
    quality REAL NOT NULL CHECK (quality >= 0),
    luminance REAL NOT NULL CHECK (luminance BETWEEN 0 AND 255),
    pan REAL NOT NULL CHECK (pan BETWEEN -1 AND 1),
    tilt REAL NOT NULL CHECK (tilt BETWEEN -1 AND 1),
    image_jpeg BLOB CHECK (image_jpeg IS NULL OR length(image_jpeg) BETWEEN 1 AND 131072),
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(household_id, frame_id)
  );
  CREATE INDEX robot_visual_place_views_place_idx
    ON robot_visual_place_views(place_id, observed_at);

  CREATE TABLE robot_visual_transitions (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    from_place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    to_place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('forward', 'backward', 'left', 'right', 'unknown')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    traversal_count INTEGER NOT NULL DEFAULT 1 CHECK (traversal_count > 0),
    first_traversed_at TEXT NOT NULL,
    last_traversed_at TEXT NOT NULL,
    UNIQUE(household_id, from_place_id, to_place_id, direction)
  );

  CREATE TABLE robot_visual_objects (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    class_label TEXT NOT NULL,
    display_name TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    sighting_count INTEGER NOT NULL DEFAULT 1 CHECK (sighting_count > 0),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, place_id, class_label)
  );
  CREATE INDEX robot_visual_objects_household_idx
    ON robot_visual_objects(household_id, last_seen_at);

  CREATE TABLE robot_visual_q_values (
    household_id TEXT NOT NULL,
    state_key TEXT NOT NULL,
    action TEXT NOT NULL,
    q_value REAL NOT NULL DEFAULT 0,
    visit_count INTEGER NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(household_id, state_key, action)
  );

  CREATE TABLE robot_recovery_skills (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    situation_key TEXT NOT NULL,
    commands_json TEXT NOT NULL,
    command_count INTEGER NOT NULL CHECK (command_count BETWEEN 1 AND 100),
    success_count INTEGER NOT NULL DEFAULT 1 CHECK (success_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, situation_key)
  );
`;
