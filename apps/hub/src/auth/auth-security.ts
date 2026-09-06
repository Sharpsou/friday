import type Database from 'better-sqlite3';
import { createHmac } from 'node:crypto';
import { ClosedAuthError } from './auth-records.js';
export class AuthProtection {
  private readonly attempts = new Map<string, number[]>();
  constructor(
    private readonly database: Database.Database,
    private readonly secret: string,
    readonly attemptLimit = 5,
  ) {}
  hashPairingCode(code: string): string {
    return createHmac('sha256', this.secret).update(code).digest('hex');
  }
  hashDeviceApprovalToken(token: string): string {
    return createHmac('sha256', this.secret)
      .update(`device-approval:${token}`)
      .digest('hex');
  }
  audit(
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
  guardAttempts(scope: string, identity: string, maximum: number): void {
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
