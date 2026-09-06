import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { ClosedAuthService } from './auth-service.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

async function fixture() {
  const database = openDatabase(':memory:');
  databases.push(database);
  const service = new ClosedAuthService({
    database,
    publicOrigin: 'http://localhost:8443',
    secret: 'test-only-friday-auth-secret-at-least-32-characters',
    attemptLimit: 100,
  });
  const input = {
    deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
    deviceName: 'Owner fixture',
    identifier: 'owner-fixture',
    name: 'Owner',
    password: 'fixture-only-passphrase',
  };
  const owner = await service.bootstrap(input, {}, '127.0.0.1');
  return {
    database,
    service,
    input,
    owner,
    userId: service.findAuthUserId(owner.session),
  };
}

describe('closed auth extraction invariants', () => {
  it('keeps concurrent sign-ins bound to their own approved device', async () => {
    const { service, input, owner } = await fixture();
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const requests = await Promise.all(
      ids.map((deviceId) =>
        service.login({ ...input, deviceId }, {}, deviceId),
      ),
    );
    for (const result of requests) {
      expect(result.approval).toBeDefined();
      service.approveDeviceApprovalRequest(
        owner.session,
        result.approval!.requestId,
        '127.0.0.1',
      );
    }
    const sessions = await Promise.all(
      ids.map((deviceId) =>
        service.login({ ...input, deviceId }, {}, deviceId),
      ),
    );
    for (const [index, result] of sessions.entries()) {
      expect(result.session?.deviceId).toBe(ids[index]);
      const cookie = result
        .headers!.getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      expect((await service.getSession({ cookie }))?.deviceId).toBe(ids[index]);
    }
  });
  it('rolls back the device insertion when resolving its approval fails', async () => {
    const { database, service, input, owner } = await fixture();
    const deviceId = '11111111-1111-4111-8111-111111111111';
    const requested = await service.login(
      { ...input, deviceId },
      {},
      '127.0.0.2',
    );
    const requestId = requested.approval!.requestId;
    database.exec(
      `CREATE TEMP TRIGGER fail_approval BEFORE UPDATE ON device_approval_requests WHEN NEW.status = 'approved' BEGIN SELECT RAISE(ABORT, 'fixture approval failure'); END`,
    );
    expect(() =>
      service.approveDeviceApprovalRequest(
        owner.session,
        requestId,
        '127.0.0.1',
      ),
    ).toThrow('fixture approval failure');
    expect(
      database
        .prepare('SELECT id FROM friday_devices WHERE id = ?')
        .get(deviceId),
    ).toBeUndefined();
    expect(
      database
        .prepare('SELECT status FROM device_approval_requests WHERE id = ?')
        .get(requestId),
    ).toEqual({ status: 'pending' });
    expect(
      database
        .prepare('SELECT id FROM "session" WHERE "deviceId" = ?')
        .get(deviceId),
    ).toBeUndefined();
  });
  it('releases a reserved pairing code and removes the new user after enrollment fails', async () => {
    const { database, service, input, owner, userId } = await fixture();
    const pairing = await service.createPairingCode(
      owner.session,
      userId,
      '127.0.0.1',
    );
    database.exec(
      `CREATE TEMP TRIGGER fail_enrollment BEFORE INSERT ON household_members WHEN NEW.role = 'adult' BEGIN SELECT RAISE(ABORT, 'fixture enrollment failure'); END`,
    );
    await expect(
      service.pair(
        {
          ...input,
          identifier: 'adult-fixture',
          deviceId: '11111111-1111-4111-8111-111111111111',
          code: pairing.code,
        },
        {},
        '127.0.0.2',
      ),
    ).rejects.toThrow('fixture enrollment failure');
    expect(
      database
        .prepare('SELECT used_at, used_by_user_id FROM pairing_codes')
        .get(),
    ).toEqual({ used_at: null, used_by_user_id: null });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM "user"').get(),
    ).toEqual({ count: 1 });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM friday_devices').get(),
    ).toEqual({ count: 1 });
  });
});
