import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fridayDb } from './friday-db.js';
import {
  createLocalGroceryItem,
  createLocalGroceryItems,
  deleteLocalGroceryItem,
  listGroceryItems,
  setLocalGroceryItemChecked,
  updateLocalGroceryItem,
} from './grocery-repository.js';
import {
  applyAcks,
  applyChanges,
  getCursor,
  readPendingOperations,
  resetDatabaseForTests,
} from './task-repository.js';

beforeEach(async () => {
  await fridayDb.open();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe('local grocery repository', () => {
  it('writes an encrypted grocery item and operation together', async () => {
    const item = await createLocalGroceryItem({
      label: '  Lait   demi-écrémé ',
      quantityText: ' 2 bouteilles ',
    });
    const [items, operations, rawItem] = await Promise.all([
      listGroceryItems(),
      readPendingOperations(),
      fridayDb.groceryItems.get(item.id),
    ]);

    expect(items[0]).toMatchObject({
      label: 'Lait demi-écrémé',
      quantityText: '2 bouteilles',
      checkedAt: null,
      syncState: 'pending',
    });
    expect(operations[0]).toMatchObject({
      entityType: 'grocery_item',
      entityId: item.id,
    });
    expect(JSON.stringify(rawItem?.encrypted)).not.toContain('Lait');
  });

  it('imports a photo transcription as one encrypted local batch without aisles', async () => {
    const items = await createLocalGroceryItems([
      { label: '  Fleur de sel ', quantityText: ' x2 ' },
      { label: 'Bananes vertes', quantityText: null },
    ]);
    const [storedItems, operations] = await Promise.all([
      listGroceryItems(),
      readPendingOperations(),
    ]);

    expect(items).toHaveLength(2);
    expect(storedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Fleur de sel',
          quantityText: 'x2',
          manualAisleId: null,
          manualStoreFamilyId: null,
        }),
        expect.objectContaining({
          label: 'Bananes vertes',
          quantityText: null,
          manualAisleId: null,
          manualStoreFamilyId: null,
        }),
      ]),
    );
    expect(operations).toHaveLength(2);
  });

  it('checks and reopens an item through ordered outbox operations', async () => {
    const item = await createLocalGroceryItem({ label: 'Pain' });

    await setLocalGroceryItemChecked(item.id, true);
    expect((await listGroceryItems())[0]?.checkedAt).not.toBeNull();

    await setLocalGroceryItemChecked(item.id, false);
    const operations = await readPendingOperations();

    expect((await listGroceryItems())[0]?.checkedAt).toBeNull();
    expect(operations).toHaveLength(3);
    expect(operations.map((operation) => operation.baseRevision)).toEqual([
      0, 1, 2,
    ]);
  });

  it('hides a deleted item while retaining its encrypted tombstone', async () => {
    const item = await createLocalGroceryItem({ label: 'Pommes' });

    await deleteLocalGroceryItem(item.id);

    expect(await listGroceryItems()).toHaveLength(0);
    expect(await fridayDb.groceryItems.get(item.id)).toMatchObject({
      syncState: 'pending',
    });
    expect(await readPendingOperations()).toHaveLength(2);
  });

  it('stores the acknowledged server revision for a grocery item', async () => {
    const item = await createLocalGroceryItem({ label: 'Café' });
    const [operation] = await readPendingOperations();
    if (!operation) throw new Error('Opération absente.');

    await applyAcks([
      {
        operationId: operation.operationId,
        entityId: item.id,
        status: 'applied',
        serverRevision: 1,
        conflictReason: null,
      },
    ]);

    expect((await listGroceryItems())[0]).toMatchObject({
      revision: 1,
      syncState: 'acknowledged',
    });
  });

  it('applies a remote grocery change and advances the shared cursor', async () => {
    const item = await createLocalGroceryItem({ label: 'Café' });

    await applyChanges(
      [
        {
          cursor: 7,
          entityType: 'grocery_item',
          entityId: item.id,
          operation: 'upsert',
          payload: {
            ...item,
            label: 'Café moulu',
            quantityText: '1 paquet',
            revision: 2,
            updatedAt: '2026-08-09T02:00:00.000Z',
          },
        },
      ],
      7,
    );

    expect((await listGroceryItems())[0]).toMatchObject({
      label: 'Café moulu',
      quantityText: '1 paquet',
      revision: 2,
      syncState: 'acknowledged',
    });
    expect(await getCursor()).toBe(7);
  });

  it('edits the product and manual aisle through the offline outbox', async () => {
    const item = await createLocalGroceryItem({ label: 'Yaourts' });

    await updateLocalGroceryItem(item.id, {
      label: 'Yaourts nature',
      quantityText: 'x 8',
      storeFamilyId: 'supermarket',
      aisleId: 'dairy-eggs',
    });

    expect((await listGroceryItems())[0]).toMatchObject({
      label: 'Yaourts nature',
      quantityText: 'x 8',
      manualStoreFamilyId: 'supermarket',
      manualAisleId: 'dairy-eggs',
      syncState: 'pending',
    });
    expect((await readPendingOperations()).at(-1)?.payload).toMatchObject({
      manualStoreFamilyId: 'supermarket',
      manualAisleId: 'dairy-eggs',
    });
  });
});
