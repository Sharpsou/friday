import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fridayDb } from '../db/friday-db.js';
import {
  bootstrapHousehold,
  getCurrentLocalProfileId,
  getLocalDeviceId,
  login,
  loadCachedAuthSession,
  loadLocalAuthState,
  loadAuthState,
  logout,
} from './auth-client.js';

const SESSION = {
  deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
  deviceName: 'Galaxy A17',
  member: {
    identifier: 'adulte1',
    name: 'Adulte 1',
    profileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
    role: 'owner' as const,
  },
};

beforeEach(async () => {
  await fridayDb.open();
  await fridayDb.settings.put({ key: 'deviceId', value: SESSION.deviceId });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await fridayDb.delete();
});

describe('closed auth client', () => {
  it('stores the paired profile beside the stable local device identity', async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(JSON.stringify(SESSION), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const session = await bootstrapHousehold({
      deviceName: 'Galaxy A17',
      identifier: 'adulte1',
      name: 'Adulte 1',
      password: 'phrase-secrete-friday',
    });

    expect(session).toEqual(SESSION);
    expect(await getLocalDeviceId()).toBe(SESSION.deviceId);
    expect(await getCurrentLocalProfileId()).toBe(SESSION.member.profileId);
    expect((await fridayDb.settings.get('deviceId'))?.value).toBe(
      SESSION.deviceId,
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      deviceId: SESSION.deviceId,
    });
  });

  it('keeps a previously paired profile available when the hub is offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(SESSION), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
      ),
    );
    await bootstrapHousehold({
      deviceName: 'Galaxy A17',
      identifier: 'adulte1',
      name: 'Adulte 1',
      password: 'phrase-secrete-friday',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );

    const state = await loadAuthState();

    expect(state).toEqual({
      bootstrapRequired: false,
      connection: 'offline',
      session: SESSION,
    });
  });

  it('hydrates an enrolled device from IndexedDB without waiting for the hub', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(SESSION), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
      ),
    );
    await bootstrapHousehold({
      deviceName: 'Galaxy A17',
      identifier: 'adulte1',
      name: 'Adulte 1',
      password: 'phrase-secrete-friday',
    });
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadLocalAuthState()).resolves.toEqual({
      bootstrapRequired: false,
      connection: 'offline',
      session: SESSION,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens the cached household when cellular connectivity cannot reach the private hub', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(SESSION), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
      ),
    );
    await bootstrapHousehold({
      deviceName: 'Galaxy A17',
      identifier: 'adulte1',
      name: 'Adulte 1',
      password: 'phrase-secrete-friday',
    });
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const statePromise = loadAuthState();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(statePromise).resolves.toEqual({
      bootstrapRequired: false,
      connection: 'offline',
      session: SESSION,
    });
    vi.useRealTimers();
  });

  it('keeps a new device approval request out of the local session cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              approvalRequired: true,
              expiresAt: '2026-08-09T12:10:00.000Z',
              requestId: '11111111-1111-4111-8111-111111111111',
              statusToken:
                '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            }),
            {
              headers: { 'content-type': 'application/json' },
              status: 202,
            },
          ),
      ),
    );

    const result = await login({
      deviceName: 'PC',
      identifier: 'adulte1',
      password: 'phrase-secrete-friday',
    });

    expect(result).toMatchObject({ approvalRequired: true });
    expect(await loadCachedAuthSession()).toBeNull();
  });

  it('realigns the local device identity with the authenticated session', async () => {
    await fridayDb.settings.put({
      key: 'deviceId',
      value: '0ad8a9f1-927c-4e8d-b015-ec6db9206337',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ bootstrapRequired: false, session: SESSION }),
            {
              headers: { 'content-type': 'application/json' },
              status: 200,
            },
          ),
      ),
    );

    await loadAuthState();

    expect(await getLocalDeviceId()).toBe(SESSION.deviceId);
  });

  it('keeps an offline logout closed until the server session can be invalidated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(SESSION), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
      ),
    );
    await bootstrapHousehold({
      deviceName: 'Galaxy A17',
      identifier: 'adulte1',
      name: 'Adulte 1',
      password: 'phrase-secrete-friday',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );

    await logout();
    const offlineState = await loadAuthState();

    expect(await loadCachedAuthSession()).toBeNull();
    expect(offlineState).toEqual({
      bootstrapRequired: false,
      connection: 'offline',
      session: null,
    });
    expect((await fridayDb.settings.get('authLogoutPending'))?.value).toBe(
      true,
    );
  });
});
