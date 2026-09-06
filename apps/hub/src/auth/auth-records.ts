import { type AuthDeviceApprovalStatus } from '@friday/contracts';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
export const HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';
export const OWNER_PROFILE_ID = 'f61f8f8b-8d09-4575-8e83-357618e881ac';
export const ADULT_PROFILE_ID = '6b0db27d-443d-4dd2-9a21-b809384f2f13';
export const PAIRING_CODE_LIFETIME_MS = 10 * 60 * 1_000;
export const DEVICE_APPROVAL_LIFETIME_MS = 10 * 60 * 1_000;
export const MAX_ACTIVE_DEVICES_PER_USER = 5;
export interface SessionDeviceContext {
  deviceId: string;
}
export interface MemberRow {
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
export interface BetterAuthSession {
  session: { deviceId?: string; id: string; userId: string };
  user: { email: string; id: string; name: string };
}
export interface LoginMemberRow {
  household_id: string;
  internal_email: string;
  user_id: string;
}
export interface DeviceApprovalRow {
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
export function internalEmailFor(identifier: string): string {
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
