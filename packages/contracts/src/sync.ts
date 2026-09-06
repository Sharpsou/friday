import { z } from 'zod';
import {
  BudgetEntryOperationSchema,
  BudgetEntryRecordSchema,
  BudgetEnvelopeOperationSchema,
  BudgetEnvelopeRecordSchema,
  BudgetPlannedExpenseOperationSchema,
  BudgetPlannedExpenseRecordSchema,
  BudgetRecurringTemplateOperationSchema,
  BudgetRecurringTemplateRecordSchema,
  BudgetSavingsMonthOperationSchema,
  BudgetSavingsMonthRecordSchema,
} from './budget.ts';
import { UuidSchema } from './common.ts';
import {
  GroceryItemOperationSchema,
  GroceryItemRecordSchema,
} from './groceries.ts';
import { MaisonChangeSchema, MaisonCommandSchema } from './maison.ts';
import { TaskOperationSchema, TaskRecordSchema } from './tasks.ts';

export const SyncOperationSchema = z.discriminatedUnion('entityType', [
  MaisonCommandSchema,
  TaskOperationSchema,
  GroceryItemOperationSchema,
  BudgetEntryOperationSchema,
  BudgetRecurringTemplateOperationSchema,
  BudgetEnvelopeOperationSchema,
  BudgetPlannedExpenseOperationSchema,
  BudgetSavingsMonthOperationSchema,
]);

export const PushRequestSchema = z
  .object({
    operations: z.array(SyncOperationSchema).max(100),
  })
  .strict();

export const OperationAckSchema = z
  .object({
    operationId: UuidSchema,
    entityId: UuidSchema,
    status: z.enum(['applied', 'conflict']),
    serverRevision: z.number().int().nonnegative(),
    conflictReason: z.enum(['revision_mismatch']).nullable(),
  })
  .strict();

export const PushResponseSchema = z
  .object({
    acks: z.array(OperationAckSchema),
    cursor: z.number().int().nonnegative(),
  })
  .strict();

const TaskChangeSchema = z
  .object({
    cursor: z.number().int().positive(),
    entityType: z.literal('task'),
    entityId: UuidSchema,
    operation: z.literal('upsert'),
    payload: TaskRecordSchema,
  })
  .strict();

const GroceryItemChangeSchema = z
  .object({
    cursor: z.number().int().positive(),
    entityType: z.literal('grocery_item'),
    entityId: UuidSchema,
    operation: z.literal('upsert'),
    payload: GroceryItemRecordSchema,
  })
  .strict();

function budgetChangeSchema<
  EntityType extends string,
  Schema extends z.ZodType,
>(entityType: EntityType, payload: Schema) {
  return z
    .object({
      cursor: z.number().int().positive(),
      entityType: z.literal(entityType),
      entityId: UuidSchema,
      operation: z.literal('upsert'),
      payload,
    })
    .strict();
}

const BudgetEntryChangeSchema = budgetChangeSchema(
  'budget_entry',
  BudgetEntryRecordSchema,
);

const BudgetRecurringTemplateChangeSchema = budgetChangeSchema(
  'budget_recurring_template',
  BudgetRecurringTemplateRecordSchema,
);

const BudgetEnvelopeChangeSchema = budgetChangeSchema(
  'budget_envelope',
  BudgetEnvelopeRecordSchema,
);

const BudgetPlannedExpenseChangeSchema = budgetChangeSchema(
  'budget_planned_expense',
  BudgetPlannedExpenseRecordSchema,
);

const BudgetSavingsMonthChangeSchema = budgetChangeSchema(
  'budget_savings_month',
  BudgetSavingsMonthRecordSchema,
);

export const ChangeSchema = z.discriminatedUnion('entityType', [
  MaisonChangeSchema,
  TaskChangeSchema,
  GroceryItemChangeSchema,
  BudgetEntryChangeSchema,
  BudgetRecurringTemplateChangeSchema,
  BudgetEnvelopeChangeSchema,
  BudgetPlannedExpenseChangeSchema,
  BudgetSavingsMonthChangeSchema,
]);

export const PullResponseSchema = z
  .object({
    changes: z.array(ChangeSchema),
    cursor: z.number().int().nonnegative(),
  })
  .strict();

export type SyncOperation = z.infer<typeof SyncOperationSchema>;

export type PushRequest = z.infer<typeof PushRequestSchema>;

export type OperationAck = z.infer<typeof OperationAckSchema>;

export type PushResponse = z.infer<typeof PushResponseSchema>;

export type Change = z.infer<typeof ChangeSchema>;

export type PullResponse = z.infer<typeof PullResponseSchema>;
