import {
  type AuthBootstrapRequest,
  type AuthPairRequest,
  type AuthSession,
} from '@friday/contracts';
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type Database from 'better-sqlite3';
import { randomInt, randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import {
  ADULT_PROFILE_ID,
  ClosedAuthError,
  HOUSEHOLD_ID,
  internalEmailFor,
  OWNER_PROFILE_ID,
  PAIRING_CODE_LIFETIME_MS,
} from './auth-records.js';
import type { AuthRepository } from './auth-repository.js';
import type { AuthSessionRuntime } from './auth-runtime.js';
import type { AuthProtection } from './auth-security.js';
export class AuthMembers {
  constructor(
    private readonly database: Database.Database,
    private readonly repository: AuthRepository,
    private readonly security: AuthProtection,
    private readonly runtime: AuthSessionRuntime,
  ) {}
  async bootstrap(
    input: AuthBootstrapRequest,
    headers: IncomingHttpHeaders,
    ipAddress: string,
  ) {
    this.security.guardAttempts(
      'bootstrap',
      ipAddress,
      this.security.attemptLimit,
    );
    if (!this.repository.isBootstrapRequired()) {
      throw new ClosedAuthError(
        'bootstrap_closed',
        409,
        'Le foyer Friday est déjà initialisé.',
      );
    }
    return this.createMember(
      input,
      headers,
      ipAddress,
      'owner',
      OWNER_PROFILE_ID,
    );
  }
  async createPairingCode(
    session: AuthSession,
    userId: string,
    ipAddress: string,
  ): Promise<{ code: string; expiresAt: string }> {
    if (session.member.role !== 'owner') {
      throw new ClosedAuthError(
        'owner_required',
        403,
        'Compte propriétaire requis.',
      );
    }
    const activeMembers = this.database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM household_members
          WHERE household_id = ?`,
      )
      .get(HOUSEHOLD_ID) as { count: number };
    if (
      activeMembers.count >= 2 &&
      !this.hasRevokedAdultWithoutActiveDevice()
    ) {
      throw new ClosedAuthError(
        'household_full',
        409,
        'Les deux adultes sont déjà inscrits.',
      );
    }

    const code = randomInt(0, 100_000_000).toString().padStart(8, '0');
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + PAIRING_CODE_LIFETIME_MS,
    ).toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE pairing_codes
              SET used_at = ?
            WHERE household_id = ? AND used_at IS NULL`,
        )
        .run(now.toISOString(), HOUSEHOLD_ID);
      this.database
        .prepare(
          `INSERT INTO pairing_codes (
             id, household_id, code_hash, created_by_user_id,
             expires_at, used_at, used_by_user_id, created_at
           ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
        )
        .run(
          randomUUID(),
          HOUSEHOLD_ID,
          this.security.hashPairingCode(code),
          userId,
          expiresAt,
          now.toISOString(),
        );
    })();
    this.security.audit(
      'pairing_code_created',
      userId,
      session.deviceId,
      ipAddress,
    );
    return { code, expiresAt };
  }
  async pair(
    input: AuthPairRequest,
    headers: IncomingHttpHeaders,
    ipAddress: string,
  ) {
    this.security.guardAttempts('pair', ipAddress, this.security.attemptLimit);
    const now = new Date().toISOString();
    const code = this.database
      .prepare(
        `SELECT id
           FROM pairing_codes
          WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .get(this.security.hashPairingCode(input.code), now) as
      { id: string } | undefined;
    if (!code) {
      this.security.audit('pairing_rejected', null, input.deviceId, ipAddress);
      throw new ClosedAuthError(
        'invalid_pairing_code',
        400,
        'Code d’appairage invalide ou expiré.',
      );
    }
    const reserved = this.database
      .prepare(
        `UPDATE pairing_codes SET used_at = ?
          WHERE id = ? AND used_at IS NULL`,
      )
      .run(now, code.id);
    if (reserved.changes !== 1) {
      throw new ClosedAuthError(
        'invalid_pairing_code',
        400,
        'Code déjà utilisé.',
      );
    }

    try {
      const memberCount = this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM household_members WHERE household_id = ?',
        )
        .get(HOUSEHOLD_ID) as { count: number };
      const created =
        memberCount.count < 2
          ? await this.createMember(
              input,
              headers,
              ipAddress,
              'adult',
              ADULT_PROFILE_ID,
            )
          : await this.repairAdult(input, headers, ipAddress);
      const userId = this.repository.findUserIdByProfileId(
        created.session.member.profileId,
      );
      this.database
        .prepare('UPDATE pairing_codes SET used_by_user_id = ? WHERE id = ?')
        .run(userId, code.id);
      return created;
    } catch (error) {
      this.database
        .prepare(
          'UPDATE pairing_codes SET used_at = NULL WHERE id = ? AND used_by_user_id IS NULL',
        )
        .run(code.id);
      throw error;
    }
  }
  forgetAdult(session: AuthSession, userId: string, ipAddress: string): void {
    if (session.member.role !== 'owner') {
      throw new ClosedAuthError(
        'owner_required',
        403,
        'Compte propriétaire requis.',
      );
    }
    const adult = this.database
      .prepare(
        `SELECT m.user_id
           FROM household_members m
          WHERE m.household_id = ? AND m.role = 'adult'`,
      )
      .get(HOUSEHOLD_ID) as { user_id: string } | undefined;
    if (!adult) {
      throw new ClosedAuthError(
        'adult_not_found',
        404,
        'Second adulte introuvable.',
      );
    }
    const activeDevice = this.database
      .prepare(
        `SELECT 1
           FROM friday_devices
          WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .get(adult.user_id);
    if (activeDevice) {
      throw new ClosedAuthError(
        'adult_device_active',
        409,
        'Révoquez d’abord l’appareil du second adulte.',
      );
    }

    this.database.prepare('DELETE FROM "user" WHERE id = ?').run(adult.user_id);
    this.security.audit('adult_forgotten', userId, null, ipAddress);
  }
  async createMember(
    input: AuthBootstrapRequest,
    headers: IncomingHttpHeaders,
    ipAddress: string,
    role: 'owner' | 'adult',
    profileId: string,
  ) {
    let createdUserId: string | null = null;
    try {
      const result = await this.runtime.withDevice(input.deviceId, () =>
        this.runtime.auth.api.signUpEmail({
          body: {
            email: internalEmailFor(input.identifier),
            name: input.name,
            password: input.password,
          },
          headers: fromNodeHeaders(headers),
          returnHeaders: true,
        }),
      );
      createdUserId = result.response.user.id;
      const now = new Date().toISOString();
      this.database.transaction(() => {
        this.database
          .prepare(
            'INSERT OR IGNORE INTO households (id, name, created_at) VALUES (?, ?, ?)',
          )
          .run(HOUSEHOLD_ID, 'Maison', now);
        this.database
          .prepare(
            `INSERT INTO household_members (
               user_id, household_id, profile_id, role, created_at,
               login_identifier
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            createdUserId,
            HOUSEHOLD_ID,
            profileId,
            role,
            now,
            input.identifier,
          );
        this.database
          .prepare(
            `INSERT INTO friday_devices (
               id, user_id, household_id, name, created_at, last_seen_at, revoked_at
             ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            input.deviceId,
            createdUserId,
            HOUSEHOLD_ID,
            input.deviceName,
            now,
            now,
          );
      })();
      const member = this.repository.findMemberByUserAndDevice(
        createdUserId,
        input.deviceId,
      );
      if (!member) throw new Error('Membre Friday introuvable après création.');
      this.security.audit(
        `${role}_created`,
        createdUserId,
        input.deviceId,
        ipAddress,
      );
      return {
        headers: result.headers,
        session: this.repository.toSession(member),
      };
    } catch (error) {
      if (createdUserId) {
        this.database
          .prepare('DELETE FROM "user" WHERE id = ?')
          .run(createdUserId);
      }
      if (error instanceof APIError) {
        throw new ClosedAuthError(
          'invalid_credentials',
          error.statusCode >= 400 ? error.statusCode : 400,
          error.message,
        );
      }
      throw error;
    }
  }
  async repairAdult(
    input: AuthPairRequest,
    headers: IncomingHttpHeaders,
    ipAddress: string,
  ) {
    const adult = this.database
      .prepare(
        `SELECT m.user_id, u.email AS internal_email
           FROM household_members m
           JOIN "user" u ON u.id = m.user_id
          WHERE m.household_id = ? AND m.role = 'adult'
            AND lower(m.login_identifier) = lower(?)
            AND EXISTS (
              SELECT 1 FROM friday_devices d
               WHERE d.user_id = m.user_id AND d.revoked_at IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM friday_devices d
               WHERE d.user_id = m.user_id AND d.revoked_at IS NULL
            )`,
      )
      .get(HOUSEHOLD_ID, input.identifier) as
      { internal_email: string; user_id: string } | undefined;
    if (!adult) {
      throw new ClosedAuthError(
        'pairing_account_mismatch',
        403,
        'Identifiants du second adulte incorrects.',
      );
    }

    let result;
    try {
      result = await this.runtime.withDevice(input.deviceId, () =>
        this.runtime.auth.api.signInEmail({
          body: { email: adult.internal_email, password: input.password },
          headers: fromNodeHeaders(headers),
          returnHeaders: true,
        }),
      );
    } catch (error) {
      if (error instanceof APIError) {
        throw new ClosedAuthError(
          'invalid_credentials',
          401,
          'Identifiant ou phrase secrète incorrecte.',
        );
      }
      throw error;
    }

    const now = new Date().toISOString();
    this.repository.assertUserDeviceLimit(adult.user_id);
    const inserted = this.database
      .prepare(
        `INSERT INTO friday_devices (
           id, user_id, household_id, name, created_at, last_seen_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.deviceId,
        adult.user_id,
        HOUSEHOLD_ID,
        input.deviceName,
        now,
        now,
      );
    if (inserted.changes !== 1) {
      this.database
        .prepare('DELETE FROM "session" WHERE "deviceId" = ?')
        .run(input.deviceId);
      throw new ClosedAuthError(
        'device_repair_failed',
        409,
        'Réappairage impossible.',
      );
    }
    const member = this.repository.findMemberByUserAndDevice(
      adult.user_id,
      input.deviceId,
    );
    if (!member) throw new Error('Membre introuvable après réappairage.');
    this.security.audit(
      'device_repaired',
      adult.user_id,
      input.deviceId,
      ipAddress,
    );
    return {
      headers: result.headers,
      session: this.repository.toSession(member),
    };
  }
  hasRevokedAdultWithoutActiveDevice(): boolean {
    const row = this.database
      .prepare(
        `SELECT m.user_id
           FROM household_members m
          WHERE m.household_id = ? AND m.role = 'adult'
            AND EXISTS (
              SELECT 1 FROM friday_devices d
               WHERE d.user_id = m.user_id AND d.revoked_at IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM friday_devices d
               WHERE d.user_id = m.user_id AND d.revoked_at IS NULL
            )`,
      )
      .get(HOUSEHOLD_ID);
    return Boolean(row);
  }
}
