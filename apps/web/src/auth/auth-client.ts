import {
  AuthDevicesResponseSchema,
  AuthMembersResponseSchema,
  AuthSessionSchema,
  AuthStateResponseSchema,
  PairingCodeResponseSchema,
  type AuthBootstrapRequest,
  type AuthDevice,
  type AuthLoginRequest,
  type AuthMember,
  type AuthPairRequest,
  type AuthSession,
} from '@friday/contracts';

import { CURRENT_PROFILE_ID } from '../task-assignee.js';
import { fridayDb } from '../db/friday-db.js';

const AUTH_SESSION_CACHE_KEY = 'authSessionCache';
const AUTH_LOGOUT_PENDING_KEY = 'authLogoutPending';
const CURRENT_PROFILE_KEY = 'currentProfileId';
const DEVICE_ID_KEY = 'deviceId';

export interface LocalAuthState {
  bootstrapRequired: boolean;
  connection: 'online' | 'offline';
  session: AuthSession | null;
}

async function parseResponse<T>(
  response: Response,
  parser: { parse(value: unknown): T },
): Promise<T> {
  const payload = (await response.json()) as { message?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof payload.message === 'string'
        ? payload.message
        : `Authentification refusée (${response.status.toString()}).`,
    );
  }
  return parser.parse(payload);
}

async function storeSession(session: AuthSession): Promise<void> {
  await fridayDb.transaction('rw', fridayDb.settings, async () => {
    await fridayDb.settings.bulkPut([
      { key: AUTH_SESSION_CACHE_KEY, value: session },
      { key: CURRENT_PROFILE_KEY, value: session.member.profileId },
      { key: DEVICE_ID_KEY, value: session.deviceId },
    ]);
  });
}

export async function getLocalDeviceId(): Promise<string> {
  const stored = (await fridayDb.settings.get(DEVICE_ID_KEY))?.value;
  if (typeof stored === 'string') return stored;
  const deviceId = crypto.randomUUID();
  await fridayDb.settings.put({ key: DEVICE_ID_KEY, value: deviceId });
  return deviceId;
}

export async function getCurrentLocalProfileId(): Promise<string> {
  const stored = (await fridayDb.settings.get(CURRENT_PROFILE_KEY))?.value;
  return typeof stored === 'string' ? stored : CURRENT_PROFILE_ID;
}

export async function loadCachedAuthSession(): Promise<AuthSession | null> {
  const stored = (await fridayDb.settings.get(AUTH_SESSION_CACHE_KEY))?.value;
  const parsed = AuthSessionSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

export async function loadAuthState(): Promise<LocalAuthState> {
  const [cachedSession, logoutPendingRow] = await Promise.all([
    loadCachedAuthSession(),
    fridayDb.settings.get(AUTH_LOGOUT_PENDING_KEY),
  ]);
  const logoutPending = logoutPendingRow?.value === true;
  try {
    if (logoutPending) {
      const signOutResponse = await fetch('/api/auth/sign-out', {
        method: 'POST',
      });
      if (!signOutResponse.ok) throw new Error('Déconnexion en attente.');
      await fridayDb.settings.delete(AUTH_LOGOUT_PENDING_KEY);
    }
    const response = await fetch('/api/auth/state', {
      headers: { accept: 'application/json' },
    });
    const state = await parseResponse(response, AuthStateResponseSchema);
    if (state.session) await storeSession(state.session);
    return {
      bootstrapRequired: state.bootstrapRequired,
      connection: 'online',
      session: state.session,
    };
  } catch {
    return {
      bootstrapRequired: false,
      connection: 'offline',
      session: logoutPending ? null : cachedSession,
    };
  }
}

async function submitSession(
  path: '/api/auth/bootstrap' | '/api/auth/login' | '/api/auth/pair',
  body: AuthBootstrapRequest | AuthLoginRequest | AuthPairRequest,
): Promise<AuthSession> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const session = await parseResponse(response, AuthSessionSchema);
  await storeSession(session);
  return session;
}

export async function bootstrapHousehold(
  input: Omit<AuthBootstrapRequest, 'deviceId'>,
): Promise<AuthSession> {
  return submitSession('/api/auth/bootstrap', {
    ...input,
    deviceId: await getLocalDeviceId(),
  });
}

export async function login(
  input: Omit<AuthLoginRequest, 'deviceId'>,
): Promise<AuthSession> {
  return submitSession('/api/auth/login', {
    ...input,
    deviceId: await getLocalDeviceId(),
  });
}

export async function pairAdult(
  input: Omit<AuthPairRequest, 'deviceId'>,
): Promise<AuthSession> {
  return submitSession('/api/auth/pair', {
    ...input,
    deviceId: await getLocalDeviceId(),
  });
}

export async function createPairingCode(): Promise<{
  code: string;
  expiresAt: string;
}> {
  const response = await fetch('/api/auth/pairing-code', { method: 'POST' });
  return parseResponse(response, PairingCodeResponseSchema);
}

export async function listAuthMembers(): Promise<AuthMember[]> {
  const response = await fetch('/api/auth/members');
  return (await parseResponse(response, AuthMembersResponseSchema)).members;
}

export async function listAuthDevices(): Promise<AuthDevice[]> {
  const response = await fetch('/api/auth/devices');
  return (await parseResponse(response, AuthDevicesResponseSchema)).devices;
}

export async function revokeAuthDevice(deviceId: string): Promise<void> {
  const response = await fetch(`/api/auth/devices/${deviceId}/revoke`, {
    method: 'POST',
  });
  if (!response.ok) {
    const payload = (await response.json()) as { message?: unknown };
    throw new Error(
      typeof payload.message === 'string'
        ? payload.message
        : 'Révocation impossible.',
    );
  }
}

export async function forgetAdult(): Promise<void> {
  const response = await fetch('/api/auth/adult', { method: 'DELETE' });
  if (!response.ok) {
    const payload = (await response.json()) as { message?: unknown };
    throw new Error(
      typeof payload.message === 'string'
        ? payload.message
        : 'Suppression du second adulte impossible.',
    );
  }
}

export async function logout(): Promise<void> {
  await fridayDb.transaction('rw', fridayDb.settings, async () => {
    await fridayDb.settings.put({
      key: AUTH_LOGOUT_PENDING_KEY,
      value: true,
    });
    await fridayDb.settings.bulkDelete([
      AUTH_SESSION_CACHE_KEY,
      CURRENT_PROFILE_KEY,
    ]);
  });
  try {
    const response = await fetch('/api/auth/sign-out', { method: 'POST' });
    if (response.ok) await fridayDb.settings.delete(AUTH_LOGOUT_PENDING_KEY);
  } catch {
    // The pending marker blocks local access and retries server sign-out online.
  }
}
