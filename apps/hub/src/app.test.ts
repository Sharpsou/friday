import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  BudgetEntryOperation,
  GroceryItemOperation,
  TaskOperation,
} from '@friday/contracts';

import { buildHub } from './app.js';
import { SimulatedRobotController } from './robot/robot-controller.js';

const apps: Awaited<ReturnType<typeof buildHub>>[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function operation(): TaskOperation {
  const now = '2026-08-08T12:00:00.000Z';
  return {
    protocolVersion: 1,
    operationId: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
    deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
    profileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
    entityType: 'task',
    entityId: 'cbd5cf4f-d5e2-40d2-a8b4-4e33b66bf2fb',
    operation: 'upsert',
    baseRevision: 0,
    clientCreatedAt: now,
    payload: {
      id: 'cbd5cf4f-d5e2-40d2-a8b4-4e33b66bf2fb',
      householdId: '1030b4f6-1e0f-48fa-adab-865750ce597d',
      revision: 0,
      title: 'Sortir les poubelles',
      dueDate: null,
      dueTime: null,
      durationMinutes: null,
      assigneeProfileId: null,
      recurrence: null,
      note: null,
      status: 'todo',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      createdByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
      updatedByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
      deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
      schemaVersion: 1,
    },
  };
}

function groceryOperation(): GroceryItemOperation {
  const now = '2026-08-09T12:00:00.000Z';
  return {
    protocolVersion: 1,
    operationId: '57eab143-78ff-4631-858c-5a2f92b01aa8',
    deviceId: operation().deviceId,
    profileId: operation().profileId,
    entityType: 'grocery_item',
    entityId: 'da166bcc-38c4-4a17-859f-7491e1b2312f',
    operation: 'upsert',
    baseRevision: 0,
    clientCreatedAt: now,
    payload: {
      id: 'da166bcc-38c4-4a17-859f-7491e1b2312f',
      householdId: operation().payload.householdId,
      revision: 0,
      label: 'Lait',
      quantityText: '2 bouteilles',
      manualStoreFamilyId: null,
      manualAisleId: null,
      checkedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      createdByProfileId: operation().profileId,
      updatedByProfileId: operation().profileId,
      deviceId: operation().deviceId,
      schemaVersion: 1,
    },
  };
}

function budgetOperation(): BudgetEntryOperation {
  const now = '2026-08-09T12:00:00.000Z';
  const id = '16cd13bc-3a63-4b56-8e95-f39dcb7a993d';
  return {
    protocolVersion: 1,
    operationId: 'e31369ef-b9d5-44fa-8792-398cb7e10a3c',
    deviceId: operation().deviceId,
    profileId: operation().profileId,
    entityType: 'budget_entry',
    entityId: id,
    operation: 'upsert',
    baseRevision: 0,
    clientCreatedAt: now,
    payload: {
      id,
      householdId: operation().payload.householdId,
      revision: 0,
      kind: 'expense',
      category: 'groceries',
      incomeType: null,
      transferDirection: null,
      label: 'Marché fictif',
      amountCents: 4250,
      occurredOn: '2026-08-09',
      ownerProfileId: null,
      envelopeId: null,
      plannedExpenseId: null,
      recurringTemplateId: null,
      correctionOfId: null,
      source: 'manual',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      createdByProfileId: operation().profileId,
      updatedByProfileId: operation().profileId,
      deviceId: operation().deviceId,
      schemaVersion: 1,
    },
  };
}

async function bootstrap(
  app: Awaited<ReturnType<typeof buildHub>>,
  deviceId = operation().deviceId,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/bootstrap',
    payload: {
      deviceId,
      deviceName: 'Galaxy A17',
      identifier: 'adulte1',
      name: 'Adulte 1',
      password: 'phrase-secrete-friday',
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('Friday hub', () => {
  it('reports health without requiring Ollama', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      database: 'ok',
      ollama: 'not-required',
    });
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['permissions-policy']).toBe(
      'camera=(), geolocation=(), microphone=()',
    );
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('keeps robot control authenticated, armed, expiring and stoppable', async () => {
    const app = await buildHub({
      databasePath: ':memory:',
      robotController: new SimulatedRobotController(),
    });
    apps.push(app);
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/robot/state',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const cookie = await bootstrap(app);
    const initial = await app.inject({
      method: 'GET',
      url: '/api/robot/state',
      headers: { cookie },
    });
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json()).toMatchObject({
      available: true,
      armed: false,
      mode: 'simulated',
    });

    const armed = await app.inject({
      method: 'POST',
      url: '/api/robot/arm',
      headers: { cookie },
      payload: { durationMs: 2_000 },
    });
    expect(armed.statusCode, armed.body).toBe(200);
    expect(armed.json().state.armed).toBe(true);

    const now = Date.now();
    const drive = await app.inject({
      method: 'POST',
      url: '/api/robot/drive',
      headers: { cookie },
      payload: {
        commandId: crypto.randomUUID(),
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 300).toISOString(),
        direction: 'forward',
        intensity: 0.2,
        maxDurationMs: 300,
      },
    });
    expect(drive.statusCode, drive.body).toBe(200);
    expect(drive.json().state.moving).toBe(true);

    const stopped = await app.inject({
      method: 'POST',
      url: '/api/robot/stop',
      headers: { cookie },
    });
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json().state).toMatchObject({
      armed: false,
      moving: false,
    });
  });

  it('rejects stale robot commands and cross-site mutation attempts', async () => {
    const app = await buildHub({
      databasePath: ':memory:',
      publicOrigin: 'https://friday.test',
      robotController: new SimulatedRobotController(),
    });
    apps.push(app);
    const cookie = await bootstrap(app);
    const stale = await app.inject({
      method: 'POST',
      url: '/api/robot/drive',
      headers: { cookie },
      payload: {
        commandId: crypto.randomUUID(),
        issuedAt: '2026-08-23T00:00:00.000Z',
        expiresAt: '2026-08-23T00:00:00.300Z',
        direction: 'forward',
        intensity: 0.2,
        maxDurationMs: 300,
      },
    });
    expect(stale.statusCode).toBe(400);

    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/robot/stop',
      headers: {
        cookie,
        origin: 'https://hostile.example',
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(crossSite.statusCode).toBe(403);
  });

  it('transcribes an authenticated grocery photo without storing or classifying it', async () => {
    const transcribe = vi.fn().mockResolvedValue({
      items: [
        {
          box: { x: 580, y: 30, width: 250, height: 40 },
          label: 'Fleur de sel',
          quantityText: 'x2',
          sourceText: 'fleur de sel x2',
        },
      ],
    });
    const app = await buildHub({
      databasePath: ':memory:',
      photoTranscriptionEngine: { transcribe },
    });
    apps.push(app);
    const payload = {
      imageBase64: 'YWJjZGVmZ2hpamtsbW5vcA==',
      mediaType: 'image/jpeg',
    };

    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/api/groceries/photo-transcription',
      payload,
    });
    const cookie = await bootstrap(app);
    const authenticated = await app.inject({
      method: 'POST',
      url: '/api/groceries/photo-transcription',
      headers: { cookie },
      payload,
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(authenticated.statusCode, authenticated.body).toBe(200);
    expect(authenticated.json()).toEqual({
      items: [
        {
          box: { x: 580, y: 30, width: 250, height: 40 },
          label: 'Fleur de sel',
          quantityText: 'x2',
          sourceText: 'fleur de sel x2',
        },
      ],
    });
    expect(transcribe).toHaveBeenCalledWith(
      payload.imageBase64,
      payload.mediaType,
      expect.any(AbortSignal),
    );
  });

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

  it('rejects a cross-site task mutation even with a valid session', async () => {
    const app = await buildHub({
      databasePath: ':memory:',
      publicOrigin: 'https://friday.local',
    });
    apps.push(app);
    const cookie = await bootstrap(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: {
        cookie,
        origin: 'https://evil.invalid',
        'sec-fetch-site': 'cross-site',
      },
      payload: { operations: [operation()] },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'untrusted_origin' });
  });

  it('applies the same operation exactly once', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const cookie = await bootstrap(app);
    const payload = { operations: [operation()] };

    const first = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload,
    });
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie },
    });

    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(pull.json()).toMatchObject({
      cursor: 1,
      changes: [{ entityId: operation().entityId }],
    });
    expect(pull.json().changes).toHaveLength(1);
  });

  it('shares a grocery item through the authenticated sync log', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const cookie = await bootstrap(app);
    const grocery = groceryOperation();

    const push = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [grocery] },
    });
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie },
    });

    expect(push.statusCode, push.body).toBe(200);
    expect(push.json().acks[0]).toMatchObject({
      entityId: grocery.entityId,
      status: 'applied',
      serverRevision: 1,
    });
    expect(pull.json().changes).toEqual([
      expect.objectContaining({
        entityType: 'grocery_item',
        entityId: grocery.entityId,
        payload: expect.objectContaining({
          label: 'Lait',
          quantityText: '2 bouteilles',
          revision: 1,
        }),
      }),
    ]);
  });

  it('applies a shared budget movement idempotently', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const cookie = await bootstrap(app);
    const budget = budgetOperation();

    const first = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [budget] },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [budget] },
    });
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie },
    });

    expect(first.statusCode, first.body).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(pull.json().changes).toEqual([
      expect.objectContaining({
        entityType: 'budget_entry',
        entityId: budget.entityId,
        payload: expect.objectContaining({ amountCents: 4250, revision: 1 }),
      }),
    ]);
  });

  it('keeps one logical budget entry when two offline operations race on its deterministic id', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const cookie = await bootstrap(app);
    const firstOperation = budgetOperation();
    const competingOperation = {
      ...budgetOperation(),
      operationId: '83034bc5-c13d-4d4b-917b-c70ac75bc665',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [firstOperation, competingOperation] },
    });
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().acks).toEqual([
      expect.objectContaining({ status: 'applied', serverRevision: 1 }),
      expect.objectContaining({ status: 'applied', serverRevision: 1 }),
    ]);
    expect(pull.json().changes).toHaveLength(1);

    const divergent = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: {
        operations: [
          {
            ...budgetOperation(),
            operationId: '0235d407-66dd-4c7e-b9c5-08014a5500ea',
            payload: { ...budgetOperation().payload, amountCents: 4300 },
          },
        ],
      },
    });
    expect(divergent.json().acks).toEqual([
      expect.objectContaining({ status: 'conflict', serverRevision: 1 }),
    ]);
  });

  it('runs a correctable grocery classification job without mutating the list', async () => {
    const app = await buildHub({
      databasePath: ':memory:',
      classificationEngine: {
        async classify(labels) {
          return labels.map(() => ({
            storeFamilyId: 'pet-store',
            aisleId: 'food',
            confidence: 0.81,
          }));
        },
      },
    });
    apps.push(app);
    const cookie = await bootstrap(app);
    const grocery = {
      ...groceryOperation(),
      payload: {
        ...groceryOperation().payload,
        label: 'Repas Nouchka spécial',
      },
    };
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [grocery] },
    });

    const started = await app.inject({
      method: 'POST',
      url: '/api/groceries/classification-proposals',
      headers: { cookie },
    });
    expect(started.statusCode, started.body).toBe(200);
    const jobId = started.json().id as string;
    let completed = started;
    await vi.waitFor(async () => {
      completed = await app.inject({
        method: 'GET',
        url: `/api/groceries/classification-proposals/${jobId}`,
        headers: { cookie },
      });
      expect(completed.json().status).toBe('completed');
    });

    const proposal = completed.json().proposal[0] as {
      expectedClassificationRevision: number | null;
      itemId: string;
    };
    const applied = await app.inject({
      method: 'POST',
      url: '/api/groceries/classifications/apply',
      headers: { cookie },
      payload: {
        jobId,
        classifications: [
          {
            itemId: proposal.itemId,
            expectedClassificationRevision:
              proposal.expectedClassificationRevision,
            storeFamilyId: 'supermarket',
            aisleId: 'pets',
          },
        ],
      },
    });
    const classificationPull = await app.inject({
      method: 'GET',
      url: '/api/groceries/classifications?after=0',
      headers: { cookie },
    });
    const groceryPull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie },
    });

    expect(applied.statusCode, applied.body).toBe(200);
    expect(classificationPull.json().changes[0].classification).toMatchObject({
      itemId: grocery.entityId,
      aisleId: 'pets',
      source: 'manual',
    });
    expect(groceryPull.json().changes).toHaveLength(1);
  });

  it('converges a finish and reopen cycle without duplicate changes', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const cookie = await bootstrap(app);
    const created = operation();
    const finished: TaskOperation = {
      ...created,
      operationId: '5a72afdd-bd91-4c53-a2b1-af342922896a',
      baseRevision: 1,
      payload: {
        ...created.payload,
        revision: 1,
        status: 'done',
        updatedAt: '2026-08-08T12:01:00.000Z',
      },
    };
    const reopened: TaskOperation = {
      ...finished,
      operationId: 'cedb1468-16fe-4b58-b634-7a5c48d53bc9',
      baseRevision: 2,
      payload: {
        ...finished.payload,
        revision: 2,
        status: 'todo',
        updatedAt: '2026-08-08T12:02:00.000Z',
      },
    };

    for (const taskOperation of [
      created,
      finished,
      finished,
      reopened,
      reopened,
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie },
        payload: { operations: [taskOperation] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().acks[0].status).toBe('applied');
    }

    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie },
    });

    expect(pull.json().changes).toHaveLength(3);
    expect(
      pull
        .json()
        .changes.map(
          (change: { payload: { status: string } }) => change.payload.status,
        ),
    ).toEqual(['todo', 'done', 'todo']);
  });

  it('returns a stable conflict for a stale base revision', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const cookie = await bootstrap(app);
    const firstOperation = operation();
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [firstOperation] },
    });

    const staleOperation: TaskOperation = {
      ...firstOperation,
      operationId: 'be6ad7fe-c02d-4c35-91d6-da552902ca7d',
      payload: { ...firstOperation.payload, title: 'Texte concurrent' },
    };
    const firstConflict = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [staleOperation] },
    });
    const repeatedConflict = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [staleOperation] },
    });
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie },
    });

    expect(firstConflict.json()).toEqual(repeatedConflict.json());
    expect(firstConflict.json().acks[0]).toMatchObject({
      status: 'conflict',
      serverRevision: 1,
      conflictReason: 'revision_mismatch',
    });
    expect(pull.json().changes).toHaveLength(1);
  });
});
