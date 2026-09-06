export // The former Robot subsystem accumulated metric mapping, localization,
// episodic memory and Dyna-Q tables. Version 26 is an intentional clean break:
// the pre-migration SQLite backup is the rollback path, not an implicit import.
const MIGRATION_026 = `
  DROP TABLE robot_memory_keyframe_entities;
  DROP TABLE robot_memory_observations;
  DROP TABLE robot_pose_constraints;
  DROP TABLE robot_place_signatures;
  DROP TABLE robot_mission_previews;
  DROP TABLE robot_cognition_journal;
  DROP TABLE robot_human_recovery_demonstrations;
  DROP TABLE robot_learning_episodes;
  DROP TABLE robot_map_viewpoints;
  DROP TABLE robot_map_cells;
  DROP TABLE robot_localization_events;
  DROP TABLE robot_odometry_calibration;
  DROP TABLE robot_autonomy_runs;
  DROP TABLE robot_map_points;
  DROP TABLE robot_navigation_policies;
  DROP TABLE robot_memory_keyframes;
  DROP TABLE robot_memory_entities;
  DROP TABLE robot_presence_events;
  DROP TABLE robot_map_runtime;
  DROP TABLE robot_mapping_sessions;
  DROP TABLE robot_rooms;
`;
