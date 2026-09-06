export const MIGRATION_029 = `
  CREATE TABLE robot_control_preferences (
    household_id TEXT PRIMARY KEY,
    steering_trim_percent INTEGER NOT NULL DEFAULT 0
      CHECK (steering_trim_percent BETWEEN -10 AND 10),
    updated_at TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL
  );
`;
