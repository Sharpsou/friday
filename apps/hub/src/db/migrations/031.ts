export const MIGRATION_031 = `
  ALTER TABLE robot_control_preferences
    ADD COLUMN panorama_pulse_ms INTEGER NOT NULL DEFAULT 220
      CHECK (panorama_pulse_ms BETWEEN 120 AND 500);
`;
