import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fridayDb, FridayDatabase } from './friday-db.js';
import { encryptJson, decryptJson } from '../crypto/vault.js';
import { getLocalDeviceId } from '../auth/auth-client.js';
import {
  createLocalTask,
  getDeviceContext,
  listTasks,
  readPendingOperations,
  resetDatabaseForTests,
} from './task-repository.js';
import {
  createLocalGroceryItem,
  listGroceryItems,
} from './grocery-repository.js';

beforeEach(() => fridayDb.open());
afterEach(async () => {
  vi.restoreAllMocks();
  await resetDatabaseForTests();
});

it('keeps concurrent first writes and their outbox decryptable with one device identity', async () => {
  const [task, grocery, identity] = await Promise.all([
    createLocalTask('Première tâche'),
    createLocalGroceryItem({ label: 'Première course' }),
    getLocalDeviceId(),
  ]);
  expect(new Set([task.deviceId, grocery.deviceId, identity]).size).toBe(1);
  expect(await listTasks()).toHaveLength(1);
  expect(await listGroceryItems()).toHaveLength(1);
  expect(await readPendingOperations()).toHaveLength(2);
});

it('arbitrates delayed key generation and preserves a previously created identity', async () => {
  const identity = await getLocalDeviceId();
  const generate = crypto.subtle.generateKey.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'generateKey').mockImplementation(async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return generate(...args);
  });
  await Promise.all([
    createLocalTask('Une tâche'),
    createLocalGroceryItem({ label: 'Une course' }),
  ]);
  expect((await getDeviceContext()).deviceId).toBe(identity);
  expect(await listTasks()).toHaveLength(1);
  expect(await listGroceryItems()).toHaveLength(1);
  expect(await readPendingOperations()).toHaveLength(2);
});

it('never replaces the key of existing encrypted data', async () => {
  await createLocalTask('À conserver');
  const generate = vi.spyOn(crypto.subtle, 'generateKey');
  await Promise.all([
    getDeviceContext(),
    getDeviceContext(),
    getLocalDeviceId(),
  ]);
  expect(generate).not.toHaveBeenCalled();
  expect((await listTasks())[0]?.title).toBe('À conserver');
});

it('shares the winning key between independent IndexedDB connections', async () => {
  const other = new FridayDatabase(fridayDb.name);
  try {
    await other.open();
    const [first, second] = await Promise.all([
      getDeviceContext(fridayDb),
      getDeviceContext(other),
    ]);
    expect(first.deviceId).toBe(second.deviceId);
    const envelope = await encryptJson(
      first.key,
      { title: 'Deux connexions' },
      first.deviceId,
    );
    expect(await decryptJson(second.key, envelope, second.deviceId)).toEqual({
      title: 'Deux connexions',
    });
  } finally {
    other.close();
  }
});
