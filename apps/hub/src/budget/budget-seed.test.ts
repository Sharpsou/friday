import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migrateDatabase } from '../db/database.js';
import { applyBudgetSeed } from './budget-seed.js';

describe('budget seed', () => {
  it('applies a fictitious normalized seed once without logging labels', () => {
    const database = new Database(':memory:');
    migrateDatabase(database);
    const now = '2026-08-09T12:00:00.000Z';
    const audit = {
      householdId: '1030b4f6-1e0f-48fa-adab-865750ce597d',
      revision: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      createdByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
      updatedByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
      deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
      schemaVersion: 1,
    } as const;
    const seed = {
      version: 'budget-seed-v1',
      sourceDigest: 'a'.repeat(64),
      entries: [
        {
          ...audit,
          id: '16cd13bc-3a63-4b56-8e95-f39dcb7a993d',
          kind: 'income',
          category: null,
          incomeType: 'regular',
          transferDirection: null,
          label: 'Salaire fictif',
          amountCents: 250000,
          occurredOn: '2026-08-01',
          ownerProfileId: null,
          envelopeId: null,
          plannedExpenseId: null,
          recurringTemplateId: null,
          correctionOfId: null,
          source: 'import',
        },
      ],
      envelopes: [],
      plannedExpenses: [],
      recurringTemplates: [],
      savingsMonths: [],
    };

    expect(applyBudgetSeed(database, seed).applied).toBe(true);
    expect(applyBudgetSeed(database, seed).applied).toBe(false);
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM budget_entries').get(),
    ).toEqual({ count: 1 });
    const marker = database
      .prepare('SELECT summary_json FROM budget_seed_markers')
      .get() as { summary_json: string };
    expect(marker.summary_json).not.toContain('Salaire fictif');
    database.close();
  });
});
