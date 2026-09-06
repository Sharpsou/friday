export const MIGRATION_004 = `
  ALTER TABLE household_members ADD COLUMN login_identifier TEXT;

  UPDATE household_members
     SET login_identifier = (
       SELECT substr(u.email, 1, instr(u.email, '@') - 1)
         FROM "user" u
        WHERE u.id = household_members.user_id
     )
   WHERE login_identifier IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS household_members_login_identifier_idx
    ON household_members (lower(login_identifier))
    WHERE login_identifier IS NOT NULL;
`;
