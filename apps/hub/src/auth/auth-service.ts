import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import type Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';

import {
  AuthSessionSchema,
  type AuthBootstrapRequest,
  type AuthDevice,
  type AuthDeviceApprovalRequest,
  type AuthDeviceApprovalRequired,
  type AuthDeviceApprovalStatus,
  type AuthLoginRequest,
  type AuthMember,
  type AuthPairRequest,
  type AuthSession,
} from '@friday/contracts';

const HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';
const OWNER_PROFILE_ID = 'f61f8f8b-8d09-4575-8e83-357618e881ac';
const ADULT_PROFILE_ID = '6b0db27d-443d-4dd2-9a21-b809384f2f13';
const PAIRING_CODE_LIFETIME_MS = 10 * 60 * 1_000;
const DEVICE_APPROVAL_LIFETIME_MS = 10 * 60 * 1_000;
const MAX_ACTIVE_DEVICES_PER_USER = 5;

interface SessionDeviceContext {
  deviceId: string;
}

interface MemberRow {
  device_id: string;
  device_name: string;
  household_id: string;
  login_identifier: string;
  name: string;
  profile_id: string;
  revoked_at: string | null;
  role: 'owner' | 'adult';
  user_id: string;
}

interface BetterAuthSession {
  session: { deviceId?: string; id: string; userId: string };
  user: { email: string; id: string; name: string };
}

interface LoginMemberRow {
  household_id: string;
  internal_email: string;
  user_id: string;
}

interface DeviceApprovalRow {
  created_at: string;
  device_id: string;
  device_name: string;
  expires_at: string;
  household_id: string;
  id: string;
  request_ip: string | null;
  status: AuthDeviceApprovalStatus;
  user_id: string;
}

function internalEmailFor(identifier: string): string {
  const digest = createHash('sha256').update(identifier).digest('hex');
  return `${digest}@friday.local`;
}

export class ClosedAuthError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ClosedAuthOptions {
  attemptLimit?: number;
  database: Database.Database;
  publicOrigin: string;
  secret: string;
  trustedOrigins?: string[];
}

export class ClosedAuthService {
  readonly auth;
  private readonly database: Database.Database;
  private readonly enrollmentContext =
    new AsyncLocalStorage<SessionDeviceContext>();
  private readonly secret: string;
  private readonly attempts = new Map<string, number[]>();
  private readonly attemptLimit: number;

  constructor(options: ClosedAuthOptions) {
    this.database = options.database;
    this.secret = options.secret;
    this.attemptLimit = options.attemptLimit ?? 5;
    this.auth = betterAuth({
      advanced: {
        cookiePrefix: 'friday',
        defaultCookieAttributes: { sameSite: 'strict' },
        useSecureCookies: options.publicOrigin.startsWith('https://'),
      },
      basePath: '/api/auth',
      baseURL: options.publicOrigin,
      database: options.database,
      databaseHooks: {
        session: {
          create: {
            before: async (session) => {
              const deviceId = this.enrollmentContext.getStore()?.deviceId;
              if (!deviceId) {
                throw new APIError('FORBIDDEN', {
                  message: 'Appareil non appairé.',
                });
              }
              return { data: { ...session, deviceId } };
            },
          },
        },
      },
      emailAndPassword: {
        autoSignIn: true,
        enabled: true,
        maxPasswordLength: 128,
        minPasswordLength: 12,
        requireEmailVerification: false,
      },
      rateLimit: {
        enabled: true,
        max: 60,
        window: 60,
        customRules: {
          '/sign-in/email': { max: 5, window: 60 },
          '/sign-up/email': { max: 3, window: 60 },
        },
      },
      secret: options.secret,
      session: {
        additionalFields: {
          deviceId: { input: false, required: true, type: 'string' },
        },
        expiresIn: 60 * 60 * 24 * 30,
        updateAge: 60 * 60 * 24,
      },
      trustedOrigins: [
        ...new Set([options.publicOrigin, ...(options.trustedOrigins ?? [])]),
      ],
    });
  }

  isBootstrapRequired(): boolean {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM household_members')
      .get() as { count: number };
    return row.count === 0;
  }

  async getSession(headers: IncomingHttpHeaders): Promise<AuthSession | null> {
    const authSession = (await this.auth.api.getSession({
      headers: fromNodeHeaders(headers),
    })) as BetterAuthSession | null;
    if (!authSession?.session.deviceId) return null;

    const member = this.findMemberByUserAndDevice(
      authSession.user.id,
      authSession.session.deviceId,
    );
    if (!member || member.revoked_at !== null) return null;
    const now = new Date().toISOString();
    this.database
      .prepare('UPDATE friday_devices SET last_seen_at = ? WHERE id = ?')
      .run(now, member.device_id);
    return this.toSession(member);
  }

  async requireSession(headers: IncomingHttpHeaders): Promise<AuthSession> {
    const session = await this.getSession(headers);
    if (!session) {
      throw new ClosedAuthError(
        'authentication_required',
        401,
        'Authentification requise.',
      );
    }
    return session;
  }

  async bootstrap(
    input: AuthBootstrapRequest,
    headers: IncomingHttpHeaders,
    ipAddress: string,
  ) {
    this.guardAttempts('bootstrap', ipAddress, this.attemptLimit);
    if (!this.isBootstrapRequired()) {
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

  async login(
    input: AuthLoginRequest,
    headers: IncomingHttpHeaders,
    ipAddress: string,
  ): Promise<
    | { approval: AuthDeviceApprovalRequired; headers?: never; session?: never }
    | { approval?: never; headers: Headers; session: AuthSession }
  > {
    this.guardAttempts('login', ipAddress, this.attemptLimit);
    const member = this.database
      .prepare(
        `SELECT u.id AS user_id, u.email AS internal_email,
                m.household_id AS household_id
           FROM "user" u
           JOIN household_members m ON m.user_id = u.id
          WHERE lower(m.login_identifier) = lower(?)
          LIMIT 1`,
      )
      .get(input.identifier) as LoginMemberRow | undefined;
    if (!member) {
      this.audit('login_rejected_credentials', null, input.deviceId, ipAddress);
      throw new ClosedAuthError(
        'invalid_credentials',
        401,
        'Cet appareil n’est pas appairé à ce compte.',
      );
    }

    const knownDevice = this.findMemberByUserAndDevice(
      member.user_id,
      input.deviceId,
    );
    let result;
    try {
      result = await this.withDevice(input.deviceId, () =>
        this.auth.api.signInEmail({
          body: { email: member.internal_email, password: input.password },
          headers: fromNodeHeaders(headers),
          returnHeaders: true,
        }),
      );
    } catch (error) {
      if (error instanceof APIError) {
        this.audit(
          'login_rejected_credentials',
          member.user_id,
          input.deviceId,
          ipAddress,
        );
        throw new ClosedAuthError(
          'invalid_credentials',
          401,
          'Identifiant ou phrase secrète incorrecte.',
        );
      }
      throw error;
    }
    if (!knownDevice || knownDevice.revoked_at !== null) {
      this.database
        .prepare('DELETE FROM "session" WHERE "deviceId" = ?')
        .run(input.deviceId);
      const approval = this.createOrRefreshDeviceApprovalRequest(
        member,
        input.deviceId,
        input.deviceName,
        ipAddress,
      );
      this.audit(
        'device_approval_requested',
        member.user_id,
        input.deviceId,
        ipAddress,
      );
      return { approval };
    }
    const row = this.findMemberByUserAndDevice(member.user_id, input.deviceId);
    if (!row)
      throw new ClosedAuthError('device_not_paired', 403, 'Appareil inconnu.');
    this.audit('login_succeeded', member.user_id, input.deviceId, ipAddress);
    return { headers: result.headers, session: this.toSession(row) };
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
          this.hashPairingCode(code),
          userId,
          expiresAt,
          now.toISOString(),
        );
    })();
    this.audit('pairing_code_created', userId, session.deviceId, ipAddress);
    return { code, expiresAt };
  }

  async pair(
    input: AuthPairRequest,
    headers: IncomingHttpHeaders,
    ipAddress: string,
  ) {
    this.guardAttempts('pair', ipAddress, this.attemptLimit);
    const now = new Date().toISOString();
    const code = this.database
      .prepare(
        `SELECT id
           FROM pairing_codes
          WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .get(this.hashPairingCode(input.code), now) as { id: string } | undefined;
    if (!code) {
      this.audit('pairing_rejected', null, input.deviceId, ipAddress);
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
      const userId = this.findUserIdByProfileId(
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

  listDeviceApprovalRequests(
    session: AuthSession,
  ): AuthDeviceApprovalRequest[] {
    this.expireDeviceApprovalRequests();
    const userId = this.findAuthUserId(session);
    const rows = this.database
      .prepare(
        `SELECT id, user_id, household_id, device_id, device_name, request_ip,
                status, expires_at, created_at
           FROM device_approval_requests
          WHERE user_id = ? AND status = 'pending' AND expires_at > ?
          ORDER BY created_at`,
      )
      .all(userId, new Date().toISOString()) as DeviceApprovalRow[];
    return rows.map((row) => this.toDeviceApprovalRequest(row));
  }

  approveDeviceApprovalRequest(
    session: AuthSession,
    requestId: string,
    ipAddress: string,
  ): void {
    this.expireDeviceApprovalRequests();
    const userId = this.findAuthUserId(session);
    const now = new Date().toISOString();
    const row = this.database
      .prepare(
        `SELECT id, user_id, household_id, device_id, device_name, request_ip,
                status, expires_at, created_at
           FROM device_approval_requests
          WHERE id = ? AND user_id = ?`,
      )
      .get(requestId, userId) as DeviceApprovalRow | undefined;
    if (!row) {
      throw new ClosedAuthError(
        'approval_request_not_found',
        404,
        'Demande introuvable.',
      );
    }
    if (row.status !== 'pending' || row.expires_at <= now) {
      throw new ClosedAuthError(
        'approval_request_expired',
        409,
        'Demande expiree.',
      );
    }
    this.assertUserDeviceLimit(userId);
    this.database.transaction(() => {
      const existing = this.database
        .prepare('SELECT user_id FROM friday_devices WHERE id = ?')
        .get(row.device_id) as { user_id: string } | undefined;
      if (existing && existing.user_id !== userId) {
        throw new ClosedAuthError(
          'device_already_registered',
          409,
          'Cet appareil est deja lie a un autre compte.',
        );
      }
      if (existing) {
        this.database
          .prepare(
            `UPDATE friday_devices
                SET name = ?, last_seen_at = ?, revoked_at = NULL
              WHERE id = ? AND user_id = ?`,
          )
          .run(row.device_name, now, row.device_id, userId);
      } else {
        this.database
          .prepare(
            `INSERT INTO friday_devices (
               id, user_id, household_id, name, created_at, last_seen_at, revoked_at
             ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            row.device_id,
            userId,
            row.household_id,
            row.device_name,
            now,
            now,
          );
      }
      this.database
        .prepare(
          `UPDATE device_approval_requests
              SET status = 'approved', approved_by_device_id = ?, resolved_at = ?
            WHERE id = ? AND status = 'pending'`,
        )
        .run(session.deviceId, now, row.id);
    })();
    this.audit('device_approval_approved', userId, row.device_id, ipAddress);
  }

  rejectDeviceApprovalRequest(
    session: AuthSession,
    requestId: string,
    ipAddress: string,
  ): void {
    this.expireDeviceApprovalRequests();
    const userId = this.findAuthUserId(session);
    const now = new Date().toISOString();
    const updated = this.database
      .prepare(
        `UPDATE device_approval_requests
            SET status = 'rejected', resolved_at = ?
          WHERE id = ? AND user_id = ? AND status = 'pending'`,
      )
      .run(now, requestId, userId);
    if (updated.changes !== 1) {
      throw new ClosedAuthError(
        'approval_request_not_found',
        404,
        'Demande introuvable.',
      );
    }
    this.audit('device_approval_rejected', userId, null, ipAddress);
  }

  getDeviceApprovalStatus(
    requestId: string,
    statusToken: string,
  ): { status: AuthDeviceApprovalStatus } {
    this.expireDeviceApprovalRequests();
    const row = this.database
      .prepare(
        `SELECT status, expires_at
           FROM device_approval_requests
          WHERE id = ? AND status_token_hash = ?`,
      )
      .get(requestId, this.hashDeviceApprovalToken(statusToken)) as
      { expires_at: string; status: AuthDeviceApprovalStatus } | undefined;
    if (!row) {
      throw new ClosedAuthError(
        'approval_request_not_found',
        404,
        'Demande introuvable.',
      );
    }
    if (
      row.status === 'pending' &&
      row.expires_at <= new Date().toISOString()
    ) {
      return { status: 'expired' };
    }
    return { status: row.status };
  }

  revokeDevice(
    session: AuthSession,
    userId: string,
    deviceId: string,
    ipAddress: string,
  ): void {
    if (session.member.role !== 'owner') {
      throw new ClosedAuthError(
        'owner_required',
        403,
        'Compte propriétaire requis.',
      );
    }
    if (session.deviceId === deviceId) {
      throw new ClosedAuthError(
        'current_device',
        400,
        'Utilisez Déconnexion pour cet appareil.',
      );
    }
    const now = new Date().toISOString();
    const result = this.database.transaction(() => {
      const updated = this.database
        .prepare(
          'UPDATE friday_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
        )
        .run(now, deviceId);
      this.database
        .prepare('DELETE FROM "session" WHERE "deviceId" = ?')
        .run(deviceId);
      return updated.changes;
    })();
    if (result !== 1) {
      throw new ClosedAuthError(
        'device_not_found',
        404,
        'Appareil introuvable.',
      );
    }
    this.audit('device_revoked', userId, deviceId, ipAddress);
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
    this.audit('adult_forgotten', userId, null, ipAddress);
  }

  findAuthUserId(session: AuthSession): string {
    return this.findUserIdByProfileId(session.member.profileId);
  }

  private async createMember(
    input: AuthBootstrapRequest,
    headers: IncomingHttpHeaders,
    ipAddress: string,
    role: 'owner' | 'adult',
    profileId: string,
  ) {
    let createdUserId: string | null = null;
    try {
      const result = await this.withDevice(input.deviceId, () =>
        this.auth.api.signUpEmail({
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
      const member = this.findMemberByUserAndDevice(
        createdUserId,
        input.deviceId,
      );
      if (!member) throw new Error('Membre Friday introuvable après création.');
      this.audit(`${role}_created`, createdUserId, input.deviceId, ipAddress);
      return { headers: result.headers, session: this.toSession(member) };
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

  private async repairAdult(
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
      result = await this.withDevice(input.deviceId, () =>
        this.auth.api.signInEmail({
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
    this.assertUserDeviceLimit(adult.user_id);
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
    const member = this.findMemberByUserAndDevice(
      adult.user_id,
      input.deviceId,
    );
    if (!member) throw new Error('Membre introuvable après réappairage.');
    this.audit('device_repaired', adult.user_id, input.deviceId, ipAddress);
    return { headers: result.headers, session: this.toSession(member) };
  }

  private findMemberByUserAndDevice(
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

  private createOrRefreshDeviceApprovalRequest(
    member: LoginMemberRow,
    deviceId: string,
    deviceName: string,
    ipAddress: string,
  ): AuthDeviceApprovalRequired {
    this.assertUserDeviceLimit(member.user_id);
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + DEVICE_APPROVAL_LIFETIME_MS,
    ).toISOString();
    const statusToken =
      randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const statusTokenHash = this.hashDeviceApprovalToken(statusToken);
    const existing = this.database
      .prepare(
        `SELECT id
           FROM device_approval_requests
          WHERE user_id = ? AND device_id = ? AND status = 'pending'`,
      )
      .get(member.user_id, deviceId) as { id: string } | undefined;
    if (existing) {
      this.database
        .prepare(
          `UPDATE device_approval_requests
              SET device_name = ?, request_ip = ?, status_token_hash = ?,
                  expires_at = ?, created_at = ?, resolved_at = NULL
            WHERE id = ?`,
        )
        .run(
          deviceName,
          ipAddress,
          statusTokenHash,
          expiresAt,
          createdAt,
          existing.id,
        );
      return {
        approvalRequired: true,
        expiresAt,
        requestId: existing.id,
        statusToken,
      };
    }
    const requestId = randomUUID();
    this.database
      .prepare(
        `INSERT INTO device_approval_requests (
           id, user_id, household_id, device_id, device_name, request_ip,
           status, status_token_hash, expires_at, approved_by_device_id,
           created_at, resolved_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, ?, NULL)`,
      )
      .run(
        requestId,
        member.user_id,
        member.household_id,
        deviceId,
        deviceName,
        ipAddress,
        statusTokenHash,
        expiresAt,
        createdAt,
      );
    return {
      approvalRequired: true,
      expiresAt,
      requestId,
      statusToken,
    };
  }

  private assertUserDeviceLimit(userId: string): void {
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

  private hasRevokedAdultWithoutActiveDevice(): boolean {
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

  private expireDeviceApprovalRequests(): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE device_approval_requests
            SET status = 'expired', resolved_at = ?
          WHERE status = 'pending' AND expires_at <= ?`,
      )
      .run(now, now);
  }

  private toDeviceApprovalRequest(
    row: DeviceApprovalRow,
  ): AuthDeviceApprovalRequest {
    return {
      createdAt: row.created_at,
      deviceId: row.device_id,
      deviceName: row.device_name,
      expiresAt: row.expires_at,
      id: row.id,
      requestIp: row.request_ip,
      status: row.status,
    };
  }

  private findUserIdByProfileId(profileId: string): string {
    const row = this.database
      .prepare('SELECT user_id FROM household_members WHERE profile_id = ?')
      .get(profileId) as { user_id: string } | undefined;
    if (!row)
      throw new ClosedAuthError('member_not_found', 404, 'Membre introuvable.');
    return row.user_id;
  }

  private toSession(row: MemberRow): AuthSession {
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

  private withDevice<T>(
    deviceId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.enrollmentContext.run({ deviceId }, action);
  }

  private hashPairingCode(code: string): string {
    return createHmac('sha256', this.secret).update(code).digest('hex');
  }

  private hashDeviceApprovalToken(token: string): string {
    return createHmac('sha256', this.secret)
      .update(`device-approval:${token}`)
      .digest('hex');
  }

  private audit(
    event: string,
    userId: string | null,
    deviceId: string | null,
    ipAddress: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO auth_audit_log (
           event, user_id, device_id, ip_address, detail, created_at
         ) VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .run(event, userId, deviceId, ipAddress, new Date().toISOString());
  }

  private guardAttempts(
    scope: string,
    identity: string,
    maximum: number,
  ): void {
    const now = Date.now();
    const key = `${scope}:${identity}`;
    const recent = (this.attempts.get(key) ?? []).filter(
      (attemptedAt) => now - attemptedAt < 60_000,
    );
    if (recent.length >= maximum) {
      throw new ClosedAuthError(
        'too_many_attempts',
        429,
        'Trop de tentatives. Réessayez dans une minute.',
      );
    }
    recent.push(now);
    this.attempts.set(key, recent);
  }
}
