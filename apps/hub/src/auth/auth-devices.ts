import {
  type AuthDeviceApprovalRequest,
  type AuthDeviceApprovalRequired,
  type AuthDeviceApprovalStatus,
  type AuthSession,
} from '@friday/contracts';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  ClosedAuthError,
  DEVICE_APPROVAL_LIFETIME_MS,
  type DeviceApprovalRow,
  type LoginMemberRow,
} from './auth-records.js';
import type { AuthRepository } from './auth-repository.js';
import type { AuthProtection } from './auth-security.js';
export class AuthDevices {
  constructor(
    private readonly database: Database.Database,
    private readonly repository: AuthRepository,
    private readonly security: AuthProtection,
  ) {}
  listDeviceApprovalRequests(
    session: AuthSession,
  ): AuthDeviceApprovalRequest[] {
    this.expireDeviceApprovalRequests();
    const userId = this.repository.findAuthUserId(session);
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
    const userId = this.repository.findAuthUserId(session);
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
    this.repository.assertUserDeviceLimit(userId);
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
    this.security.audit(
      'device_approval_approved',
      userId,
      row.device_id,
      ipAddress,
    );
  }
  rejectDeviceApprovalRequest(
    session: AuthSession,
    requestId: string,
    ipAddress: string,
  ): void {
    this.expireDeviceApprovalRequests();
    const userId = this.repository.findAuthUserId(session);
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
    this.security.audit('device_approval_rejected', userId, null, ipAddress);
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
      .get(requestId, this.security.hashDeviceApprovalToken(statusToken)) as
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
    this.security.audit('device_revoked', userId, deviceId, ipAddress);
  }
  createOrRefreshDeviceApprovalRequest(
    member: LoginMemberRow,
    deviceId: string,
    deviceName: string,
    ipAddress: string,
  ): AuthDeviceApprovalRequired {
    this.repository.assertUserDeviceLimit(member.user_id);
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + DEVICE_APPROVAL_LIFETIME_MS,
    ).toISOString();
    const statusToken =
      randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const statusTokenHash = this.security.hashDeviceApprovalToken(statusToken);
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
  expireDeviceApprovalRequests(): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE device_approval_requests
            SET status = 'expired', resolved_at = ?
          WHERE status = 'pending' AND expires_at <= ?`,
      )
      .run(now, now);
  }
  toDeviceApprovalRequest(row: DeviceApprovalRow): AuthDeviceApprovalRequest {
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
}
