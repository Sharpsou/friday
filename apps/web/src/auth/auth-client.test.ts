import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fridayDb } from '../db/friday-db.js';
import {
  bootstrapHousehold,
  getCurrentLocalProfileId,
  getLocalDeviceId,
  loadCachedAuthSession,
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
