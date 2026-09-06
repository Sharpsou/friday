export const MIGRATION_047 = `CREATE TABLE chat_research_memory (
      message_id TEXT PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
      dossier_json TEXT NOT NULL CHECK(length(dossier_json) <= 160000)
    );`;
