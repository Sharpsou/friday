export const MIGRATION_011 = `
  ALTER TABLE assistant_messages ADD COLUMN web_depth TEXT
    CHECK (web_depth IN ('fast', 'deep'));
  ALTER TABLE assistant_runs ADD COLUMN web_depth TEXT
    CHECK (web_depth IN ('fast', 'deep'));
`;
