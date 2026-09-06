export const MIGRATION_007 = `
  ALTER TABLE grocery_items ADD COLUMN manual_store_family_id TEXT;
  ALTER TABLE grocery_items ADD COLUMN manual_aisle_id TEXT;
`;
