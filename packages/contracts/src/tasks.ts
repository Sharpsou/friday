import { z } from 'zod';
import {
  LocalDateSchema,
  LocalTimeSchema,
  ProtocolVersionSchema,
  UtcInstantSchema,
  UuidSchema,
} from './common.ts';

export const TaskStatusSchema = z.enum(['todo', 'done']);

export const TaskRecurrenceRuleSchema = z
  .object({
    anchorDate: LocalDateSchema,
    endDate: LocalDateSchema.nullable().default(null),
    interval: z.number().int().min(1).max(365),
    seriesId: UuidSchema,
    unit: z.enum(['day', 'week', 'month', 'year']),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.unit !== 'day' && rule.interval !== 1) {
      context.addIssue({
        code: 'custom',
        message:
          'Seule la récurrence en jours accepte un intervalle personnalisé.',
        path: ['interval'],
      });
    }
    if (rule.endDate !== null && rule.endDate < rule.anchorDate) {
      context.addIssue({
        code: 'custom',
        message: 'La date de fin doit suivre la première occurrence.',
        path: ['endDate'],
      });
    }
  });

export const TaskRecurrenceSchema = z.union([
  z.enum(['daily', 'weekly', 'monthly']),
  TaskRecurrenceRuleSchema,
]);

export const TaskRecordSchema = z
  .object({
    id: UuidSchema,
    householdId: UuidSchema,
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(200),
    dueDate: LocalDateSchema.nullable(),
    dueTime: LocalTimeSchema.nullable().default(null),
    durationMinutes: z
      .number()
      .int()
      .min(1)
      .max(1_440)
      .nullable()
      .default(null),
    assigneeProfileId: UuidSchema.nullable(),
    recurrence: TaskRecurrenceSchema.nullable(),
    note: z.string().trim().max(2_000).nullable(),
    status: TaskStatusSchema,
    createdAt: UtcInstantSchema,
    updatedAt: UtcInstantSchema,
    deletedAt: UtcInstantSchema.nullable(),
    createdByProfileId: UuidSchema,
    updatedByProfileId: UuidSchema,
    deviceId: UuidSchema,
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.dueTime !== null && task.dueDate === null) {
      context.addIssue({
        code: 'custom',
        message: 'Une heure nécessite une date.',
        path: ['dueTime'],
      });
    }
    if (task.durationMinutes !== null && task.dueTime === null) {
      context.addIssue({
        code: 'custom',
        message: 'Une durée nécessite une heure.',
        path: ['durationMinutes'],
      });
    }
    if (task.recurrence !== null && task.dueDate === null) {
      context.addIssue({
        code: 'custom',
        message: 'Une récurrence nécessite une date.',
        path: ['recurrence'],
      });
    }
  });

export const TaskOperationSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    operationId: UuidSchema,
    deviceId: UuidSchema,
    profileId: UuidSchema,
    entityType: z.literal('task'),
    entityId: UuidSchema,
    operation: z.literal('upsert'),
    baseRevision: z.number().int().nonnegative(),
    clientCreatedAt: UtcInstantSchema,
    payload: TaskRecordSchema,
  })
  .strict();

export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export type TaskRecurrence = z.infer<typeof TaskRecurrenceSchema>;

export type TaskRecurrenceRule = z.infer<typeof TaskRecurrenceRuleSchema>;

export type TaskOperation = z.infer<typeof TaskOperationSchema>;
