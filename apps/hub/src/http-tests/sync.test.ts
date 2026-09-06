import type { TaskOperation } from '@friday/contracts';
import { describe, expect, it } from 'vitest';
import { buildHub } from '../app.js';
import { bootstrap, operation, createHubFixtures } from './fixtures.js';
const { apps } = createHubFixtures();
describe('Friday hub sync', () => {
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
