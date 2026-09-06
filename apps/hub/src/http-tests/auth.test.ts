import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHub } from '../app.js';
import { bootstrap, operation, createHubFixtures } from './fixtures.js';
const { apps, temporaryDirectories } = createHubFixtures();
describe('Friday hub auth', () => {
  it('keeps public signup closed and requires an authenticated paired device', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);

    const initialState = await app.inject({
      method: 'GET',
      url: '/api/auth/state',
    });
    const unauthenticatedPull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
    });
    const publicSignup = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        email: 'intrus@friday.local',
        name: 'Intrus',
        password: 'phrase-secrete-intrus',
      },
    });
    const cookie = await bootstrap(app);
    const authenticatedState = await app.inject({
      method: 'GET',
      url: '/api/auth/state',
      headers: { cookie },
    });

    expect(initialState.json()).toEqual({
      bootstrapRequired: true,
      session: null,
    });
    expect(unauthenticatedPull.statusCode).toBe(401);
    expect(publicSignup.statusCode).toBe(404);
    expect(authenticatedState.json()).toMatchObject({
      bootstrapRequired: false,
      session: {
        deviceId: operation().deviceId,
        member: {
          identifier: 'adulte1',
          name: 'Adulte 1',
          role: 'owner',
        },
      },
    });
    expect(authenticatedState.body).not.toContain('@friday.local');
  });
  it('rejects authentication mutations from an untrusted browser origin', async () => {
    const app = await buildHub({
      databasePath: ':memory:',
      publicOrigin: 'https://friday.local',
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      headers: {
        origin: 'https://evil.invalid',
        'sec-fetch-site': 'cross-site',
      },
      payload: {
        deviceId: operation().deviceId,
        deviceName: 'Galaxy A17',
        identifier: 'adulte1',
        name: 'Adulte 1',
        password: 'phrase-secrete-friday',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'untrusted_origin' });
  });
  it('issues hardened session cookies on the HTTPS origin', async () => {
    const app = await buildHub({
      databasePath: ':memory:',
      publicOrigin: 'https://friday.local',
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      headers: { origin: 'https://friday.local' },
      payload: {
        deviceId: operation().deviceId,
        deviceName: 'Galaxy A17',
        identifier: 'adulte1',
        name: 'Adulte 1',
        password: 'phrase-secrete-friday',
      },
    });
    const cookies = Array.isArray(response.headers['set-cookie'])
      ? response.headers['set-cookie']
      : [response.headers['set-cookie'] ?? ''];
    const sessionCookie = cookies.find((cookie) =>
      cookie.includes('friday.session_token='),
    );

    expect(response.statusCode, response.body).toBe(200);
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('Secure');
    expect(sessionCookie).toContain('SameSite=Strict');
  });
  it('approves a new device from an already authorized session', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const ownerCookie = await bootstrap(app);
    const newDeviceId = '11111111-1111-4111-8111-111111111111';

    const refusedCredentials = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        deviceId: newDeviceId,
        deviceName: 'PC',
        identifier: 'adulte1',
        password: 'mauvaise-phrase-secrete',
      },
    });
    const requestsBeforeValidPassword = await app.inject({
      method: 'GET',
      url: '/api/auth/device-approval-requests',
      headers: { cookie: ownerCookie },
    });
    const requested = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        deviceId: newDeviceId,
        deviceName: 'PC',
        identifier: 'adulte1',
        password: 'phrase-secrete-friday',
      },
    });
    const requestPayload = requested.json() as {
      requestId: string;
      statusToken: string;
    };
    const duplicateRequest = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        deviceId: newDeviceId,
        deviceName: 'PC Firefox',
        identifier: 'adulte1',
        password: 'phrase-secrete-friday',
      },
    });
    const duplicatePayload = duplicateRequest.json() as {
      requestId: string;
      statusToken: string;
    };
    const requests = await app.inject({
      method: 'GET',
      url: '/api/auth/device-approval-requests',
      headers: { cookie: ownerCookie },
    });
    const approved = await app.inject({
      method: 'POST',
      url: `/api/auth/device-approval-requests/${requestPayload.requestId}/approve`,
      headers: { cookie: ownerCookie },
    });
    const approvedStatus = await app.inject({
      method: 'GET',
      url: `/api/auth/device-approval-requests/${duplicatePayload.requestId}/status?token=${duplicatePayload.statusToken}`,
    });
    const loggedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        deviceId: newDeviceId,
        deviceName: 'PC',
        identifier: 'adulte1',
        password: 'phrase-secrete-friday',
      },
    });

    expect(refusedCredentials.statusCode).toBe(401);
    expect(requestsBeforeValidPassword.json().requests).toHaveLength(0);
    expect(requested.statusCode, requested.body).toBe(202);
    expect(requested.json()).toMatchObject({ approvalRequired: true });
    expect(duplicateRequest.statusCode).toBe(202);
    expect(duplicateRequest.json().requestId).toBe(requestPayload.requestId);
    expect(requests.json().requests).toHaveLength(1);
    expect(requests.json().requests[0]).toMatchObject({
      deviceId: newDeviceId,
      deviceName: 'PC Firefox',
      status: 'pending',
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approvedStatus.json()).toEqual({ status: 'approved' });
    expect(loggedIn.statusCode, loggedIn.body).toBe(200);
    expect(loggedIn.json()).toMatchObject({ deviceId: newDeviceId });
  });
  it('rejects or expires new device approval requests without creating a session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'friday-approval-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'friday.sqlite');
    const app = await buildHub({ databasePath });
    apps.push(app);
    const ownerCookie = await bootstrap(app);
    const rejectedDeviceId = '22222222-2222-4222-8222-222222222222';
    const expiringDeviceId = '33333333-3333-4333-8333-333333333333';
    const rejectedRequest = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        deviceId: rejectedDeviceId,
        deviceName: 'Tablette',
        identifier: 'adulte1',
        password: 'phrase-secrete-friday',
      },
    });
    const rejectedPayload = rejectedRequest.json() as {
      requestId: string;
      statusToken: string;
    };
    const reject = await app.inject({
      method: 'POST',
      url: `/api/auth/device-approval-requests/${rejectedPayload.requestId}/reject`,
      headers: { cookie: ownerCookie },
    });
    const rejectedStatus = await app.inject({
      method: 'GET',
      url: `/api/auth/device-approval-requests/${rejectedPayload.requestId}/status?token=${rejectedPayload.statusToken}`,
    });
    const expiringRequest = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        deviceId: expiringDeviceId,
        deviceName: 'Ancien PC',
        identifier: 'adulte1',
        password: 'phrase-secrete-friday',
      },
    });
    const expiringPayload = expiringRequest.json() as {
      requestId: string;
      statusToken: string;
    };
    const database = new Database(databasePath);
    database
      .prepare(
        `UPDATE device_approval_requests
            SET expires_at = ?
          WHERE id = ?`,
      )
      .run('2026-08-09T12:00:00.000Z', expiringPayload.requestId);
    database.close();
    const expiredApprove = await app.inject({
      method: 'POST',
      url: `/api/auth/device-approval-requests/${expiringPayload.requestId}/approve`,
      headers: { cookie: ownerCookie },
    });
    const expiredStatus = await app.inject({
      method: 'GET',
      url: `/api/auth/device-approval-requests/${expiringPayload.requestId}/status?token=${expiringPayload.statusToken}`,
    });

    expect(rejectedRequest.statusCode).toBe(202);
    expect(reject.statusCode).toBe(200);
    expect(rejectedStatus.json()).toEqual({ status: 'rejected' });
    expect(expiringRequest.statusCode).toBe(202);
    expect(expiredApprove.statusCode).toBe(409);
    expect(expiredStatus.json()).toEqual({ status: 'expired' });
  });
  it('limits each account to five active devices', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const ownerCookie = await bootstrap(app);
    const extraDeviceIds = [
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777',
    ];
    for (const [index, deviceId] of extraDeviceIds.entries()) {
      const request = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          deviceId,
          deviceName: `Appareil ${index + 2}`,
          identifier: 'adulte1',
          password: 'phrase-secrete-friday',
        },
      });
      const requestId = request.json().requestId as string;
      const approve = await app.inject({
        method: 'POST',
        url: `/api/auth/device-approval-requests/${requestId}/approve`,
        headers: { cookie: ownerCookie },
      });
      expect(approve.statusCode, approve.body).toBe(200);
    }

    const refused = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        deviceId: '88888888-8888-4888-8888-888888888888',
        deviceName: 'Sixieme appareil',
        identifier: 'adulte1',
        password: 'phrase-secrete-friday',
      },
    });

    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'device_limit_reached' });
  });
  it('pairs the second adult once and revokes that device with all sessions', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const ownerCookie = await bootstrap(app);
    const pairingCodeResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing-code',
      headers: { cookie: ownerCookie },
    });
    expect(pairingCodeResponse.statusCode, pairingCodeResponse.body).toBe(200);
    const code = pairingCodeResponse.json().code as string;
    const secondDeviceId = '51c048d0-17c7-4c43-8706-1727d16f2bd7';
    const pairingPayload = {
      code,
      deviceId: secondDeviceId,
      deviceName: 'iPhone',
      identifier: 'adulte2',
      name: 'Adulte 2',
      password: 'autre-phrase-secrete',
    };
    const paired = await app.inject({
      method: 'POST',
      url: '/api/auth/pair',
      payload: pairingPayload,
    });
    expect(paired.statusCode, paired.body).toBe(200);
    const pairedCookies = Array.isArray(paired.headers['set-cookie'])
      ? paired.headers['set-cookie']
      : [paired.headers['set-cookie'] ?? ''];
    const adultCookie = pairedCookies
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    const replayed = await app.inject({
      method: 'POST',
      url: '/api/auth/pair',
      payload: pairingPayload,
    });
    const members = await app.inject({
      method: 'GET',
      url: '/api/auth/members',
      headers: { cookie: ownerCookie },
    });
    const revoke = await app.inject({
      method: 'POST',
      url: `/api/auth/devices/${secondDeviceId}/revoke`,
      headers: { cookie: ownerCookie },
    });
    const revokedPull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie: adultCookie },
    });

    expect(replayed.statusCode).toBe(400);
    expect(members.json().members).toHaveLength(2);
    expect(revoke.statusCode).toBe(200);
    expect(revokedPull.statusCode).toBe(401);

    const repairCodeResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing-code',
      headers: { cookie: ownerCookie },
    });
    expect(repairCodeResponse.statusCode, repairCodeResponse.body).toBe(200);
    const repairedDeviceId = '6829f2e0-219e-4b55-bad4-a3e624f81092';
    const repaired = await app.inject({
      method: 'POST',
      url: '/api/auth/pair',
      payload: {
        ...pairingPayload,
        code: repairCodeResponse.json().code,
        deviceId: repairedDeviceId,
        deviceName: 'Nouvel iPhone',
      },
    });
    const repairedCookies = Array.isArray(repaired.headers['set-cookie'])
      ? repaired.headers['set-cookie']
      : [repaired.headers['set-cookie'] ?? ''];
    const repairedCookie = repairedCookies
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    const repairedPull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie: repairedCookie },
    });

    expect(repaired.statusCode, repaired.body).toBe(200);
    expect(repaired.json()).toMatchObject({
      deviceId: repairedDeviceId,
      member: {
        identifier: 'adulte2',
        name: 'Adulte 2',
        role: 'adult',
      },
    });
    expect(repairedPull.statusCode).toBe(200);
  });
  it('forgets a revoked second adult and accepts a new identity', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const ownerCookie = await bootstrap(app);
    const pairingCode = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing-code',
      headers: { cookie: ownerCookie },
    });
    const secondDeviceId = '51c048d0-17c7-4c43-8706-1727d16f2bd7';
    const paired = await app.inject({
      method: 'POST',
      url: '/api/auth/pair',
      payload: {
        code: pairingCode.json().code,
        deviceId: secondDeviceId,
        deviceName: 'Appareil simulé',
        identifier: 'simulation',
        name: 'Profil simulé',
        password: 'phrase-secrete-simulee',
      },
    });
    expect(paired.statusCode, paired.body).toBe(200);

    const refusedWhileActive = await app.inject({
      method: 'DELETE',
      url: '/api/auth/adult',
      headers: { cookie: ownerCookie },
    });
    expect(refusedWhileActive.statusCode).toBe(409);

    const revoked = await app.inject({
      method: 'POST',
      url: `/api/auth/devices/${secondDeviceId}/revoke`,
      headers: { cookie: ownerCookie },
    });
    expect(revoked.statusCode).toBe(200);

    const forgotten = await app.inject({
      method: 'DELETE',
      url: '/api/auth/adult',
      headers: { cookie: ownerCookie },
    });
    expect(forgotten.statusCode, forgotten.body).toBe(200);

    const membersAfterForget = await app.inject({
      method: 'GET',
      url: '/api/auth/members',
      headers: { cookie: ownerCookie },
    });
    expect(membersAfterForget.json().members).toHaveLength(1);

    const replacementCode = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing-code',
      headers: { cookie: ownerCookie },
    });
    const replacement = await app.inject({
      method: 'POST',
      url: '/api/auth/pair',
      payload: {
        code: replacementCode.json().code,
        deviceId: '6829f2e0-219e-4b55-bad4-a3e624f81092',
        deviceName: 'iPhone Ana',
        identifier: 'ananas',
        name: 'Ana',
        password: 'nouvelle-phrase-secrete',
      },
    });
    expect(replacement.statusCode, replacement.body).toBe(200);
    expect(replacement.json()).toMatchObject({
      member: {
        identifier: 'ananas',
        name: 'Ana',
        role: 'adult',
      },
    });
  });
});
