export const MIGRATION_032 = `
  CREATE TABLE robot_control_preferences_v32 (
    household_id TEXT PRIMARY KEY,
    steering_trim_percent INTEGER NOT NULL DEFAULT 0
      CHECK (steering_trim_percent BETWEEN -10 AND 10),
    panorama_pulse_ms INTEGER NOT NULL DEFAULT 220
      CHECK (panorama_pulse_ms BETWEEN 120 AND 1000),
    updated_at TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL
  );
  INSERT INTO robot_control_preferences_v32(
    household_id, steering_trim_percent, panorama_pulse_ms, updated_at,
    updated_by_profile_id
  )
  SELECT household_id, steering_trim_percent, panorama_pulse_ms, updated_at,
         updated_by_profile_id
    FROM robot_control_preferences;
  DROP TABLE robot_control_preferences;
  ALTER TABLE robot_control_preferences_v32 RENAME TO robot_control_preferences;
`;
