export const MIGRATION_034 = `
  ALTER TABLE assistant_runs
    ADD COLUMN research_requirements_json TEXT NOT NULL DEFAULT '[]';
`;
