export const REMOVE_WEB_RESEARCH_TABLES = `
  DROP TABLE IF EXISTS assistant_research_attempts;
  DROP TRIGGER IF EXISTS web_documents_ai;
  DROP TRIGGER IF EXISTS web_documents_ad;
  DROP TRIGGER IF EXISTS web_documents_au;
  DROP TABLE IF EXISTS web_documents_fts;
  DROP TABLE IF EXISTS web_documents;
  DROP TABLE IF EXISTS web_connector_health;
`;
