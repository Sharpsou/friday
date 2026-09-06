import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import type {
  Recipe,
  StockEntry,
  Preparation,
  MealSlot,
  MaisonRecord,
} from '@friday/contracts';
import { fridayDb, FridayDatabase } from './friday-db.js';
import {
  listMaisonRecords,
  maisonFields,
  saveMaisonCommand,
  listMaisonConflicts,
  acceptMaisonServer,
  bootstrapMaison,
} from './maison-repository.js';
import {
  resetDatabaseForTests,
  readPendingOperations,
  applyAcks,
  applyChanges,
} from './task-repository.js';
import {
  saveRecipeDraft,
  receivePurchases,
  saveStock,
  applyShoppingDecisions,
  confirmPreparation,
  eatMeal,
} from '../maison-actions.js';
import {
  createLocalGroceryItem,
  setLocalGroceryItemChecked,
  listGroceryItems,
} from './grocery-repository.js';

beforeEach(async () => {
  await fridayDb.open();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await resetDatabaseForTests();
});
async function recipe() {
  await saveRecipeDraft(
    {
      name: 'Pâtes',
      portionsMilli: 2000,
      ingredients: [
        {
          label: 'Pâtes sèches',
          quantity: { milli: 200000, unit: 'g' },
          note: '',
        },
      ],
      steps: '',
      notes: '',
      durationMinutes: null,
    },
    null,
  );
  return (await listMaisonRecords()).find(
    (r): r is Recipe => r.kind === 'recipe',
  )!;
}
describe('Maison encrypted outbox and actions', () => {
  it('applies a remote Maison and grocery batch with its cursor in one transaction', async () => {
    await recipe();
    const product = (await listMaisonRecords()).find(
      (r) => r.kind === 'product',
    )!;
    const grocery = await createLocalGroceryItem({
      label: 'À conserver',
      quantityText: null,
    });
    await applyAcks(
      (await readPendingOperations()).map((op) => ({
        operationId: op.operationId,
        entityId: op.entityId,
        status: 'applied',
        serverRevision: 1,
        conflictReason: null,
      })),
    );
    const before = await listMaisonRecords();
    const fail = vi
      .spyOn(fridayDb.groceryItems, 'put')
      .mockRejectedValueOnce(new DOMException('Quota', 'QuotaExceededError'));
    await expect(
      applyChanges(
        [
          {
            cursor: 1,
            entityType: 'maison_record',
            entityId: product.id,
            operation: 'upsert',
            payload: { ...product, revision: 2 },
          },
          {
            cursor: 2,
            entityType: 'grocery_item',
            entityId: grocery.id,
            operation: 'upsert',
            payload: { ...grocery, label: 'Nouvelle course', revision: 2 },
          },
        ],
        2,
      ),
    ).rejects.toThrow();
    fail.mockRestore();
    expect(await listMaisonRecords()).toEqual(before);
    expect((await listGroceryItems())[0]?.label).toBe('À conserver');
    expect((await fridayDb.settings.get('cursor'))?.value).not.toBe(2);
  });
  it('bootstraps new domains without clearing a pending outbox or advancing its cursor', async () => {
    await recipe();
    const pending = await fridayDb.outbox.toArray();
    await fridayDb.settings.put({ key: 'cursor', value: 500 });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ records: [], cursor: 900, version: 1 }),
            { status: 200 },
          ),
      ),
    );
    expect(await bootstrapMaison(new AbortController().signal)).toBe(true);
    expect(await fridayDb.outbox.toArray()).toEqual(pending);
    expect((await fridayDb.settings.get('cursor'))?.value).toBe(500);
    expect(await listMaisonRecords()).toHaveLength(2);
  });
  it('keeps Maison operations pending against an older Hub', async () => {
    await recipe();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    expect(await bootstrapMaison(new AbortController().signal)).toBe(false);
    expect(await readPendingOperations()).toHaveLength(1);
  });
  it('reconciles an entire rejected command without losing its encrypted history or unrelated pending data', async () => {
    await recipe();
    const operation = (await readPendingOperations())[0]!;
    await applyAcks([
      {
        operationId: operation.operationId,
        entityId: operation.entityId,
        status: 'conflict',
        serverRevision: 0,
        conflictReason: 'revision_mismatch',
      },
    ]);
    const separate = await createLocalGroceryItem({
      label: 'Garder cette course',
      quantityText: null,
    });
    const command = (await listMaisonConflicts())[0]!;
    const encrypted = (await fridayDb.outbox.get(operation.operationId))!
      .encryptedPayload;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ cursor: 0, records: [], groceries: [] }),
            { status: 200 },
          ),
      ),
    );
    await acceptMaisonServer(command);
    expect(await listMaisonConflicts()).toHaveLength(0);
    expect(await listMaisonRecords()).toHaveLength(0);
    expect(
      (await fridayDb.outbox.get(operation.operationId))?.encryptedPayload,
    ).toEqual(encrypted);
    expect((await listGroceryItems()).some((g) => g.id === separate.id)).toBe(
      true,
    );
    expect(await readPendingOperations()).toHaveLength(1);
  });
  it('migrates Dexie 8 to 9 without changing queued ciphertext', async () => {
    const name = `maison-migration-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    const schemas = Object.fromEntries(
      fridayDb.tables
        .filter((t) => !t.name.startsWith('maison'))
        .map((t) => [
          t.name,
          [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(
            ',',
          ),
        ]),
    );
    old.version(8).stores(schemas);
    await old.open();
    const queued = {
      operationId: crypto.randomUUID(),
      entityId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      state: 'pending',
      encryptedPayload: { ciphertext: 'preserve-byte-for-byte' },
    };
    await old.table('outbox').put(queued);
    old.close();
    const upgraded = new FridayDatabase(name);
    try {
      await upgraded.open();
      expect(upgraded.verno).toBe(9);
      expect(await upgraded.outbox.get(queued.operationId)).toEqual(queued);
      expect(await upgraded.maisonRecords.count()).toBe(0);
    } finally {
      upgraded.close();
      await Dexie.delete(name);
    }
  });
  it('rolls back records and outbox on a local quota failure', async () => {
    const insert = vi
      .spyOn(fridayDb.outbox, 'put')
      .mockRejectedValueOnce(new DOMException('Quota', 'QuotaExceededError'));
    await expect(recipe()).rejects.toThrow();
    expect(await listMaisonRecords()).toHaveLength(0);
    expect(await fridayDb.outbox.count()).toBe(0);
    insert.mockRestore();
  });
  it('writes recipe and product atomically and never stores clear recipe text', async () => {
    await recipe();
    const records = await listMaisonRecords();
    expect(records).toHaveLength(2);
    const operations = await readPendingOperations();
    expect(operations).toHaveLength(1);
    expect(operations[0]?.entityType).toBe('maison_command');
    expect(
      JSON.stringify(await fridayDb.maisonRecords.toArray()),
    ).not.toContain('Pâtes');
    expect(JSON.stringify(await fridayDb.outbox.toArray())).not.toContain(
      'Pâtes',
    );
    expect(await listMaisonRecords()).toEqual(records);
  });
  it('keeps a new version and the existing ingredient product identity', async () => {
    const old = await recipe();
    await saveRecipeDraft(
      {
        name: old.name,
        portionsMilli: 4000,
        ingredients: [
          { label: 'Pâtes sèches', quantity: null, note: 'Au goût' },
        ],
        steps: '',
        notes: '',
        durationMinutes: null,
      },
      old,
    );
    const records = await listMaisonRecords();
    expect(records.filter((r) => r.kind === 'product')).toHaveLength(1);
    expect(records.filter((r) => r.kind === 'recipe')).toHaveLength(2);
    expect(records.find((r) => r.id === old.id)).toMatchObject({
      portionsMilli: 2000,
    });
  });
  it('does not overwrite a pending local change with an older server snapshot', async () => {
    const r = await recipe();
    const changed = { ...r, revision: 0, name: 'Stale server' };
    await applyChanges(
      [
        {
          cursor: 1,
          entityType: 'maison_record',
          entityId: r.id,
          operation: 'upsert',
          payload: changed,
        },
      ],
      1,
    );
    expect(
      (await listMaisonRecords()).find((x) => x.id === r.id),
    ).toMatchObject({ name: 'Pâtes', revision: 1 });
  });
  it('retains the complete conflicting batch and marks it for review', async () => {
    await recipe();
    const op = (await readPendingOperations())[0]!;
    await applyAcks([
      {
        operationId: op.operationId,
        entityId: op.entityId,
        status: 'conflict',
        serverRevision: 0,
        conflictReason: 'revision_mismatch',
      },
    ]);
    expect(await listMaisonConflicts()).toHaveLength(1);
    expect(
      await fridayDb.maisonRecords
        .where('syncState')
        .equals('conflict')
        .count(),
    ).toBe(2);
  });
  it('receives an actual purchase only once without inventing a quantity', async () => {
    const g = await createLocalGroceryItem({
      label: 'Eau',
      quantityText: 'un pack',
    });
    await setLocalGroceryItemChecked(g.id, true);
    const bought = (await listGroceryItems())[0]!;
    const input = [
      {
        item: bought,
        label: 'Eau',
        quantity: null,
        location: 'dry' as const,
        ignored: false,
      },
    ];
    await receivePurchases(input);
    await receivePurchases(input);
    const records = await listMaisonRecords();
    expect(records.filter((r) => r.kind === 'receipt')).toHaveLength(1);
    expect(records.filter((r) => r.kind === 'stock')).toHaveLength(1);
    expect(records.find((r) => r.kind === 'stock')).toMatchObject({
      quantity: null,
      status: 'present',
    });
  });
  it('consolidates two contributions and updates a repeated shopping preview without duplication', async () => {
    const r = await recipe();
    const productId = r.ingredients[0]!.productId;
    const inputs = [1, 2].map((n) => ({
      originKey: `test:${n}`,
      productId,
      preparationId: null,
      ingredientId: null,
      label: 'Pâtes sèches',
      quantity: { milli: 100000, unit: 'g' as const },
      excluded: false,
    }));
    await applyShoppingDecisions(inputs, []);
    const groceries = await listGroceryItems();
    expect(groceries).toHaveLength(1);
    expect(groceries[0]?.quantityText).toBe('200 g');
    await applyShoppingDecisions(inputs, groceries);
    expect(await listGroceryItems()).toHaveLength(1);
    expect((await listGroceryItems())[0]?.quantityText).toBe('200 g');
    await applyShoppingDecisions(
      [{ ...inputs[0]!, quantity: { milli: 50000, unit: 'g' } }],
      await listGroceryItems(),
    );
    expect((await listGroceryItems())[0]?.quantityText).toBe('150 g');
  });
  it('does not change a manually linked grocery', async () => {
    const r = await recipe();
    const g = await createLocalGroceryItem({
      label: 'Mon paquet habituel',
      quantityText: '1',
    });
    await applyShoppingDecisions(
      [
        {
          originKey: 'manual:1',
          productId: r.ingredients[0]!.productId,
          preparationId: null,
          ingredientId: null,
          label: 'Pâtes sèches',
          quantity: { milli: 100000, unit: 'g' },
          excluded: false,
          existingGroceryId: g.id,
        },
      ],
      await listGroceryItems(),
    );
    expect((await listGroceryItems())[0]).toMatchObject({
      label: 'Mon paquet habituel',
      quantityText: '1',
    });
  });
  it('recalculates the previous group when a contribution changes unit', async () => {
    const r = await recipe();
    const d = {
      originKey: 'unit:1',
      productId: r.ingredients[0]!.productId,
      preparationId: null,
      ingredientId: null,
      label: 'Pâtes sèches',
      quantity: { milli: 100000, unit: 'g' as const },
      excluded: false,
    };
    await applyShoppingDecisions([d, { ...d, originKey: 'unit:2' }], []);
    await applyShoppingDecisions(
      [{ ...d, quantity: { milli: 1000, unit: 'pack' } }],
      await listGroceryItems(),
    );
    const items = (await listGroceryItems()).filter((g) => !g.deletedAt);
    expect(items).toHaveLength(2);
    expect(items.map((g) => g.quantityText).sort()).toEqual([
      '1 paquet(s)',
      '100 g',
    ]);
  });
  it('prepares six portions, eats three twice, and records the ingredient consumption once', async () => {
    const r = await recipe();
    const productId = r.ingredients[0]!.productId;
    const stock: StockEntry = {
      ...(await maisonFields()),
      kind: 'stock',
      productId,
      preparationId: null,
      label: 'Pâtes sèches',
      quantity: { milli: 1000000, unit: 'g' },
      location: 'dry',
      status: 'present',
      confirmedAt: new Date().toISOString(),
      expiresOn: null,
      threshold: null,
    };
    await saveStock(stock);
    const currentStock = (await listMaisonRecords()).find(
      (x) => x.id === stock.id,
    ) as StockEntry;
    const p: Preparation = {
      ...(await maisonFields()),
      kind: 'preparation',
      recipeId: r.id,
      date: '2026-09-07',
      portionsMilli: 6000,
      actualPortionsMilli: null,
      status: 'planned',
    };
    const m: MealSlot = {
      ...(await maisonFields()),
      kind: 'meal',
      date: p.date,
      slot: 'dinner',
      people: 3,
      status: 'planned',
      servings: [{ preparationId: p.id, portionsMilli: 3000 }],
    };
    const m2: MealSlot = {
      ...m,
      ...(await maisonFields()),
      date: '2026-09-08',
    };
    await saveMaisonCommand([p, m, m2]);
    const records = await listMaisonRecords();
    await confirmPreparation(
      records.find((x) => x.id === p.id) as Preparation,
      6000,
      [{ stockId: currentStock.id, milli: 600000 }],
      m.id,
      'fridge',
    );
    let next = await listMaisonRecords();
    expect(next.find((x) => x.id === stock.id)).toMatchObject({
      quantity: { milli: 400000 },
    });
    expect(
      next.find((x) => x.kind === 'stock' && x.preparationId === p.id),
    ).toMatchObject({ quantity: { milli: 3000 } });
    await eatMeal(next.find((x) => x.id === m2.id) as MealSlot);
    next = await listMaisonRecords();
    expect(
      next.find((x) => x.kind === 'stock' && x.preparationId === p.id),
    ).toMatchObject({ quantity: { milli: 0 }, status: 'empty' });
    await expect(
      eatMeal(next.find((x) => x.id === m2.id) as MealSlot),
    ).rejects.toThrow(/déjà/iu);
    expect(
      next.filter(
        (x) =>
          x.kind === 'movement' &&
          x.stockId === stock.id &&
          x.reason === 'prepare',
      ),
    ).toHaveLength(1);
  });
  it('rolls back a composite local write if validation fails', async () => {
    const r = await recipe();
    const old = await listMaisonRecords();
    await expect(
      saveMaisonCommand([
        {
          ...r,
          id: crypto.randomUUID(),
          kind: 'preparation',
          recipeId: crypto.randomUUID(),
          date: '2026-09-05',
          portionsMilli: 0,
        } as unknown as MaisonRecord,
      ]),
    ).rejects.toThrow();
    expect(await listMaisonRecords()).toEqual(old);
  });
});
