import { describe, expect, it } from 'vitest';

import { PushRequestSchema, TaskRecordSchema } from './index.js';

const legacyTask = {
  id: 'cbd5cf4f-d5e2-40d2-a8b4-4e33b66bf2fb',
  householdId: '1030b4f6-1e0f-48fa-adab-865750ce597d',
  revision: 0,
  title: 'Sortir les poubelles',
  dueDate: null,
  assigneeProfileId: null,
  recurrence: null,
  note: null,
  status: 'todo',
  createdAt: '2026-08-08T12:00:00.000Z',
  updatedAt: '2026-08-08T12:00:00.000Z',
  deletedAt: null,
  createdByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
  updatedByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
  deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
  schemaVersion: 1,
} as const;

describe('PushRequestSchema', () => {
  it('rejects an operation whose payload contains an invalid title', () => {
    const result = PushRequestSchema.safeParse({
      operations: [
        {
          protocolVersion: 1,
          operationId: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
          deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
          profileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
          entityType: 'task',
          entityId: 'cbd5cf4f-d5e2-40d2-a8b4-4e33b66bf2fb',
          operation: 'upsert',
          baseRevision: 0,
          clientCreatedAt: '2026-08-08T12:00:00.000Z',
          payload: {
            id: 'cbd5cf4f-d5e2-40d2-a8b4-4e33b66bf2fb',
            householdId: '1030b4f6-1e0f-48fa-adab-865750ce597d',
            revision: 0,
            title: '   ',
            dueDate: null,
            assigneeProfileId: null,
            recurrence: null,
            note: null,
            status: 'todo',
            createdAt: '2026-08-08T12:00:00.000Z',
            updatedAt: '2026-08-08T12:00:00.000Z',
            deletedAt: null,
            createdByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
            updatedByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
            deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
            schemaVersion: 1,
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe('TaskRecordSchema schedule', () => {
  it('keeps legacy tasks compatible by defaulting new schedule fields', () => {
    const task = TaskRecordSchema.parse(legacyTask);

    expect(task.dueTime).toBeNull();
    expect(task.durationMinutes).toBeNull();
  });

  it('accepts a date alone or a timed appointment with a duration', () => {
    expect(
      TaskRecordSchema.parse({ ...legacyTask, dueDate: '2026-08-15' }),
    ).toMatchObject({
      dueDate: '2026-08-15',
      dueTime: null,
      durationMinutes: null,
    });
    expect(
      TaskRecordSchema.parse({
        ...legacyTask,
        dueDate: '2026-08-15',
        dueTime: '14:30',
        durationMinutes: 45,
      }),
    ).toMatchObject({
      dueDate: '2026-08-15',
      dueTime: '14:30',
      durationMinutes: 45,
    });
  });

  it('rejects a time without a date and a duration without a time', () => {
    expect(
      TaskRecordSchema.safeParse({ ...legacyTask, dueTime: '14:30' }).success,
    ).toBe(false);
    expect(
      TaskRecordSchema.safeParse({
        ...legacyTask,
        dueDate: '2026-08-15',
        durationMinutes: 45,
      }).success,
    ).toBe(false);
  });
});
