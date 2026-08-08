import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fridayDb } from './friday-db.js';
import {
  applyAcks,
  createLocalTask,
  deleteLocalTask,
  listTasks,
  readPendingOperations,
  resetDatabaseForTests,
} from './task-repository.js';

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
