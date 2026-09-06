export // Version 30 is a deliberate reset of the unvalidated visual graph.  The
// preceding schema rewarded UUID churn and could connect a camera scan to the
// last wheel command.  Preferences live in separate tables and are preserved.
const MIGRATION_030 = `
  DROP TABLE robot_recovery_skills;
  DROP TABLE robot_visual_q_values;
  DROP TABLE robot_visual_objects;
  DROP TABLE robot_visual_transitions;
  DROP TABLE robot_visual_place_views;
  DROP TABLE robot_visual_places;

  CREATE TABLE robot_visual_places (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('provisional', 'confirmed', 'ambiguous')),
    label TEXT,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count > 0),
    panorama_status TEXT NOT NULL DEFAULT 'absent'
      CHECK (panorama_status IN ('absent', 'incomplete', 'complete')),
    canonical_sector_id TEXT,
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

  CREATE TABLE robot_visual_anchor_sectors (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 11),
    perceptual_hash TEXT NOT NULL CHECK (length(perceptual_hash) = 16),
    keypoints_json TEXT NOT NULL,
    descriptors BLOB NOT NULL,
    feature_count INTEGER NOT NULL CHECK (feature_count BETWEEN 0 AND 150),
    quality REAL NOT NULL CHECK (quality >= 0),
    observed_at TEXT NOT NULL,
    is_canonical INTEGER NOT NULL DEFAULT 0 CHECK (is_canonical IN (0, 1)),
    UNIQUE(household_id, place_id, ordinal)
  );
  CREATE INDEX robot_visual_anchor_sectors_place_idx
    ON robot_visual_anchor_sectors(place_id, ordinal);

  CREATE TABLE robot_visual_ports (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    sector_id TEXT NOT NULL REFERENCES robot_visual_anchor_sectors(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN (
      'unknown', 'candidate', 'exploring', 'passage_candidate',
      'passage_confirmed', 'temporarily_blocked',
      'dead_end_probable', 'dead_end_confirmed'
    )),
    evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    blocked_until TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(household_id, place_id, sector_id)
  );

  CREATE TABLE robot_visual_transitions (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    from_place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    to_place_id TEXT NOT NULL REFERENCES robot_visual_places(id) ON DELETE CASCADE,
    from_sector_id TEXT REFERENCES robot_visual_anchor_sectors(id) ON DELETE SET NULL,
    to_sector_id TEXT REFERENCES robot_visual_anchor_sectors(id) ON DELETE SET NULL,
    direction TEXT NOT NULL CHECK (direction IN ('forward', 'backward', 'left', 'right', 'unknown')),
    status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN (
      'candidate', 'confirmed', 'reverse_hypothesis', 'temporarily_blocked'
    )),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    traversal_count INTEGER NOT NULL DEFAULT 1 CHECK (traversal_count > 0),
    success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    expected_duration_ms INTEGER CHECK (expected_duration_ms BETWEEN 1 AND 120000),
    motion_sequence_json TEXT NOT NULL DEFAULT '[]',
    first_traversed_at TEXT NOT NULL,
    last_traversed_at TEXT NOT NULL,
    UNIQUE(household_id, from_place_id, to_place_id, direction)
  );
  CREATE INDEX robot_visual_transitions_route_idx
    ON robot_visual_transitions(household_id, from_place_id, status);

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

  CREATE TABLE robot_habit_values (
    household_id TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    context_key TEXT NOT NULL,
    action TEXT NOT NULL,
    q_value REAL NOT NULL DEFAULT 0 CHECK (q_value BETWEEN -10 AND 10),
    visit_count INTEGER NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
    success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    information_gain_total REAL NOT NULL DEFAULT 0,
    duration_total_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_total_ms >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(household_id, policy_version, context_key, action)
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

  CREATE TABLE robot_route_trials (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    target_place_id TEXT REFERENCES robot_visual_places(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
    transition_ids_json TEXT NOT NULL,
    failure_reason TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX robot_route_trials_household_idx
    ON robot_route_trials(household_id, started_at DESC);
`;
