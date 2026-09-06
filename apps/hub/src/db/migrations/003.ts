export const MIGRATION_003 = `
  CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "emailVerified" INTEGER NOT NULL,
    "image" TEXT,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATE NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "deviceId" TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATE,
    "refreshTokenExpiresAt" DATE,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATE NOT NULL,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  );

  CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
  CREATE INDEX IF NOT EXISTS "session_deviceId_idx" ON "session" ("deviceId");
  CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
  CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

  CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS household_members (
    user_id TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'adult')),
    created_at TEXT NOT NULL,
    UNIQUE (household_id, role)
  );

  CREATE TABLE IF NOT EXISTS friday_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS pairing_codes (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    created_by_user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by_user_id TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_audit_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    user_id TEXT,
    device_id TEXT,
    ip_address TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
  );
`;
