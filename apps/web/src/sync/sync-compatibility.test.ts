import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SyncOperation } from '@friday/contracts';
import { fridayDb } from '../db/friday-db.js';
import {
  createLocalTask,
  readPendingOperations,
  resetDatabaseForTests,
} from '../db/task-repository.js';
import { bootstrapMaison } from '../db/maison-repository.js';
import { saveRecipeDraft } from '../maison-actions.js';
import { syncNow } from './sync-client.js';

beforeEach(() => fridayDb.open());
afterEach(async () => {
  vi.unstubAllGlobals();
  await resetDatabaseForTests();
});

it.each([1, 101])(
  'syncs supported domains after a Hub rollback with %i Maison commands then resumes their original IDs',
  async (maisonCount) => {
    let maison = true;
    const accepted: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.includes('maison-snapshot'))
          return Response.json(
            { records: [], cursor: 0 },
            { status: maison ? 200 : 404 },
          );
        if (input.includes('/push')) {
          const { operations } = JSON.parse(String(init?.body)) as {
            operations: SyncOperation[];
          };
          if (
            !maison &&
            operations.some((op) => op.entityType === 'maison_command')
          )
            return Response.json({}, { status: 400 });
          accepted.push(...operations.map((op) => op.operationId));
          return Response.json({
            cursor: 0,
            acks: operations.map((op) => ({
              operationId: op.operationId,
              entityId: op.entityId,
              status: 'applied',
              serverRevision: 1,
              conflictReason: null,
            })),
          });
        }
        return Response.json({ changes: [], cursor: 0 });
      }),
    );
    await bootstrapMaison(new AbortController().signal);
    for (let index = 0; index < maisonCount; index += 1)
      await saveRecipeDraft(
        {
          name: 'Soupe',
          portionsMilli: 1000,
          ingredients: [],
          steps: '',
          notes: '',
          durationMinutes: null,
        },
        null,
      );
    await createLocalTask('Tâche pendant rollback');
    const original = await readPendingOperations();
    maison = false;
    await syncNow();
    const pending = await readPendingOperations();
    expect(pending).toHaveLength(maisonCount);
    expect(pending.every((op) => op.entityType === 'maison_command')).toBe(
      true,
    );
    maison = true;
    for (let index = 0; index < Math.ceil(maisonCount / 100); index += 1)
      await syncNow();
    expect(await readPendingOperations()).toEqual([]);
    expect(accepted.sort()).toEqual(
      original.map((op) => op.operationId).sort(),
    );
  },
);

it('does not hide a validation failure from a Hub that still supports Maison', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) =>
      input.includes('/push')
        ? Response.json({}, { status: 400 })
        : Response.json({ records: [], cursor: 0 }),
    ),
  );
  await bootstrapMaison(new AbortController().signal);
  await saveRecipeDraft(
    {
      name: 'Soupe',
      portionsMilli: 1000,
      ingredients: [],
      steps: '',
      notes: '',
      durationMinutes: null,
    },
    null,
  );
  await expect(syncNow()).rejects.toThrow('400');
  expect(await readPendingOperations()).toHaveLength(1);
});
