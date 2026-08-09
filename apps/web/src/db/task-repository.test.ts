import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fridayDb } from './friday-db.js';
import {
  applyAcks,
  createLocalTask,
  deleteLocalTask,
  deleteLocalTaskSeries,
  listTasks,
  readPendingOperations,
  resetDatabaseForTests,
  setLocalTaskStatus,
} from './task-repository.js';
import {
  CURRENT_PROFILE_ID,
  OTHER_ADULT_PROFILE_ID,
} from '../task-assignee.js';

beforeEach(async () => {
  await fridayDb.open();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe('local task repository', () => {
  it('writes the encrypted task and outbox operation together', async () => {
    const task = await createLocalTask('  Acheter   du lait ');
    const [tasks, operations, rawTask] = await Promise.all([
      listTasks(),
      readPendingOperations(),
      fridayDb.tasks.get(task.id),
    ]);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('Acheter du lait');
    expect(tasks[0]?.syncState).toBe('pending');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.entityId).toBe(task.id);
    expect(JSON.stringify(rawTask?.encrypted)).not.toContain('Acheter du lait');
  });

  it('stores a date-only task and a timed appointment in the encrypted outbox', async () => {
    const datedTask = await createLocalTask({
      title: 'Renouveler assurance',
      dueDate: '2026-08-15',
      dueTime: null,
      durationMinutes: null,
    });
    const appointment = await createLocalTask({
      title: 'Rendez-vous dentiste',
      dueDate: '2026-08-16',
      dueTime: '14:30',
      durationMinutes: 45,
    });

    const [tasks, operations] = await Promise.all([
      listTasks(),
      readPendingOperations(),
    ]);

    expect(tasks.find((task) => task.id === datedTask.id)).toMatchObject({
      dueDate: '2026-08-15',
      dueTime: null,
      durationMinutes: null,
    });
    expect(tasks.find((task) => task.id === appointment.id)).toMatchObject({
      dueDate: '2026-08-16',
      dueTime: '14:30',
      durationMinutes: 45,
    });
    expect(
      operations.find((operation) => operation.entityId === appointment.id)
        ?.payload,
    ).toMatchObject({
      dueDate: '2026-08-16',
      dueTime: '14:30',
      durationMinutes: 45,
    });
  });

  it('stores the responsible profile in the encrypted task and outbox', async () => {
    const task = await createLocalTask({
      assigneeProfileId: CURRENT_PROFILE_ID,
      title: 'Préparer les documents',
    });

    const [tasks, operations] = await Promise.all([
      listTasks(),
      readPendingOperations(),
    ]);

    expect(tasks[0]).toMatchObject({
      id: task.id,
      assigneeProfileId: CURRENT_PROFILE_ID,
    });
    expect(operations[0]?.payload).toMatchObject({
      assigneeProfileId: CURRENT_PROFILE_ID,
    });
  });

  it('stores an optional note without requiring a date', async () => {
    await createLocalTask({
      title: 'Appeler le garage',
      note: 'Demander un devis',
    });
    const [task] = await listTasks();
    expect(task).toMatchObject({ dueDate: null, note: 'Demander un devis' });
  });

  it('attributes new local operations to the authenticated profile', async () => {
    await fridayDb.settings.put({
      key: 'currentProfileId',
      value: OTHER_ADULT_PROFILE_ID,
    });

    const task = await createLocalTask('Tâche du second adulte');
    const [operation] = await readPendingOperations();

    expect(task.createdByProfileId).toBe(OTHER_ADULT_PROFILE_ID);
    expect(operation?.profileId).toBe(OTHER_ADULT_PROFILE_ID);
  });

  it('materializes a bounded recurring series without duplicate on completion', async () => {
    const task = await createLocalTask({
      title: 'Arroser les plantes',
      dueDate: '2026-08-08',
      recurrence: { endDate: '2026-08-14', interval: 3, unit: 'day' },
      note: 'Vérifier la terre',
    });

    await setLocalTaskStatus(task.id, 'done');
    await setLocalTaskStatus(task.id, 'done');

    const tasks = await listTasks();
    expect(tasks).toHaveLength(3);
    expect(tasks.map(({ dueDate }) => dueDate)).toEqual([
      '2026-08-08',
      '2026-08-11',
      '2026-08-14',
    ]);
    expect(tasks[1]).toMatchObject({
      note: 'Vérifier la terre',
      recurrence: { interval: 3, unit: 'day' },
    });
    expect(await readPendingOperations()).toHaveLength(4);
  });

  it('hides a deleted task and queues an encrypted tombstone', async () => {
    const task = await createLocalTask('Rapporter le colis');

    await deleteLocalTask(task.id);

    const [tasks, operations, rawTask] = await Promise.all([
      listTasks(),
      readPendingOperations(),
      fridayDb.tasks.get(task.id),
    ]);
    const deletion = operations.find(
      (operation) => operation.payload.deletedAt !== null,
    );

    expect(tasks).toHaveLength(0);
    expect(operations).toHaveLength(2);
    expect(deletion?.baseRevision).toBe(1);
    expect(deletion?.payload.id).toBe(task.id);
    expect(operations.at(-1)?.operationId).toBe(deletion?.operationId);
    expect(rawTask?.syncState).toBe('pending');
    expect(JSON.stringify(rawTask?.encrypted)).not.toContain(
      'Rapporter le colis',
    );
  });

  it('can delete one occurrence without deleting its recurring series', async () => {
    await createLocalTask({
      title: 'Sortir les poubelles',
      dueDate: '2026-08-08',
      recurrence: { endDate: '2026-08-22', interval: 1, unit: 'week' },
    });
    const tasksBeforeDeletion = await listTasks();

    await deleteLocalTask(tasksBeforeDeletion[1]?.id ?? 'missing');

    const tasks = await listTasks();
    expect(tasks.map(({ dueDate }) => dueDate)).toEqual([
      '2026-08-08',
      '2026-08-22',
    ]);
    expect(await readPendingOperations()).toHaveLength(4);
  });

  it('deletes every occurrence of a recurring series in one local operation', async () => {
    await createLocalTask({
      title: 'Arroser les plantes',
      dueDate: '2026-08-08',
      recurrence: { endDate: '2026-08-14', interval: 3, unit: 'day' },
    });
    const tasksBeforeDeletion = await listTasks();

    const deletedCount = await deleteLocalTaskSeries(
      tasksBeforeDeletion[1]?.id ?? 'missing',
    );

    const operations = await readPendingOperations();
    const deletions = operations.filter(
      (operation) =>
        operation.entityType === 'task' && operation.payload.deletedAt !== null,
    );
    expect(deletedCount).toBe(3);
    expect(await listTasks()).toHaveLength(0);
    expect(operations).toHaveLength(6);
    expect(deletions).toHaveLength(3);
    expect(
      new Set(
        deletions.map((operation) =>
          operation.entityType === 'task' &&
          typeof operation.payload.recurrence === 'object'
            ? operation.payload.recurrence?.seriesId
            : null,
        ),
      ).size,
    ).toBe(1);
  });

  it('queues finishing and reopening through the same local transaction', async () => {
    const task = await createLocalTask('Étendre le linge');

    await setLocalTaskStatus(task.id, 'done');

    const [finishedTask] = await listTasks();
    const operationsAfterFinish = await readPendingOperations();
    expect(finishedTask).toMatchObject({
      id: task.id,
      status: 'done',
      syncState: 'pending',
    });
    expect(operationsAfterFinish).toHaveLength(2);
    expect(operationsAfterFinish.at(-1)).toMatchObject({
      baseRevision: 1,
      entityId: task.id,
      payload: { status: 'done' },
    });

    await setLocalTaskStatus(task.id, 'todo');

    const [reopenedTask] = await listTasks();
    const operationsAfterReopen = await readPendingOperations();
    expect(reopenedTask).toMatchObject({
      id: task.id,
      status: 'todo',
      syncState: 'pending',
    });
    expect(operationsAfterReopen).toHaveLength(3);
    expect(operationsAfterReopen.at(-1)).toMatchObject({
      baseRevision: 2,
      entityId: task.id,
      payload: { status: 'todo' },
    });
  });

  it('stores the acknowledged server revision before the next pull', async () => {
    const task = await createLocalTask('Préparer le dîner');
    const [operation] = await readPendingOperations();
    if (!operation) throw new Error('Opération de test absente.');

    await applyAcks([
      {
        operationId: operation.operationId,
        entityId: task.id,
        status: 'applied',
        serverRevision: 1,
        conflictReason: null,
      },
    ]);

    const [acknowledgedTask] = await listTasks();
    expect(acknowledgedTask?.revision).toBe(1);
    expect(acknowledgedTask?.syncState).toBe('acknowledged');
  });
});
