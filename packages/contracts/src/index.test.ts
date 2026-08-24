import { describe, expect, it } from 'vitest';

import {
  AuthBootstrapRequestSchema,
  AuthPairRequestSchema,
  AssistantExaUsageSchema,
  AssistantResearchDiagnosticsResponseSchema,
  AssistantRunSchema,
  AssistantSendMessageRequestSchema,
  BudgetEntryRecordSchema,
  BudgetEnvelopeRecordSchema,
  BudgetRecurringTemplateRecordSchema,
  GROCERY_TAXONOMY,
  GroceryClassificationChoiceSchema,
  GroceryClassificationJobSchema,
  GroceryItemRecordSchema,
  GroceryPhotoTranscriptionRequestSchema,
  GroceryPhotoTranscriptionResponseSchema,
  PushRequestSchema,
  TaskRecordSchema,
  WatchUpdateRequestSchema,
} from './index.js';

describe('Watch contracts', () => {
  it('keeps a schedule update partial and requires a weekday for weekly runs', () => {
    expect(
      WatchUpdateRequestSchema.parse({
        cadence: 'weekly',
        localTime: '08:15',
        weekday: 3,
      }),
    ).toEqual({ cadence: 'weekly', localTime: '08:15', weekday: 3 });
    expect(
      WatchUpdateRequestSchema.safeParse({ cadence: 'weekly' }).success,
    ).toBe(false);
    expect(WatchUpdateRequestSchema.parse({ localTime: '09:00' })).toEqual({
      localTime: '09:00',
    });
  });
});

describe('Assistant contracts', () => {
  it('exposes separate local Exa usage and private research diagnostics', () => {
    expect(
      AssistantExaUsageSchema.parse({
        month: '2026-08',
        calls: 3,
        successes: 2,
        emptyResults: 0,
        rateLimits: 1,
        failures: 0,
        status: 'rate_limited',
        lastAttemptAt: '2026-08-13T00:00:00.000Z',
        message: 'Limite gratuite Exa atteinte.',
        cooldownUntil: '2026-08-13T01:00:00.000Z',
      }).calls,
    ).toBe(3);
    expect(
      AssistantResearchDiagnosticsResponseSchema.safeParse({
        diagnostics: [
          {
            runId: '41bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
            provider: 'exa',
            status: 'success',
            calls: 1,
            results: 4,
            durationMs: 812,
            message: 'Exa a fourni des sources.',
            sourceIds: ['S1', 'S2'],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('bounds offline submissions and exposes a persistent queue state', () => {
    expect(
      AssistantSendMessageRequestSchema.parse({
        clientRequestId: '41bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        content: 'Utilise le modèle par défaut',
        mode: 'local',
      }).model,
    ).toBe('qwen3.5');
    expect(
      AssistantSendMessageRequestSchema.safeParse({
        clientRequestId: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        content: 'Réponds localement',
        mode: 'local',
        model: 'qwen3.5',
      }).success,
    ).toBe(true);
    expect(
      AssistantRunSchema.safeParse({
        id: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        conversationId: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        userMessageId: '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        assistantMessageId: null,
        requestedMode: 'auto',
        effectiveMode: 'web',
        webDepth: 'fast',
        status: 'queued',
        stageLabel: 'Dans la file',
        queuePosition: 2,
        searchQueries: [],
        error: null,
        createdAt: '2026-08-10T12:00:00.000Z',
        updatedAt: '2026-08-10T12:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      AssistantSendMessageRequestSchema.safeParse({
        clientRequestId: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        content: 'Recherche en ligne',
        mode: 'classic',
      }).success,
    ).toBe(false);
    expect(
      AssistantSendMessageRequestSchema.safeParse({
        clientRequestId: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        content: 'Modèle arbitraire',
        mode: 'local',
        model: 'modele-non-autorise',
      }).success,
    ).toBe(false);
  });
});

const budgetAudit = {
  id: '16cd13bc-3a63-4b56-8e95-f39dcb7a993d',
  householdId: '1030b4f6-1e0f-48fa-adab-865750ce597d',
  revision: 0,
  createdAt: '2026-08-09T12:00:00.000Z',
  updatedAt: '2026-08-09T12:00:00.000Z',
  deletedAt: null,
  createdByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
  updatedByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
  deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
  schemaVersion: 1,
} as const;

describe('budget contracts', () => {
  it('uses a positive amount and the movement type for its direction', () => {
    const base = {
      ...budgetAudit,
      kind: 'expense',
      category: 'groceries',
      incomeType: null,
      transferDirection: null,
      label: 'Dépense fictive',
      occurredOn: '2026-08-09',
      ownerProfileId: null,
      envelopeId: null,
      plannedExpenseId: null,
      recurringTemplateId: null,
      correctionOfId: null,
      source: 'manual',
    };
    expect(
      BudgetEntryRecordSchema.safeParse({ ...base, amountCents: 1 }).success,
    ).toBe(true);
    expect(
      BudgetEntryRecordSchema.safeParse({ ...base, amountCents: -1 }).success,
    ).toBe(false);
    expect(
      BudgetEntryRecordSchema.safeParse({
        ...base,
        amountCents: 100,
        category: null,
      }).success,
    ).toBe(false);
  });

  it('keeps inactive zero-value import drafts but rejects active ones', () => {
    const template = {
      ...budgetAudit,
      kind: 'expense',
      category: 'fixed',
      incomeType: null,
      transferDirection: null,
      label: 'À confirmer',
      amountCents: 0,
      frequency: 'monthly',
      dueDay: 1,
      dueMonth: null,
      startDate: '2026-08-01',
      endDate: null,
      essential: false,
      ownerProfileId: null,
      envelopeId: null,
    };
    expect(
      BudgetRecurringTemplateRecordSchema.safeParse({
        ...template,
        active: false,
      }).success,
    ).toBe(true);
    expect(
      BudgetRecurringTemplateRecordSchema.safeParse({
        ...template,
        active: true,
      }).success,
    ).toBe(false);
  });

  it('keeps fixed costs outside envelopes', () => {
    const envelope = {
      ...budgetAudit,
      name: 'Frais fixes interdits',
      kind: 'monthly',
      category: 'fixed',
      ownerProfileId: null,
      monthlyAllocationCents: 10000,
      rollover: 'reset',
      targetAmountCents: null,
      dueDate: null,
      active: true,
    };

    expect(BudgetEnvelopeRecordSchema.safeParse(envelope).success).toBe(false);
    expect(
      BudgetEnvelopeRecordSchema.safeParse({
        ...envelope,
        category: 'groceries',
      }).success,
    ).toBe(true);
  });
});

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
    expect(groceryItem.manualStoreFamilyId).toBeNull();
    expect(result.success).toBe(true);
  });

  it('rejects a manual aisle outside its store family', () => {
    const result = GroceryItemRecordSchema.safeParse({
      id: 'da166bcc-38c4-4a17-859f-7491e1b2312f',
      householdId: '1030b4f6-1e0f-48fa-adab-865750ce597d',
      revision: 0,
      label: 'Peinture',
      quantityText: null,
      manualStoreFamilyId: 'supermarket',
      manualAisleId: 'paint',
      checkedAt: null,
      createdAt: '2026-08-09T12:00:00.000Z',
      updatedAt: '2026-08-09T12:00:00.000Z',
      deletedAt: null,
      createdByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
      updatedByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
      deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
      schemaVersion: 1,
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

describe('grocery photo transcription contracts', () => {
  it('bounds local photos and requires editable, positioned detections', () => {
    expect(
      GroceryPhotoTranscriptionRequestSchema.safeParse({
        imageBase64: 'YWJjZGVmZ2hpamtsbW5vcA==',
        mediaType: 'image/jpeg',
      }).success,
    ).toBe(true);
    expect(
      GroceryPhotoTranscriptionRequestSchema.safeParse({
        imageBase64: 'not base64 data !!!',
        mediaType: 'image/jpeg',
      }).success,
    ).toBe(false);
    expect(
      GroceryPhotoTranscriptionResponseSchema.safeParse({
        items: [
          {
            box: { x: 90, y: 100, width: 220, height: 35 },
            label: 'Œufs',
            quantityText: null,
            sourceText: 'oeufs',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
