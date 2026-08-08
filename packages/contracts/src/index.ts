import { z } from 'zod';

export const ProtocolVersionSchema = z.literal(1);
export const UuidSchema = z.string().uuid();
export const UtcInstantSchema = z.string().datetime({ offset: true });
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const TaskStatusSchema = z.enum(['todo', 'done']);
export const TaskRecurrenceSchema = z.enum(['daily', 'weekly', 'monthly']);

export const TaskRecordSchema = z
  .object({
    id: UuidSchema,
    householdId: UuidSchema,
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(200),
    dueDate: LocalDateSchema.nullable(),
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
  .strict();

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

export const PushRequestSchema = z
  .object({
    operations: z.array(TaskOperationSchema).max(100),
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

export const ChangeSchema = z
  .object({
    cursor: z.number().int().positive(),
    entityType: z.literal('task'),
    entityId: UuidSchema,
    operation: z.literal('upsert'),
    payload: TaskRecordSchema,
  })
  .strict();

export const PullResponseSchema = z
  .object({
    changes: z.array(ChangeSchema),
    cursor: z.number().int().nonnegative(),
  })
  .strict();

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    database: z.literal('ok'),
    ollama: z.literal('not-required'),
    version: z.string(),
  })
  .strict();

export type TaskRecord = z.infer<typeof TaskRecordSchema>;
export type TaskOperation = z.infer<typeof TaskOperationSchema>;
export type PushRequest = z.infer<typeof PushRequestSchema>;
export type OperationAck = z.infer<typeof OperationAckSchema>;
export type PushResponse = z.infer<typeof PushResponseSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type PullResponse = z.infer<typeof PullResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
