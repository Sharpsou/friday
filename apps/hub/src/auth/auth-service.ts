import {
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
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type Database from 'better-sqlite3';
import type { IncomingHttpHeaders } from 'node:http';
import { AuthDevices } from './auth-devices.js';
import { AuthMembers } from './auth-members.js';
import {
  ClosedAuthError,
  type BetterAuthSession,
  type ClosedAuthOptions,
  type LoginMemberRow,
} from './auth-records.js';
import { AuthRepository } from './auth-repository.js';
import { AuthSessionRuntime } from './auth-runtime.js';
import { AuthProtection } from './auth-security.js';
export { ClosedAuthError } from './auth-records.js';
export type { ClosedAuthOptions } from './auth-records.js';
export class ClosedAuthService {
  readonly auth;
  private readonly database: Database.Database;
  private readonly repository: AuthRepository;
  private readonly security: AuthProtection;
  private readonly runtime: AuthSessionRuntime;
  private readonly devices: AuthDevices;
  private readonly members: AuthMembers;
  constructor(options: ClosedAuthOptions) {
    this.database = options.database;
    this.repository = new AuthRepository(options.database);
    this.security = new AuthProtection(
      options.database,
      options.secret,
      options.attemptLimit,
    );
    this.runtime = new AuthSessionRuntime(options);
    this.auth = this.runtime.auth;
    this.devices = new AuthDevices(
      options.database,
      this.repository,
      this.security,
    );
    this.members = new AuthMembers(
      options.database,
      this.repository,
      this.security,
      this.runtime,
    );
  }
  async getSession(headers: IncomingHttpHeaders): Promise<AuthSession | null> {
    const authSession = (await this.runtime.auth.api.getSession({
      headers: fromNodeHeaders(headers),
    })) as BetterAuthSession | null;
    if (!authSession?.session.deviceId) return null;

    const member = this.repository.findMemberByUserAndDevice(
      authSession.user.id,
      authSession.session.deviceId,
    );
    if (!member || member.revoked_at !== null) return null;
    const now = new Date().toISOString();
    this.database
      .prepare('UPDATE friday_devices SET last_seen_at = ? WHERE id = ?')
      .run(now, member.device_id);
    return this.repository.toSession(member);
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
  async login(
    input: AuthLoginRequest,
    headers: IncomingHttpHeaders,
    ipAddress: string,
  ): Promise<
    | { approval: AuthDeviceApprovalRequired; headers?: never; session?: never }
    | { approval?: never; headers: Headers; session: AuthSession }
  > {
    this.security.guardAttempts('login', ipAddress, this.security.attemptLimit);
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
      this.security.audit(
        'login_rejected_credentials',
        null,
        input.deviceId,
        ipAddress,
      );
      throw new ClosedAuthError(
        'invalid_credentials',
        401,
        'Cet appareil n’est pas appairé à ce compte.',
      );
    }

    const knownDevice = this.repository.findMemberByUserAndDevice(
      member.user_id,
      input.deviceId,
    );
    let result;
    try {
      result = await this.runtime.withDevice(input.deviceId, () =>
        this.runtime.auth.api.signInEmail({
          body: { email: member.internal_email, password: input.password },
          headers: fromNodeHeaders(headers),
          returnHeaders: true,
        }),
      );
    } catch (error) {
      if (error instanceof APIError) {
        this.security.audit(
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
      const approval = this.devices.createOrRefreshDeviceApprovalRequest(
        member,
        input.deviceId,
        input.deviceName,
        ipAddress,
      );
      this.security.audit(
        'device_approval_requested',
        member.user_id,
        input.deviceId,
        ipAddress,
      );
      return { approval };
    }
    const row = this.repository.findMemberByUserAndDevice(
      member.user_id,
      input.deviceId,
    );
    if (!row)
      throw new ClosedAuthError('device_not_paired', 403, 'Appareil inconnu.');
    this.security.audit(
      'login_succeeded',
      member.user_id,
      input.deviceId,
      ipAddress,
    );
    return { headers: result.headers, session: this.repository.toSession(row) };
  }
  isBootstrapRequired(): boolean {
    return this.repository.isBootstrapRequired();
  }
  async bootstrap(
    input: AuthBootstrapRequest,
    headers: IncomingHttpHeaders,
    ipAddress: string,
  ) {
    return this.members.bootstrap(input, headers, ipAddress);
  }
  async createPairingCode(
    session: AuthSession,
    userId: string,
    ipAddress: string,
  ): Promise<{ code: string; expiresAt: string }> {
    return this.members.createPairingCode(session, userId, ipAddress);
  }
  async pair(
    input: AuthPairRequest,
    headers: IncomingHttpHeaders,
    ipAddress: string,
  ) {
    return this.members.pair(input, headers, ipAddress);
  }
  listMembers(): AuthMember[] {
    return this.repository.listMembers();
  }
  listDevices(currentDeviceId: string): AuthDevice[] {
    return this.repository.listDevices(currentDeviceId);
  }
  listDeviceApprovalRequests(
    session: AuthSession,
  ): AuthDeviceApprovalRequest[] {
    return this.devices.listDeviceApprovalRequests(session);
  }
  approveDeviceApprovalRequest(
    session: AuthSession,
    requestId: string,
    ipAddress: string,
  ): void {
    return this.devices.approveDeviceApprovalRequest(
      session,
      requestId,
      ipAddress,
    );
  }
  rejectDeviceApprovalRequest(
    session: AuthSession,
    requestId: string,
    ipAddress: string,
  ): void {
    return this.devices.rejectDeviceApprovalRequest(
      session,
      requestId,
      ipAddress,
    );
  }
  getDeviceApprovalStatus(
    requestId: string,
    statusToken: string,
  ): { status: AuthDeviceApprovalStatus } {
    return this.devices.getDeviceApprovalStatus(requestId, statusToken);
  }
  revokeDevice(
    session: AuthSession,
    userId: string,
    deviceId: string,
    ipAddress: string,
  ): void {
    return this.devices.revokeDevice(session, userId, deviceId, ipAddress);
  }
  forgetAdult(session: AuthSession, userId: string, ipAddress: string): void {
    return this.members.forgetAdult(session, userId, ipAddress);
  }
  findAuthUserId(session: AuthSession): string {
    return this.repository.findAuthUserId(session);
  }
}
