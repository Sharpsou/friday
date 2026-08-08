import Dexie from 'dexie';

import {
  TaskOperationSchema,
  TaskRecordSchema,
  type Change,
  type OperationAck,
  type TaskOperation,
  type TaskRecord,
} from '@friday/contracts';
import { normalizeTaskTitle } from '@friday/domain';

import {
  decryptJson,
  encryptJson,
  generateDeviceKey,
} from '../crypto/vault.js';
import { fridayDb, type OutboxRow, type TaskRow } from './friday-db.js';

const HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';
const PROFILE_ID = 'f61f8f8b-8d09-4575-8e83-357618e881ac';

interface DeviceContext {
  deviceId: string;
  key: CryptoKey;
}

export type LocalTask = TaskRecord & {
  syncState: TaskRow['syncState'];
};

function taskAad(taskId: string, deviceId: string): string {
  return `tasks:${taskId}:1:${deviceId}`;
}

function outboxAad(operationId: string, deviceId: string): string {
  return `outbox:${operationId}:1:${deviceId}`;
}

export async function getDeviceContext(): Promise<DeviceContext> {
  const storedDeviceId = (await fridayDb.settings.get('deviceId'))?.value;
  const deviceId =
    typeof storedDeviceId === 'string' ? storedDeviceId : crypto.randomUUID();
  if (typeof storedDeviceId !== 'string') {
    await fridayDb.settings.put({ key: 'deviceId', value: deviceId });
  }

  let key = (await fridayDb.keys.get('device-aes-key'))?.value;
  if (!key) {
    key = await generateDeviceKey();
    await fridayDb.keys.put({ id: 'device-aes-key', value: key });
  }

  return { deviceId, key };
}

export async function createLocalTask(titleInput: string): Promise<TaskRecord> {
  const title = normalizeTaskTitle(titleInput);
  if (!title) {
    throw new Error('Le titre est obligatoire.');
  }

  const { deviceId, key } = await getDeviceContext();
  const now = new Date().toISOString();
  const task = TaskRecordSchema.parse({
    id: crypto.randomUUID(),
    householdId: HOUSEHOLD_ID,
    revision: 0,
    title,
    dueDate: null,
    assigneeProfileId: null,
    recurrence: null,
    note: null,
    status: 'todo',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdByProfileId: PROFILE_ID,
    updatedByProfileId: PROFILE_ID,
    deviceId,
    schemaVersion: 1,
  });
  const operation = TaskOperationSchema.parse({
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    deviceId,
    profileId: PROFILE_ID,
    entityType: 'task',
    entityId: task.id,
    operation: 'upsert',
    baseRevision: 0,
    clientCreatedAt: now,
    payload: task,
  });

  const [encryptedTask, encryptedOperation] = await Promise.all([
    encryptJson(key, task, taskAad(task.id, deviceId)),
    encryptJson(key, operation, outboxAad(operation.operationId, deviceId)),
  ]);

  await fridayDb.transaction(
    'rw',
    fridayDb.tasks,
    fridayDb.outbox,
    async () => {
      await fridayDb.tasks.put({
        encrypted: encryptedTask,
        id: task.id,
        revision: task.revision,
        syncState: 'pending',
        updatedAt: task.updatedAt,
      });
      await fridayDb.outbox.put({
        createdAt: operation.clientCreatedAt,
        encryptedPayload: encryptedOperation,
        entityId: task.id,
        operationId: operation.operationId,
        state: 'pending',
      });
    },
  );

  return task;
}

async function queueLocalTaskUpdate(
  taskId: string,
  update: (task: TaskRecord, updatedAt: string) => TaskRecord | null,
): Promise<TaskRecord> {
  const { deviceId, key } = await getDeviceContext();
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
    updatedByProfileId: PROFILE_ID,
    deviceId,
  });
  const operation = TaskOperationSchema.parse({
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    deviceId,
    profileId: PROFILE_ID,
    entityType: 'task',
    entityId: task.id,
    operation: 'upsert',
    baseRevision,
    clientCreatedAt: now,
    payload: updatedTask,
  });
  const [encryptedTask, encryptedOperation] = await Promise.all([
    encryptJson(key, updatedTask, taskAad(task.id, deviceId)),
    encryptJson(key, operation, outboxAad(operation.operationId, deviceId)),
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
    },
  );

  return updatedTask;
}

export async function setLocalTaskStatus(
  taskId: string,
  status: TaskRecord['status'],
): Promise<TaskRecord> {
  return queueLocalTaskUpdate(taskId, (task) => {
    if (task.deletedAt) {
      throw new Error('Tâche introuvable.');
    }
    if (task.status === status) return null;
    return { ...task, status };
  });
}

export async function deleteLocalTask(taskId: string): Promise<void> {
  await queueLocalTaskUpdate(taskId, (task, updatedAt) => {
    if (task.deletedAt) return null;
    return { ...task, deletedAt: updatedAt };
  });
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
  return tasks.filter((task) => task.deletedAt === null);
}

export async function readPendingOperations(): Promise<TaskOperation[]> {
  const { deviceId, key } = await getDeviceContext();
  const rows = await fridayDb.outbox
    .where('state')
    .anyOf(['pending', 'sent'])
    .sortBy('createdAt');
  return Promise.all(
    rows.map(async (row) =>
      TaskOperationSchema.parse(
        await decryptJson<TaskOperation>(
          key,
          row.encryptedPayload,
          outboxAad(row.operationId, deviceId),
        ),
      ),
    ),
  );
}

export async function markOperations(
  operationIds: readonly string[],
  state: OutboxRow['state'],
): Promise<void> {
  await fridayDb.transaction('rw', fridayDb.outbox, async () => {
    await Promise.all(
      operationIds.map(async (operationId) =>
        fridayDb.outbox.update(operationId, { state }),
      ),
    );
  });
}

export async function applyAcks(acks: readonly OperationAck[]): Promise<void> {
  const { deviceId, key } = await getDeviceContext();
  const taskUpdates = await Promise.all(
    acks.map(async (ack) => {
      const row = await fridayDb.tasks.get(ack.entityId);
      if (!row) return null;
      if (ack.status === 'conflict') {
        return {
          id: ack.entityId,
          encrypted: row.encrypted,
          revision: row.revision,
          syncState: 'conflict' as const,
        };
      }

      const task = TaskRecordSchema.parse(
        await decryptJson<TaskRecord>(
          key,
          row.encrypted,
          taskAad(row.id, deviceId),
        ),
      );
      const acknowledgedTask = TaskRecordSchema.parse({
        ...task,
        revision: ack.serverRevision,
      });
      return {
        id: ack.entityId,
        encrypted: await encryptJson(
          key,
          acknowledgedTask,
          taskAad(row.id, deviceId),
        ),
        revision: ack.serverRevision,
        syncState: 'acknowledged' as const,
      };
    }),
  );

  await fridayDb.transaction(
    'rw',
    fridayDb.outbox,
    fridayDb.tasks,
    async () => {
      for (const [index, ack] of acks.entries()) {
        const syncState =
          ack.status === 'applied' ? 'acknowledged' : 'conflict';
        const taskUpdate = taskUpdates[index];
        await fridayDb.outbox.update(ack.operationId, { state: syncState });
        if (taskUpdate) {
          await fridayDb.tasks.update(taskUpdate.id, {
            encrypted: taskUpdate.encrypted,
            revision: taskUpdate.revision,
            syncState: taskUpdate.syncState,
          });
        }
      }
    },
  );
}

export async function applyChanges(
  changes: readonly Change[],
  cursor: number,
): Promise<void> {
  const { deviceId, key } = await getDeviceContext();
  const rows: TaskRow[] = await Promise.all(
    changes.map(async (change) => ({
      encrypted: await encryptJson(
        key,
        change.payload,
        taskAad(change.entityId, deviceId),
      ),
      id: change.entityId,
      revision: change.payload.revision,
      syncState: 'acknowledged' as const,
      updatedAt: change.payload.updatedAt,
    })),
  );

  await fridayDb.transaction(
    'rw',
    fridayDb.tasks,
    fridayDb.settings,
    async () => {
      if (rows.length > 0) {
        await fridayDb.tasks.bulkPut(rows);
      }
      await fridayDb.settings.put({ key: 'cursor', value: cursor });
    },
  );
}

export async function getCursor(): Promise<number> {
  const value = (await fridayDb.settings.get('cursor'))?.value;
  return typeof value === 'number' ? value : 0;
}

export async function getOutboxCounts(): Promise<{
  conflicts: number;
  pending: number;
}> {
  const [pending, sent, conflicts] = await Promise.all([
    fridayDb.outbox.where('state').equals('pending').count(),
    fridayDb.outbox.where('state').equals('sent').count(),
    fridayDb.outbox.where('state').equals('conflict').count(),
  ]);
  return { conflicts, pending: pending + sent };
}

export async function resetDatabaseForTests(): Promise<void> {
  await fridayDb.delete();
  await Dexie.waitFor(Promise.resolve());
}
