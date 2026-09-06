export const MIGRATION_009 = `
  CREATE TABLE friday_devices_next (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT
  );

  INSERT OR IGNORE INTO friday_devices_next (
    id, user_id, household_id, name, created_at, last_seen_at, revoked_at
  )
  SELECT id, user_id, household_id, name, created_at, last_seen_at, revoked_at
    FROM friday_devices;

  DROP TABLE friday_devices;
  ALTER TABLE friday_devices_next RENAME TO friday_devices;

  CREATE INDEX IF NOT EXISTS friday_devices_user_active_idx
    ON friday_devices (user_id, revoked_at, last_seen_at);

  CREATE TABLE IF NOT EXISTS device_approval_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    request_ip TEXT,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'approved', 'rejected', 'expired')
    ),
    status_token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    approved_by_device_id TEXT REFERENCES friday_devices (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS device_approval_requests_user_pending_idx
    ON device_approval_requests (user_id, status, expires_at);
  CREATE UNIQUE INDEX IF NOT EXISTS device_approval_requests_pending_device_idx
    ON device_approval_requests (user_id, device_id)
    WHERE status = 'pending';
`;
