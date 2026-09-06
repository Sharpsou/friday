export const MIGRATION_024 = `
  ALTER TABLE robot_map_runtime ADD COLUMN localization_status TEXT NOT NULL DEFAULT 'estimated'
    CHECK (localization_status IN ('unknown', 'estimated', 'uncertain', 'relocalizing', 'lost'));
  ALTER TABLE robot_map_runtime ADD COLUMN localization_confidence REAL NOT NULL DEFAULT 0.35
    CHECK (localization_confidence BETWEEN 0 AND 1);
  ALTER TABLE robot_map_runtime ADD COLUMN pose_source TEXT NOT NULL DEFAULT 'odometry'
    CHECK (pose_source IN ('odometry', 'visual_loop', 'visual_relocalization'));
  ALTER TABLE robot_map_runtime ADD COLUMN segment_id TEXT;
  ALTER TABLE robot_map_runtime ADD COLUMN correction_revision INTEGER NOT NULL DEFAULT 0
    CHECK (correction_revision >= 0);
  ALTER TABLE robot_map_runtime ADD COLUMN last_relocalized_at TEXT;
  ALTER TABLE robot_map_runtime ADD COLUMN localization_started_at TEXT;
  ALTER TABLE robot_map_runtime ADD COLUMN drive_sequence INTEGER NOT NULL DEFAULT 0
    CHECK (drive_sequence >= 0);

  ALTER TABLE robot_map_points ADD COLUMN raw_x REAL;
  ALTER TABLE robot_map_points ADD COLUMN raw_y REAL;
  ALTER TABLE robot_map_points ADD COLUMN raw_heading REAL;
  ALTER TABLE robot_map_points ADD COLUMN segment_id TEXT;
  ALTER TABLE robot_map_points ADD COLUMN correction_revision INTEGER NOT NULL DEFAULT 0
    CHECK (correction_revision >= 0);
  ALTER TABLE robot_map_points ADD COLUMN pose_source TEXT NOT NULL DEFAULT 'odometry'
    CHECK (pose_source IN ('odometry', 'visual_loop', 'visual_relocalization'));

  ALTER TABLE robot_map_viewpoints ADD COLUMN segment_id TEXT;
  ALTER TABLE robot_memory_entities ADD COLUMN map_segment_id TEXT;
  ALTER TABLE robot_memory_keyframes ADD COLUMN segment_id TEXT;

  UPDATE robot_map_points
     SET raw_x = x, raw_y = y, raw_heading = heading,
         segment_id = COALESCE(segment_id, session_id);
  UPDATE robot_map_runtime
     SET segment_id = COALESCE(
       segment_id,
       (SELECT session_id FROM robot_map_points
         WHERE household_id = robot_map_runtime.household_id
         ORDER BY recorded_at DESC LIMIT 1),
       lower(hex(randomblob(16)))
     );
  UPDATE robot_map_viewpoints
     SET segment_id = COALESCE(segment_id, (
       SELECT p.segment_id FROM robot_map_points p
        WHERE p.household_id = robot_map_viewpoints.household_id
        ORDER BY ((p.x - robot_map_viewpoints.x) * (p.x - robot_map_viewpoints.x) +
                  (p.y - robot_map_viewpoints.y) * (p.y - robot_map_viewpoints.y))
        LIMIT 1
     ));
  UPDATE robot_memory_entities
     SET map_segment_id = COALESCE(map_segment_id, map_session_id);
  UPDATE robot_memory_keyframes
     SET segment_id = COALESCE(segment_id, (
       SELECT p.segment_id FROM robot_map_points p
        WHERE p.household_id = robot_memory_keyframes.household_id
        ORDER BY ((p.x - robot_memory_keyframes.map_x) * (p.x - robot_memory_keyframes.map_x) +
                  (p.y - robot_memory_keyframes.map_y) * (p.y - robot_memory_keyframes.map_y))
        LIMIT 1
     ));

  CREATE TABLE robot_place_signatures (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    map_point_id TEXT REFERENCES robot_map_points(id) ON DELETE SET NULL,
    keyframe_id TEXT REFERENCES robot_memory_keyframes(id) ON DELETE SET NULL,
    session_id TEXT REFERENCES robot_mapping_sessions(id) ON DELETE SET NULL,
    segment_id TEXT NOT NULL,
    frame_id INTEGER NOT NULL,
    drive_sequence INTEGER NOT NULL CHECK (drive_sequence >= 0),
    perceptual_hash TEXT NOT NULL CHECK (length(perceptual_hash) = 16),
    keypoints_json TEXT NOT NULL,
    descriptors BLOB NOT NULL,
    feature_count INTEGER NOT NULL CHECK (feature_count BETWEEN 0 AND 500),
    quality REAL NOT NULL CHECK (quality >= 0),
    pan REAL NOT NULL CHECK (pan BETWEEN -1 AND 1),
    tilt REAL NOT NULL CHECK (tilt BETWEEN -1 AND 1),
    map_x REAL NOT NULL,
    map_y REAL NOT NULL,
    map_heading REAL NOT NULL,
    object_labels_json TEXT NOT NULL,
    protected INTEGER NOT NULL DEFAULT 0 CHECK (protected IN (0, 1)),
    storage_bytes INTEGER NOT NULL CHECK (storage_bytes >= 0),
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(household_id, frame_id)
  );
  CREATE INDEX robot_place_signatures_household_idx
    ON robot_place_signatures(household_id, observed_at);
  CREATE INDEX robot_place_signatures_segment_idx
    ON robot_place_signatures(household_id, segment_id, observed_at);

  CREATE TABLE robot_pose_constraints (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    source_point_id TEXT NOT NULL REFERENCES robot_map_points(id) ON DELETE CASCADE,
    target_point_id TEXT NOT NULL REFERENCES robot_map_points(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('visual_loop', 'manual_relocation')),
    dx REAL NOT NULL,
    dy REAL NOT NULL,
    dheading REAL NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    inlier_count INTEGER NOT NULL CHECK (inlier_count >= 0),
    inlier_ratio REAL NOT NULL CHECK (inlier_ratio BETWEEN 0 AND 1),
    created_at TEXT NOT NULL
  );
  CREATE INDEX robot_pose_constraints_household_idx
    ON robot_pose_constraints(household_id, created_at);

  CREATE TABLE robot_localization_events (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('loop_closure', 'manual_relocation', 'lost', 'recovered', 'rejected')),
    old_x REAL NOT NULL,
    old_y REAL NOT NULL,
    old_heading REAL NOT NULL,
    new_x REAL NOT NULL,
    new_y REAL NOT NULL,
    new_heading REAL NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    created_at TEXT NOT NULL
  );
  CREATE INDEX robot_localization_events_household_idx
    ON robot_localization_events(household_id, created_at);

  CREATE TABLE robot_odometry_calibration (
    household_id TEXT PRIMARY KEY,
    forward_mps REAL NOT NULL DEFAULT 0.55 CHECK (forward_mps BETWEEN 0.4675 AND 0.6325),
    backward_mps REAL NOT NULL DEFAULT 0.45 CHECK (backward_mps BETWEEN 0.3825 AND 0.5175),
    steering_rps REAL NOT NULL DEFAULT 2.0 CHECK (steering_rps BETWEEN 1.7 AND 2.3),
    reverse_steering_rps REAL NOT NULL DEFAULT 1.6 CHECK (reverse_steering_rps BETWEEN 1.36 AND 1.84),
    turn_rps REAL NOT NULL DEFAULT 4.0 CHECK (turn_rps BETWEEN 3.4 AND 4.6),
    accepted_closure_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_closure_count >= 0),
    updated_at TEXT NOT NULL
  );
`;
