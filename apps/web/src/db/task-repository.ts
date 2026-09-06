import {
  TaskOperationSchema,
  TaskRecordSchema,
  type TaskOperation,
  type TaskRecord,
  type TaskRecurrenceRule,
} from '@friday/contracts';
import {
  getNextRecurrenceDate,
  getRecurrenceDates,
  normalizeTaskNote,
  normalizeTaskTitle,
} from '@friday/domain';
import Dexie from 'dexie';
import { decryptJson, encryptJson } from '../crypto/vault.js';
import { compareTasksBySchedule } from '../task-sort.js';
import { getDeviceContext } from './device-context.js';
import { outboxAad, taskAad } from './encryption-context.js';
import { fridayDb, type TaskRow } from './friday-db.js';

const HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';

export type LocalTask = TaskRecord & {
  syncState: TaskRow['syncState'];
};

export interface CreateLocalTaskInput {
  assigneeProfileId?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  durationMinutes?: number | null;
  note?: string | null;
  recurrence?: Pick<TaskRecurrenceRule, 'endDate' | 'interval' | 'unit'> | null;
  title: string;
}

export interface UpdateLocalTaskInput {
  assigneeProfileId?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  durationMinutes?: number | null;
  note?: string | null;
  title: string;
}

function shiftLocalDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDateDifference(left: string, right: string): number {
  return Math.round(
    (Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) /
      86_400_000,
  );
}

async function deterministicOccurrenceId(
  seriesId: string,
  dueDate: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${seriesId}:${dueDate}`),
    ),
  ).slice(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...digest].map((value) => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export async function createLocalTask(
  input: string | CreateLocalTaskInput,
): Promise<TaskRecord> {
  const taskInput = typeof input === 'string' ? { title: input } : input;
  const title = normalizeTaskTitle(taskInput.title);
  if (!title) {
    throw new Error('Le titre est obligatoire.');
  }

  const { deviceId, key, profileId } = await getDeviceContext();
  const now = new Date().toISOString();
  const dueDate = taskInput.dueDate ?? null;
  const task = TaskRecordSchema.parse({
    id: crypto.randomUUID(),
    householdId: HOUSEHOLD_ID,
    revision: 0,
    title,
    dueDate,
    dueTime: taskInput.dueTime ?? null,
    durationMinutes: taskInput.durationMinutes ?? null,
    assigneeProfileId: taskInput.assigneeProfileId ?? null,
    recurrence:
      taskInput.recurrence && dueDate
        ? {
            ...taskInput.recurrence,
            anchorDate: dueDate,
            seriesId: crypto.randomUUID(),
          }
        : null,
    note: normalizeTaskNote(taskInput.note ?? ''),
    status: 'todo',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdByProfileId: profileId,
    updatedByProfileId: profileId,
    deviceId,
    schemaVersion: 1,
  });
  const recurrence = task.recurrence;
  const occurrenceDates =
    recurrence !== null && typeof recurrence === 'object' && recurrence.endDate
      ? getRecurrenceDates(task.dueDate ?? '', {
          ...recurrence,
          endDate: recurrence.endDate,
        })
      : [task.dueDate];
  const occurrenceTasks = await Promise.all(
    occurrenceDates.map(async (occurrenceDate, index) => {
      if (index === 0) return task;
      const occurrenceAt = new Date(Date.parse(now) + index).toISOString();
      return TaskRecordSchema.parse({
        ...task,
        id: await deterministicOccurrenceId(
          recurrence !== null && typeof recurrence === 'object'
            ? recurrence.seriesId
            : task.id,
          occurrenceDate ?? '',
        ),
        dueDate: occurrenceDate,
        createdAt: occurrenceAt,
        updatedAt: occurrenceAt,
      });
    }),
  );
  const operations = occurrenceTasks.map((occurrence) =>
    TaskOperationSchema.parse({
      protocolVersion: 1,
      operationId: crypto.randomUUID(),
      deviceId,
      profileId,
      entityType: 'task',
      entityId: occurrence.id,
      operation: 'upsert',
      baseRevision: 0,
      clientCreatedAt: occurrence.createdAt,
      payload: occurrence,
    }),
  );
  const encryptedRows = await Promise.all(
    occurrenceTasks.map(async (occurrence, index) => {
      const operation = operations[index];
      if (!operation) throw new Error('Opération de récurrence absente.');
      const [encryptedTask, encryptedOperation] = await Promise.all([
        encryptJson(key, occurrence, taskAad(occurrence.id, deviceId)),
        encryptJson(key, operation, outboxAad(operation.operationId, deviceId)),
      ]);
      return { encryptedOperation, encryptedTask, occurrence, operation };
    }),
  );

  await fridayDb.transaction(
    'rw',
    fridayDb.tasks,
    fridayDb.outbox,
    async () => {
      await fridayDb.tasks.bulkPut(
        encryptedRows.map(({ encryptedTask, occurrence }) => ({
          encrypted: encryptedTask,
          id: occurrence.id,
          revision: occurrence.revision,
          syncState: 'pending' as const,
          updatedAt: occurrence.updatedAt,
        })),
      );
      await fridayDb.outbox.bulkPut(
        encryptedRows.map(({ encryptedOperation, operation }) => ({
          createdAt: operation.clientCreatedAt,
          encryptedPayload: encryptedOperation,
          entityId: operation.entityId,
          operationId: operation.operationId,
          state: 'pending' as const,
        })),
      );
    },
  );

  return task;
}

async function queueLocalTaskUpdate(
  taskId: string,
  update: (task: TaskRecord, updatedAt: string) => TaskRecord | null,
  generateNextOccurrence = false,
): Promise<TaskRecord> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const row = await fridayDb.tasks.get(taskId);
  if (!row) {
    throw new Error('Tâche introuvable.');
  }

  const task = TaskRecordSchema.parse(
    await decryptJson<TaskRecord>(
      key,
      row.encrypted,
      taskAad(row.id, deviceId),
    ),
  );
  const queuedOperations = await fridayDb.outbox
    .where('entityId')
    .equals(taskId)
    .and((operation) => ['pending', 'sent'].includes(operation.state))
    .toArray();
  const latestQueuedTimestamp = queuedOperations.reduce(
    (latest, operation) => Math.max(latest, Date.parse(operation.createdAt)),
    0,
  );
  const now = new Date(
    Math.max(Date.now(), latestQueuedTimestamp + 1),
  ).toISOString();
  const changedTask = update(task, now);
  if (!changedTask) return task;
  const baseRevision = task.revision + (queuedOperations.length > 0 ? 1 : 0);
  const updatedTask = TaskRecordSchema.parse({
    ...changedTask,
    revision: baseRevision,
    updatedAt: now,
    updatedByProfileId: profileId,
    deviceId,
  });
  const operation = TaskOperationSchema.parse({
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    deviceId,
    profileId,
    entityType: 'task',
    entityId: task.id,
    operation: 'upsert',
    baseRevision,
    clientCreatedAt: now,
    payload: updatedTask,
  });
  let nextTask: TaskRecord | null = null;
  let nextOperation: TaskOperation | null = null;
  if (
    generateNextOccurrence &&
    updatedTask.status === 'done' &&
    updatedTask.dueDate &&
    updatedTask.recurrence &&
    (typeof updatedTask.recurrence === 'string' ||
      updatedTask.recurrence.endDate === null)
  ) {
    const recurrence: TaskRecurrenceRule =
      typeof updatedTask.recurrence === 'string'
        ? {
            anchorDate: updatedTask.dueDate,
            endDate: null,
            interval: 1,
            seriesId: updatedTask.id,
            unit:
              updatedTask.recurrence === 'daily'
                ? 'day'
                : updatedTask.recurrence === 'weekly'
                  ? 'week'
                  : 'month',
          }
        : updatedTask.recurrence;
    const nextDueDate = getNextRecurrenceDate(updatedTask.dueDate, recurrence);
    const nextId = await deterministicOccurrenceId(
      recurrence.seriesId,
      nextDueDate,
    );
    const nextCreatedAt = new Date(Date.parse(now) + 1).toISOString();
    nextTask = TaskRecordSchema.parse({
      ...updatedTask,
      id: nextId,
      revision: 0,
      dueDate: nextDueDate,
      recurrence,
      status: 'todo',
      createdAt: nextCreatedAt,
      updatedAt: nextCreatedAt,
      deletedAt: null,
    });
    nextOperation = TaskOperationSchema.parse({
      ...operation,
      operationId: crypto.randomUUID(),
      entityId: nextId,
      baseRevision: 0,
      clientCreatedAt: nextCreatedAt,
      payload: nextTask,
    });
  }
  const [
    encryptedTask,
    encryptedOperation,
    encryptedNextTask,
    encryptedNextOperation,
  ] = await Promise.all([
    encryptJson(key, updatedTask, taskAad(task.id, deviceId)),
    encryptJson(key, operation, outboxAad(operation.operationId, deviceId)),
    nextTask
      ? encryptJson(key, nextTask, taskAad(nextTask.id, deviceId))
      : null,
    nextOperation
      ? encryptJson(
          key,
          nextOperation,
          outboxAad(nextOperation.operationId, deviceId),
        )
      : null,
  ]);

  await fridayDb.transaction(
    'rw',
    fridayDb.tasks,
    fridayDb.outbox,
    async () => {
      await fridayDb.tasks.put({
        encrypted: encryptedTask,
        id: updatedTask.id,
        revision: updatedTask.revision,
        syncState: 'pending',
        updatedAt: updatedTask.updatedAt,
      });
      await fridayDb.outbox.put({
        createdAt: operation.clientCreatedAt,
        encryptedPayload: encryptedOperation,
        entityId: operation.entityId,
        operationId: operation.operationId,
        state: 'pending',
      });
      if (
        nextTask &&
        nextOperation &&
        encryptedNextTask &&
        encryptedNextOperation
      ) {
        await fridayDb.tasks.put({
          encrypted: encryptedNextTask,
          id: nextTask.id,
          revision: 0,
          syncState: 'pending',
          updatedAt: nextTask.updatedAt,
        });
        await fridayDb.outbox.put({
          createdAt: nextOperation.clientCreatedAt,
          encryptedPayload: encryptedNextOperation,
          entityId: nextTask.id,
          operationId: nextOperation.operationId,
          state: 'pending',
        });
      }
    },
  );

  return updatedTask;
}

export async function setLocalTaskStatus(
  taskId: string,
  status: TaskRecord['status'],
): Promise<TaskRecord> {
  return queueLocalTaskUpdate(
    taskId,
    (task) => {
      if (task.deletedAt) {
        throw new Error('Tâche introuvable.');
      }
      if (task.status === status) return null;
      return { ...task, status };
    },
    status === 'done',
  );
}

export async function updateLocalTask(
  taskId: string,
  input: UpdateLocalTaskInput,
): Promise<TaskRecord> {
  const title = normalizeTaskTitle(input.title);
  if (!title) throw new Error('Le titre est obligatoire.');

  return queueLocalTaskUpdate(taskId, (task) => {
    if (task.deletedAt) throw new Error('Tâche introuvable.');
    const dueDate = input.dueDate ?? null;
    if (task.recurrence !== null && dueDate === null) {
      throw new Error('Une occurrence récurrente doit conserver une date.');
    }
    return {
      ...task,
      title,
      dueDate,
      dueTime: dueDate ? (input.dueTime ?? null) : null,
      durationMinutes:
        dueDate && input.dueTime ? (input.durationMinutes ?? null) : null,
      assigneeProfileId: input.assigneeProfileId ?? null,
      note: normalizeTaskNote(input.note ?? ''),
    };
  });
}

export async function updateLocalTaskSeries(
  taskId: string,
  input: UpdateLocalTaskInput,
): Promise<number> {
  const title = normalizeTaskTitle(input.title);
  if (!title) throw new Error('Le titre est obligatoire.');
  const tasks = await listTasks();
  const selectedTask = tasks.find((task) => task.id === taskId);
  if (!selectedTask) throw new Error('Tâche introuvable.');
  if (
    selectedTask.recurrence === null ||
    typeof selectedTask.recurrence === 'string' ||
    !selectedTask.dueDate ||
    !input.dueDate
  ) {
    await updateLocalTask(taskId, input);
    return 1;
  }

  const recurrence = selectedTask.recurrence;
  const dayShift = localDateDifference(input.dueDate, selectedTask.dueDate);
  const seriesTasks = tasks.filter(
    (task) =>
      task.recurrence !== null &&
      typeof task.recurrence === 'object' &&
      task.recurrence.seriesId === recurrence.seriesId,
  );

  for (const task of seriesTasks) {
    const shiftedDate = task.dueDate
      ? shiftLocalDate(task.dueDate, dayShift)
      : input.dueDate;
    await queueLocalTaskUpdate(task.id, (storedTask) => ({
      ...storedTask,
      title,
      dueDate: shiftedDate,
      dueTime: input.dueTime ?? null,
      durationMinutes: input.dueTime ? (input.durationMinutes ?? null) : null,
      assigneeProfileId: input.assigneeProfileId ?? null,
      note: normalizeTaskNote(input.note ?? ''),
      recurrence:
        storedTask.recurrence && typeof storedTask.recurrence === 'object'
          ? {
              ...storedTask.recurrence,
              anchorDate: shiftLocalDate(
                storedTask.recurrence.anchorDate,
                dayShift,
              ),
              endDate: storedTask.recurrence.endDate
                ? shiftLocalDate(storedTask.recurrence.endDate, dayShift)
                : null,
            }
          : storedTask.recurrence,
    }));
  }
  return seriesTasks.length;
}

export async function deleteLocalTask(taskId: string): Promise<void> {
  await queueLocalTaskUpdate(taskId, (task, updatedAt) => {
    if (task.deletedAt) return null;
    return { ...task, deletedAt: updatedAt };
  });
}

export async function deleteLocalTaskSeries(taskId: string): Promise<number> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const selectedRow = await fridayDb.tasks.get(taskId);
  if (!selectedRow) throw new Error('Tâche introuvable.');

  const selectedTask = TaskRecordSchema.parse(
    await decryptJson<TaskRecord>(
      key,
      selectedRow.encrypted,
      taskAad(selectedRow.id, deviceId),
    ),
  );
  if (
    selectedTask.recurrence === null ||
    typeof selectedTask.recurrence === 'string'
  ) {
    await deleteLocalTask(taskId);
    return 1;
  }

  const seriesId = selectedTask.recurrence.seriesId;
  const rows = await fridayDb.tasks.toArray();
  const storedTasks = await Promise.all(
    rows.map(async (row) =>
      TaskRecordSchema.parse(
        await decryptJson<TaskRecord>(
          key,
          row.encrypted,
          taskAad(row.id, deviceId),
        ),
      ),
    ),
  );
  const seriesTasks = storedTasks
    .filter(
      (task) =>
        task.deletedAt === null &&
        task.recurrence !== null &&
        typeof task.recurrence === 'object' &&
        task.recurrence.seriesId === seriesId,
    )
    .toSorted(compareTasksBySchedule);
  const startedAt = Date.now();
  const deletionRows = await Promise.all(
    seriesTasks.map(async (task, index) => {
      const queuedOperations = await fridayDb.outbox
        .where('entityId')
        .equals(task.id)
        .and((operation) => ['pending', 'sent'].includes(operation.state))
        .toArray();
      const latestQueuedTimestamp = queuedOperations.reduce(
        (latest, operation) =>
          Math.max(latest, Date.parse(operation.createdAt)),
        0,
      );
      const updatedAt = new Date(
        Math.max(startedAt + index, latestQueuedTimestamp + 1),
      ).toISOString();
      const baseRevision =
        task.revision + (queuedOperations.length > 0 ? 1 : 0);
      const deletedTask = TaskRecordSchema.parse({
        ...task,
        deletedAt: updatedAt,
        deviceId,
        revision: baseRevision,
        updatedAt,
        updatedByProfileId: profileId,
      });
      const operation = TaskOperationSchema.parse({
        protocolVersion: 1,
        operationId: crypto.randomUUID(),
        deviceId,
        profileId,
        entityType: 'task',
        entityId: task.id,
        operation: 'upsert',
        baseRevision,
        clientCreatedAt: updatedAt,
        payload: deletedTask,
      });
      const [encryptedTask, encryptedOperation] = await Promise.all([
        encryptJson(key, deletedTask, taskAad(task.id, deviceId)),
        encryptJson(key, operation, outboxAad(operation.operationId, deviceId)),
      ]);
      return { deletedTask, encryptedOperation, encryptedTask, operation };
    }),
  );

  await fridayDb.transaction(
    'rw',
    fridayDb.tasks,
    fridayDb.outbox,
    async () => {
      await fridayDb.tasks.bulkPut(
        deletionRows.map(({ deletedTask, encryptedTask }) => ({
          encrypted: encryptedTask,
          id: deletedTask.id,
          revision: deletedTask.revision,
          syncState: 'pending' as const,
          updatedAt: deletedTask.updatedAt,
        })),
      );
      await fridayDb.outbox.bulkPut(
        deletionRows.map(({ encryptedOperation, operation }) => ({
          createdAt: operation.clientCreatedAt,
          encryptedPayload: encryptedOperation,
          entityId: operation.entityId,
          operationId: operation.operationId,
          state: 'pending' as const,
        })),
      );
    },
  );

  return deletionRows.length;
}

export async function listTasks(): Promise<LocalTask[]> {
  const { deviceId, key } = await getDeviceContext();
  const rows = await fridayDb.tasks.orderBy('updatedAt').reverse().toArray();
  const tasks = await Promise.all(
    rows.map(async (row) => {
      const task = TaskRecordSchema.parse(
        await decryptJson<TaskRecord>(
          key,
          row.encrypted,
          taskAad(row.id, deviceId),
        ),
      );
      return { ...task, syncState: row.syncState };
    }),
  );
  return tasks
    .filter((task) => task.deletedAt === null)
    .toSorted(compareTasksBySchedule);
}

export async function resetDatabaseForTests(): Promise<void> {
  await fridayDb.delete();
  await Dexie.waitFor(Promise.resolve());
}

export { getDeviceContext } from './device-context.js';
export {
  getOutboxCounts,
  markOperations,
  readPendingOperations,
} from './outbox-repository.js';
export { applyAcks, applyChanges, getCursor } from './sync-repository.js';
