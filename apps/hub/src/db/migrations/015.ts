export const MIGRATION_015 = `
  ALTER TABLE assistant_messages ADD COLUMN assistant_model TEXT NOT NULL DEFAULT 'gemma4'
    CHECK (assistant_model IN ('gemma4', 'qwen3.5'));
  ALTER TABLE assistant_runs ADD COLUMN assistant_model TEXT NOT NULL DEFAULT 'gemma4'
    CHECK (assistant_model IN ('gemma4', 'qwen3.5'));
`;
