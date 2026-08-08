import { afterEach, describe, expect, it } from 'vitest';

import type { TaskOperation } from '@friday/contracts';

import { buildHub } from './app.js';

const apps: Awaited<ReturnType<typeof buildHub>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
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
  });

  it('applies the same operation exactly once', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const payload = { operations: [operation()] };

    const first = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload,
    });
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
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
        payload: { operations: [taskOperation] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().acks[0].status).toBe('applied');
    }

    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
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
    const firstOperation = operation();
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
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
      payload: { operations: [staleOperation] },
    });
    const repeatedConflict = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: { operations: [staleOperation] },
    });
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
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
