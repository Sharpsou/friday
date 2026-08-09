import { describe, expect, it } from 'vitest';

import {
  AuthBootstrapRequestSchema,
  AuthPairRequestSchema,
  GROCERY_TAXONOMY,
  GroceryClassificationChoiceSchema,
  GroceryClassificationJobSchema,
  GroceryItemRecordSchema,
  PushRequestSchema,
  TaskRecordSchema,
} from './index.js';

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

  it('accepts a grocery item with an optional free-form quantity', () => {
    const groceryItem = GroceryItemRecordSchema.parse({
      id: 'da166bcc-38c4-4a17-859f-7491e1b2312f',
      householdId: '1030b4f6-1e0f-48fa-adab-865750ce597d',
      revision: 0,
      label: '  Lait  ',
      quantityText: '2 bouteilles',
      checkedAt: null,
      createdAt: '2026-08-09T12:00:00.000Z',
      updatedAt: '2026-08-09T12:00:00.000Z',
      deletedAt: null,
      createdByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
      updatedByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
      deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
      schemaVersion: 1,
    });
    const result = PushRequestSchema.safeParse({
      operations: [
        {
          protocolVersion: 1,
          operationId: '57eab143-78ff-4631-858c-5a2f92b01aa8',
          deviceId: groceryItem.deviceId,
          profileId: groceryItem.updatedByProfileId,
          entityType: 'grocery_item',
          entityId: groceryItem.id,
          operation: 'upsert',
          baseRevision: 0,
          clientCreatedAt: groceryItem.createdAt,
          payload: groceryItem,
        },
      ],
    });

    expect(groceryItem.label).toBe('Lait');
    expect(result.success).toBe(true);
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

describe('closed authentication contracts', () => {
  const bootstrap = {
    deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
    deviceName: 'Galaxy A17',
    identifier: 'ADULTE-1',
    name: 'Adulte',
    password: 'phrase-secrete-friday',
  };

  it('normalizes the Friday identifier and requires a long phrase secret', () => {
    expect(AuthBootstrapRequestSchema.parse(bootstrap).identifier).toBe(
      'adulte-1',
    );
    expect(
      AuthBootstrapRequestSchema.safeParse({
        ...bootstrap,
        identifier: 'adulte 1',
      }).success,
    ).toBe(false);
    expect(
      AuthBootstrapRequestSchema.safeParse({ ...bootstrap, password: 'court' })
        .success,
    ).toBe(false);
  });

  it('accepts only an eight-digit pairing code', () => {
    expect(
      AuthPairRequestSchema.safeParse({ ...bootstrap, code: '12345678' })
        .success,
    ).toBe(true);
    expect(
      AuthPairRequestSchema.safeParse({ ...bootstrap, code: '1234' }).success,
    ).toBe(false);
  });
});

describe('grocery classification contracts', () => {
  it('keeps taxonomy families, aisle pairs and generic order unambiguous', () => {
    const familyIds = GROCERY_TAXONOMY.map((family) => family.id);
    const pairIds = GROCERY_TAXONOMY.flatMap((family) =>
      family.aisles.map(([aisleId]) => `${family.id}:${aisleId}`),
    );

    expect(new Set(familyIds).size).toBe(familyIds.length);
    expect(new Set(pairIds).size).toBe(pairIds.length);
    expect(GROCERY_TAXONOMY[0]?.id).toBe('supermarket');
    expect(GROCERY_TAXONOMY[0]?.aisles).toHaveLength(25);
    expect(GROCERY_TAXONOMY.at(-1)?.id).toBe('other');
  });

  it('rejects an aisle attached to the wrong store family', () => {
    expect(
      GroceryClassificationChoiceSchema.safeParse({
        storeFamilyId: 'pet-store',
        aisleId: 'produce',
      }).success,
    ).toBe(false);
    expect(
      GroceryClassificationChoiceSchema.safeParse({
        storeFamilyId: 'supermarket',
        aisleId: 'produce',
      }).success,
    ).toBe(true);
  });

  it('requires a complete persistent job representation', () => {
    expect(
      GroceryClassificationJobSchema.safeParse({
        id: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        taxonomyId: 'retail-fr-v1',
        status: 'running',
        progress: { completed: 2, total: 5 },
        proposal: null,
        error: null,
        createdAt: '2026-08-09T12:00:00.000Z',
        updatedAt: '2026-08-09T12:00:01.000Z',
        expiresAt: null,
      }).success,
    ).toBe(true);
  });
});
