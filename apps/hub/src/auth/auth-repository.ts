import {
  AuthSessionSchema,
  type AuthDevice,
  type AuthMember,
  type AuthSession,
} from '@friday/contracts';
import type Database from 'better-sqlite3';
import {
  ClosedAuthError,
  MAX_ACTIVE_DEVICES_PER_USER,
  type MemberRow,
} from './auth-records.js';
export class AuthRepository {
  constructor(private readonly database: Database.Database) {}
  isBootstrapRequired(): boolean {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM household_members')
      .get() as { count: number };
    return row.count === 0;
  }
  listMembers(): AuthMember[] {
    const rows = this.database
      .prepare(
        `SELECT u.name, m.login_identifier, m.profile_id, m.role
           FROM household_members m
           JOIN "user" u ON u.id = m.user_id
          ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END`,
      )
      .all() as Array<{
      login_identifier: string;
      name: string;
      profile_id: string;
      role: 'owner' | 'adult';
    }>;
    return rows.map((row) => ({
      identifier: row.login_identifier,
      name: row.name,
      profileId: row.profile_id,
      role: row.role,
    }));
  }
  listDevices(currentDeviceId: string): AuthDevice[] {
    const rows = this.database
      .prepare(
        `SELECT d.id, d.name, d.created_at, d.last_seen_at, d.revoked_at,
                u.name AS member_name
           FROM friday_devices d
           JOIN "user" u ON u.id = d.user_id
          ORDER BY d.created_at`,
      )
      .all() as Array<{
      created_at: string;
      id: string;
      last_seen_at: string;
      member_name: string;
      name: string;
      revoked_at: string | null;
    }>;
    return rows.map((row) => ({
      createdAt: row.created_at,
      current: row.id === currentDeviceId,
      id: row.id,
      lastSeenAt: row.last_seen_at,
      memberName: row.member_name,
      name: row.name,
      revokedAt: row.revoked_at,
    }));
  }
  findAuthUserId(session: AuthSession): string {
    return this.findUserIdByProfileId(session.member.profileId);
  }
  findMemberByUserAndDevice(
    userId: string,
    deviceId: string,
  ): MemberRow | undefined {
    return this.database
      .prepare(
        `SELECT m.user_id, m.household_id, m.profile_id, m.role,
                m.login_identifier, u.name,
                d.id AS device_id, d.name AS device_name,
                d.revoked_at
           FROM household_members m
           JOIN "user" u ON u.id = m.user_id
           JOIN friday_devices d ON d.user_id = m.user_id
          WHERE m.user_id = ? AND d.id = ?`,
      )
      .get(userId, deviceId) as MemberRow | undefined;
  }
  assertUserDeviceLimit(userId: string): void {
    const activeDevices = this.database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM friday_devices
          WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .get(userId) as { count: number };
    if (activeDevices.count >= MAX_ACTIVE_DEVICES_PER_USER) {
      throw new ClosedAuthError(
        'device_limit_reached',
        409,
        'Limite atteinte. Revoquez un ancien appareil avant d en ajouter un nouveau.',
      );
    }
  }
  findUserIdByProfileId(profileId: string): string {
    const row = this.database
      .prepare('SELECT user_id FROM household_members WHERE profile_id = ?')
      .get(profileId) as { user_id: string } | undefined;
    if (!row)
      throw new ClosedAuthError('member_not_found', 404, 'Membre introuvable.');
    return row.user_id;
  }
  toSession(row: MemberRow): AuthSession {
    return AuthSessionSchema.parse({
      deviceId: row.device_id,
      deviceName: row.device_name,
      member: {
        identifier: row.login_identifier,
        name: row.name,
        profileId: row.profile_id,
        role: row.role,
      },
    });
  }
}
