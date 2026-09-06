import type {
  BudgetEntryOperation,
  GroceryItemOperation,
  TaskOperation,
} from '@friday/contracts';
import { rmSync } from 'node:fs';
import { afterEach, expect } from 'vitest';
import { buildHub } from '../app.js';
export function operation(): TaskOperation {
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
export function groceryOperation(): GroceryItemOperation {
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
export function budgetOperation(): BudgetEntryOperation {
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
export async function bootstrap(
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
export function createHubFixtures() {
  const apps: Awaited<ReturnType<typeof buildHub>>[] = [];
  const temporaryDirectories: string[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });
  return { apps, temporaryDirectories };
}
