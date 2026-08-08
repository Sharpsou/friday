import { describe, expect, it } from 'vitest';

import { PushRequestSchema } from './index.js';

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
