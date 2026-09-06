import { z } from 'zod';
import {
  LocalDateSchema,
  ProtocolVersionSchema,
  UtcInstantSchema,
  UuidSchema,
} from './common.ts';

export const BudgetCategorySchema = z.enum([
  'fixed',
  'groceries',
  'health',
  'leisure',
  'extra',
]);

export const BudgetOwnerProfileIdSchema = UuidSchema.nullable();

export const BudgetFrequencySchema = z.enum(['monthly', 'yearly']);

export const BudgetEntryKindSchema = z.enum([
  'expense',
  'income',
  'savings_transfer',
]);

export const BudgetIncomeTypeSchema = z.enum(['regular', 'extra']);

export const BudgetTransferDirectionSchema = z.enum(['deposit', 'withdrawal']);

export const BudgetSourceSchema = z.enum(['manual', 'automatic', 'import']);

export const BudgetRolloverSchema = z.enum(['reset', 'carry']);

export const BudgetEnvelopeKindSchema = z.enum(['monthly', 'project']);

export const BudgetPlannedExpenseStatusSchema = z.enum([
  'draft',
  'planned',
  'paid',
  'cancelled',
]);

export const BudgetPrioritySchema = z.enum(['low', 'medium', 'high']);

const BudgetAuditFieldsSchema = z.object({
  id: UuidSchema,
  householdId: UuidSchema,
  revision: z.number().int().nonnegative(),
  createdAt: UtcInstantSchema,
  updatedAt: UtcInstantSchema,
  deletedAt: UtcInstantSchema.nullable(),
  createdByProfileId: UuidSchema,
  updatedByProfileId: UuidSchema,
  deviceId: UuidSchema,
  schemaVersion: z.literal(1),
});

export const BudgetEntryRecordSchema = BudgetAuditFieldsSchema.extend({
  kind: BudgetEntryKindSchema,
  category: BudgetCategorySchema.nullable(),
  incomeType: BudgetIncomeTypeSchema.nullable(),
  transferDirection: BudgetTransferDirectionSchema.nullable(),
  label: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive().max(1_000_000_000),
  occurredOn: LocalDateSchema,
  ownerProfileId: BudgetOwnerProfileIdSchema,
  envelopeId: UuidSchema.nullable(),
  plannedExpenseId: UuidSchema.nullable(),
  recurringTemplateId: UuidSchema.nullable(),
  correctionOfId: UuidSchema.nullable(),
  source: BudgetSourceSchema,
})
  .strict()
  .superRefine((entry, context) => {
    if (entry.kind === 'expense' && entry.category === null) {
      context.addIssue({
        code: 'custom',
        message: 'Une dépense exige une catégorie.',
        path: ['category'],
      });
    }
    if (entry.kind === 'income' && entry.incomeType === null) {
      context.addIssue({
        code: 'custom',
        message: 'Un revenu exige un type.',
        path: ['incomeType'],
      });
    }
    if (entry.kind === 'savings_transfer' && entry.transferDirection === null) {
      context.addIssue({
        code: 'custom',
        message: "Un mouvement d'épargne exige un sens.",
        path: ['transferDirection'],
      });
    }
    if (entry.kind !== 'expense' && entry.category !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Seules les dépenses ont une catégorie.',
        path: ['category'],
      });
    }
  });

export const BudgetRecurringTemplateRecordSchema =
  BudgetAuditFieldsSchema.extend({
    kind: BudgetEntryKindSchema,
    category: BudgetCategorySchema.nullable(),
    incomeType: BudgetIncomeTypeSchema.nullable(),
    transferDirection: BudgetTransferDirectionSchema.nullable(),
    label: z.string().trim().min(1).max(200),
    amountCents: z.number().int().nonnegative().max(1_000_000_000),
    frequency: BudgetFrequencySchema,
    dueDay: z.number().int().min(1).max(31),
    dueMonth: z.number().int().min(1).max(12).nullable(),
    startDate: LocalDateSchema,
    endDate: LocalDateSchema.nullable(),
    essential: z.boolean(),
    active: z.boolean(),
    ownerProfileId: BudgetOwnerProfileIdSchema,
    envelopeId: UuidSchema.nullable(),
  })
    .strict()
    .superRefine((template, context) => {
      if (template.frequency === 'yearly' && template.dueMonth === null) {
        context.addIssue({
          code: 'custom',
          message: 'Une récurrence annuelle exige un mois.',
          path: ['dueMonth'],
        });
      }
      if (template.frequency === 'monthly' && template.dueMonth !== null) {
        context.addIssue({
          code: 'custom',
          message: 'Une récurrence mensuelle ne fixe pas de mois.',
          path: ['dueMonth'],
        });
      }
      if (template.active && template.amountCents === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Un modèle actif exige un montant.',
          path: ['amountCents'],
        });
      }
      if (template.kind === 'expense' && template.category === null) {
        context.addIssue({
          code: 'custom',
          message: 'Une dépense exige une catégorie.',
          path: ['category'],
        });
      }
      if (template.kind === 'income' && template.incomeType === null) {
        context.addIssue({
          code: 'custom',
          message: 'Un revenu exige un type.',
          path: ['incomeType'],
        });
      }
      if (
        template.kind === 'savings_transfer' &&
        template.transferDirection === null
      ) {
        context.addIssue({
          code: 'custom',
          message: "Un mouvement d'épargne exige un sens.",
          path: ['transferDirection'],
        });
      }
    });

export const BudgetEnvelopeRecordSchema = BudgetAuditFieldsSchema.extend({
  name: z.string().trim().min(1).max(100),
  kind: BudgetEnvelopeKindSchema,
  category: BudgetCategorySchema,
  ownerProfileId: BudgetOwnerProfileIdSchema,
  monthlyAllocationCents: z.number().int().nonnegative().max(1_000_000_000),
  rollover: BudgetRolloverSchema,
  targetAmountCents: z.number().int().positive().max(1_000_000_000).nullable(),
  dueDate: LocalDateSchema.nullable(),
  active: z.boolean(),
})
  .strict()
  .superRefine((envelope, context) => {
    if (envelope.category === 'fixed') {
      context.addIssue({
        code: 'custom',
        message: 'Les frais fixes restent hors enveloppes.',
        path: ['category'],
      });
    }
    if (envelope.kind === 'project' && envelope.rollover !== 'carry') {
      context.addIssue({
        code: 'custom',
        message: 'Un projet doit cumuler son solde.',
        path: ['rollover'],
      });
    }
  });

export const BudgetPlannedExpenseRecordSchema = BudgetAuditFieldsSchema.extend({
  label: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive().max(1_000_000_000),
  dueDate: LocalDateSchema,
  category: BudgetCategorySchema,
  ownerProfileId: BudgetOwnerProfileIdSchema,
  priority: BudgetPrioritySchema.nullable(),
  status: BudgetPlannedExpenseStatusSchema,
  envelopeId: UuidSchema.nullable(),
  provisionAccepted: z.boolean(),
  provisionStartedMonth: LocalDateSchema.refine(
    (value) => value.endsWith('-01'),
    'Le mois de provision doit commencer le premier.',
  )
    .nullable()
    .default(null),
  monthlyProvisionCents: z.number().int().nonnegative().max(1_000_000_000),
  paidEntryId: UuidSchema.nullable(),
  note: z.string().trim().max(2_000).nullable(),
}).strict();

export const BudgetSavingsMonthRecordSchema = BudgetAuditFieldsSchema.extend({
  month: LocalDateSchema.refine(
    (value) => value.endsWith('-01'),
    'Le mois doit commencer le premier.',
  ),
  targetCents: z.number().int().nonnegative().max(1_000_000_000),
  reserveOpeningBalanceCents: z.number().int().nonnegative().max(1_000_000_000),
  reserveAsOfDate: LocalDateSchema,
  reserveTargetMonths: z.number().int().min(1).max(24),
}).strict();

function budgetOperationSchema<
  EntityType extends string,
  Schema extends z.ZodType,
>(entityType: EntityType, payload: Schema) {
  return z
    .object({
      protocolVersion: ProtocolVersionSchema,
      operationId: UuidSchema,
      deviceId: UuidSchema,
      profileId: UuidSchema,
      entityType: z.literal(entityType),
      entityId: UuidSchema,
      operation: z.literal('upsert'),
      baseRevision: z.number().int().nonnegative(),
      clientCreatedAt: UtcInstantSchema,
      payload,
    })
    .strict();
}

export const BudgetEntryOperationSchema = budgetOperationSchema(
  'budget_entry',
  BudgetEntryRecordSchema,
);

export const BudgetRecurringTemplateOperationSchema = budgetOperationSchema(
  'budget_recurring_template',
  BudgetRecurringTemplateRecordSchema,
);

export const BudgetEnvelopeOperationSchema = budgetOperationSchema(
  'budget_envelope',
  BudgetEnvelopeRecordSchema,
);

export const BudgetPlannedExpenseOperationSchema = budgetOperationSchema(
  'budget_planned_expense',
  BudgetPlannedExpenseRecordSchema,
);

export const BudgetSavingsMonthOperationSchema = budgetOperationSchema(
  'budget_savings_month',
  BudgetSavingsMonthRecordSchema,
);

export type BudgetCategory = z.infer<typeof BudgetCategorySchema>;

export type BudgetEntryRecord = z.infer<typeof BudgetEntryRecordSchema>;

export type BudgetRecurringTemplateRecord = z.infer<
  typeof BudgetRecurringTemplateRecordSchema
>;

export type BudgetEnvelopeRecord = z.infer<typeof BudgetEnvelopeRecordSchema>;

export type BudgetPlannedExpenseRecord = z.infer<
  typeof BudgetPlannedExpenseRecordSchema
>;

export type BudgetSavingsMonthRecord = z.infer<
  typeof BudgetSavingsMonthRecordSchema
>;

export type BudgetEntryOperation = z.infer<typeof BudgetEntryOperationSchema>;

export type BudgetRecurringTemplateOperation = z.infer<
  typeof BudgetRecurringTemplateOperationSchema
>;

export type BudgetEnvelopeOperation = z.infer<
  typeof BudgetEnvelopeOperationSchema
>;

export type BudgetPlannedExpenseOperation = z.infer<
  typeof BudgetPlannedExpenseOperationSchema
>;

export type BudgetSavingsMonthOperation = z.infer<
  typeof BudgetSavingsMonthOperationSchema
>;
