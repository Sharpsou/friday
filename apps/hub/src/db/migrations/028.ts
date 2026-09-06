export const MIGRATION_028 = `
  CREATE TABLE robot_display_preferences (
    household_id TEXT PRIMARY KEY,
    recognition_visible INTEGER NOT NULL DEFAULT 1
      CHECK (recognition_visible IN (0, 1)),
    updated_at TEXT NOT NULL,
    updated_by_profile_id TEXT NOT NULL
  );
`;
