import { readFileSync } from 'node:fs';

import type Database from 'better-sqlite3';
import { z } from 'zod';

import {
  BudgetEntryRecordSchema,
  BudgetEnvelopeRecordSchema,
  BudgetPlannedExpenseRecordSchema,
  BudgetRecurringTemplateRecordSchema,
  BudgetSavingsMonthRecordSchema,
} from '@friday/contracts';

import { openDatabase } from '../db/database.js';

export const BudgetSeedSchema = z
  .object({
    version: z.string().regex(/^budget-seed-v\d+$/u),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    entries: z.array(BudgetEntryRecordSchema),
    envelopes: z.array(BudgetEnvelopeRecordSchema),
    plannedExpenses: z.array(BudgetPlannedExpenseRecordSchema),
    recurringTemplates: z.array(BudgetRecurringTemplateRecordSchema),
    savingsMonths: z.array(BudgetSavingsMonthRecordSchema),
  })
  .strict();

export type BudgetSeed = z.infer<typeof BudgetSeedSchema>;

const SECTIONS = [
  ['budget_entry', 'budget_entries', 'entries'],
  ['budget_envelope', 'budget_envelopes', 'envelopes'],
  ['budget_planned_expense', 'budget_planned_expenses', 'plannedExpenses'],
  [
    'budget_recurring_template',
    'budget_recurring_templates',
    'recurringTemplates',
  ],
  ['budget_savings_month', 'budget_savings_months', 'savingsMonths'],
] as const;

export function summarizeBudgetSeed(seed: BudgetSeed) {
  return {
    entries: {
      count: seed.entries.length,
      amountCents: seed.entries.reduce(
        (sum, record) => sum + record.amountCents,
        0,
      ),
    },
    envelopes: {
      count: seed.envelopes.length,
      monthlyAllocationCents: seed.envelopes.reduce(
        (sum, record) => sum + record.monthlyAllocationCents,
        0,
      ),
    },
    plannedExpenses: {
      count: seed.plannedExpenses.length,
      amountCents: seed.plannedExpenses.reduce(
        (sum, record) => sum + record.amountCents,
        0,
      ),
    },
    recurringTemplates: {
      count: seed.recurringTemplates.length,
      amountCents: seed.recurringTemplates.reduce(
        (sum, record) => sum + record.amountCents,
        0,
      ),
    },
    savingsMonths: { count: seed.savingsMonths.length },
  };
}

export function applyBudgetSeed(
  database: Database.Database,
  input: unknown,
): { applied: boolean; summary: ReturnType<typeof summarizeBudgetSeed> } {
  const seed = BudgetSeedSchema.parse(input);
  const summary = summarizeBudgetSeed(seed);
  return database.transaction(() => {
    const existing = database
      .prepare('SELECT version FROM budget_seed_markers WHERE version = ?')
      .get(seed.version);
    if (existing) return { applied: false, summary };

    const now = new Date().toISOString();
    for (const [entityType, table, property] of SECTIONS) {
      const records = seed[property];
      const statement = database.prepare(
        `INSERT INTO ${table} (id, household_id, revision, payload_json, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const record of records) {
        const canonical = { ...record, revision: Math.max(1, record.revision) };
        statement.run(
          canonical.id,
          canonical.householdId,
          canonical.revision,
          JSON.stringify(canonical),
          canonical.updatedAt,
        );
        database
          .prepare(
            `INSERT INTO change_log (
               entity_type, entity_id, operation, payload_json, created_at
             ) VALUES (?, ?, 'upsert', ?, ?)`,
          )
          .run(entityType, canonical.id, JSON.stringify(canonical), now);
      }
    }
    database
      .prepare(
        `INSERT INTO budget_seed_markers (
           version, applied_at, source_digest, summary_json
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(seed.version, now, seed.sourceDigest, JSON.stringify(summary));
    return { applied: true, summary };
  })();
}

function cli(): void {
  const inputPath = process.argv[2];
  const databasePath = process.argv[3];
  if (!inputPath || !databasePath) {
    throw new Error(
      'Usage: pnpm --filter @friday/hub seed:budget <normalized.json> <friday.sqlite>',
    );
  }
  const database = openDatabase(databasePath);
  try {
    const result = applyBudgetSeed(
      database,
      JSON.parse(readFileSync(inputPath, 'utf8')),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    database.close();
  }
}

if (process.argv[1]?.endsWith('budget-seed.ts')) cli();
