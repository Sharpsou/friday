export const MAISON_MIGRATION = `
ALTER TABLE change_log ADD COLUMN command_id TEXT;
CREATE INDEX change_log_command ON change_log(command_id);
CREATE TABLE maison_records (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, household_id TEXT NOT NULL,
  revision INTEGER NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE INDEX maison_records_kind ON maison_records(kind);
CREATE UNIQUE INDEX maison_recipe_version ON maison_records(json_extract(payload_json,'$.recipeKey'), json_extract(payload_json,'$.version')) WHERE kind='recipe';
CREATE UNIQUE INDEX maison_coverage_origin ON maison_records(json_extract(payload_json,'$.originKey')) WHERE kind='coverage' AND json_extract(payload_json,'$.deletedAt') IS NULL;
CREATE UNIQUE INDEX maison_purchase_receipt ON maison_records(json_extract(payload_json,'$.groceryItemId'), json_extract(payload_json,'$.checkedAt')) WHERE kind='receipt';
CREATE TABLE menu_ai_jobs (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, request_id TEXT NOT NULL,
 payload_json TEXT NOT NULL, UNIQUE(profile_id, request_id));
`;
