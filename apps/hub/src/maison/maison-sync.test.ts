import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  fixtures,
  fields,
  command,
} from '../../../../tests/fixtures/maison.js';
import { openDatabase, migrateDatabase } from '../db/database.js';
import { SyncService } from '../sync/sync-service.js';
import { readMaisonRecords } from './maison-sync.js';
import type { MaisonRecord } from '@friday/contracts';

describe('Maison transactional sync', () => {
  it('keeps a composite command together at a pull page boundary', () => {
    const db = openDatabase(':memory:');
    try {
      const sync = new SyncService(db);
      const { product } = fixtures();
      const products = (n: number) =>
        Array.from({ length: n }, () => ({ ...product, ...fields() }));
      sync.push([
        command(products(250)),
        command(products(200)),
        command(products(100)),
      ]);
      const first = sync.pull(0, true);
      expect(first.changes).toHaveLength(450);
      expect(first.cursor).toBe(450);
      const second = sync.pull(first.cursor, true);
      expect(second.changes).toHaveLength(100);
      expect(second.cursor).toBe(550);
      expect(sync.pull(0).changes).toHaveLength(0);
      expect(sync.pull(0).cursor).toBe(450);
    } finally {
      db.close();
    }
  });
  it('rejects the second device spending the same stock and preserves the first movement', () => {
    const db = openDatabase(':memory:');
    try {
      const sync = new SyncService(db);
      const { product, stock } = fixtures();
      const initial: MaisonRecord = {
        ...fields(),
        kind: 'movement',
        stockId: stock.id,
        reason: 'initial',
        before: null,
        after: stock.quantity,
        sourceId: null,
        compensatesId: null,
      };
      expect(
        sync.push([command([product, stock, initial])]).acks[0]?.status,
      ).toBe('applied');
      const current = readMaisonRecords(db).find((r) => r.id === stock.id)!;
      const next = {
        ...current,
        quantity: { milli: 100000, unit: 'g' },
      } as MaisonRecord;
      const movement: MaisonRecord = {
        ...fields(),
        kind: 'movement',
        stockId: stock.id,
        reason: 'prepare',
        before: stock.quantity,
        after: { milli: 100000, unit: 'g' },
        sourceId: null,
        compensatesId: null,
      };
      expect(sync.push([command([next, movement])]).acks[0]?.status).toBe(
        'applied',
      );
      expect(
        sync.push([command([next, { ...movement, ...fields() }])]).acks[0]
          ?.status,
      ).toBe('conflict');
      expect(
        readMaisonRecords(db).filter((r) => r.kind === 'movement'),
      ).toHaveLength(2);
      expect(
        readMaisonRecords(db).find((r) => r.id === stock.id),
      ).toMatchObject({ quantity: { milli: 100000 }, revision: 2 });
    } finally {
      db.close();
    }
  });
  it('applies and replays a command once, with legacy-compatible change filtering', () => {
    const db = openDatabase(':memory:');
    try {
      const sync = new SyncService(db);
      const { product, recipe, prep, meal, meal2 } = fixtures();
      const op = command([product, recipe, prep, meal, meal2]);
      expect(sync.push([op]).acks[0]?.status).toBe('applied');
      expect(sync.push([op]).acks[0]?.status).toBe('applied');
      expect(readMaisonRecords(db)).toHaveLength(5);
      expect(sync.pull(0).changes).toHaveLength(0);
      expect(sync.pull(0).cursor).toBe(5);
      expect(sync.pull(0, true).changes).toHaveLength(5);
    } finally {
      db.close();
    }
  });
  it('rolls back groceries and records together on a concurrent revision conflict', () => {
    const db = openDatabase(':memory:');
    try {
      const sync = new SyncService(db);
      const { product } = fixtures();
      sync.push([command([product])]);
      const op = command(
        [{ ...product, name: 'Stale' }],
        [
          {
            id: crypto.randomUUID(),
            baseRevision: 0,
            label: 'Do not insert',
            quantityText: null,
            deleted: false,
          },
        ],
      );
      expect(sync.push([op]).acks[0]?.status).toBe('conflict');
      expect(readMaisonRecords(db)[0]).toMatchObject({ name: product.name });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM grocery_items').get(),
      ).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
  it('requires a movement for stock quantities, and retains movements immutably', () => {
    const db = openDatabase(':memory:');
    try {
      const sync = new SyncService(db);
      const { product, stock } = fixtures();
      expect(sync.push([command([product, stock])]).acks[0]?.status).toBe(
        'conflict',
      );
      const movement: MaisonRecord = {
        ...fields(),
        kind: 'movement',
        stockId: stock.id,
        reason: 'initial',
        before: null,
        after: stock.quantity,
        sourceId: null,
        compensatesId: null,
      };
      expect(
        sync.push([command([product, stock, movement])]).acks[0]?.status,
      ).toBe('applied');
      expect(
        sync.push([command([{ ...movement, revision: 1 }])]).acks[0]?.status,
      ).toBe('conflict');
      const current = readMaisonRecords(db).find((r) => r.id === stock.id)!;
      expect(
        sync.push([
          command([
            { ...current, quantity: { milli: 0, unit: 'g' } } as MaisonRecord,
          ]),
        ]).acks[0]?.status,
      ).toBe('conflict');
    } finally {
      db.close();
    }
  });
  it('rejects duplicate receipt keys even from another operation', () => {
    const db = openDatabase(':memory:');
    try {
      const sync = new SyncService(db);
      const checkedAt = '2026-09-05T12:00:00.000Z';
      const g = fields();
      db.prepare(
        'INSERT INTO grocery_items(id, household_id, revision, label, quantity_text, checked_at, created_at, updated_at, created_by_profile_id, updated_by_profile_id, device_id, schema_version) VALUES (?,?,1,?,NULL,?,?,?,?,?,?,1)',
      ).run(
        g.id,
        g.householdId,
        'Eau',
        checkedAt,
        checkedAt,
        checkedAt,
        g.createdByProfileId,
        g.updatedByProfileId,
        g.deviceId,
      );
      const receipt: MaisonRecord = {
        ...fields(),
        kind: 'receipt',
        groceryItemId: g.id,
        checkedAt,
        stockId: null,
        ignored: true,
      };
      expect(sync.push([command([receipt])]).acks[0]?.status).toBe('applied');
      expect(
        sync.push([command([{ ...receipt, ...fields() }])]).acks[0]?.status,
      ).toBe('conflict');
      expect(readMaisonRecords(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });
  it('migrates from 44 without changing existing tasks and restores a coherent backup', async () => {
    const db = new Database(':memory:');
    try {
      migrateDatabase(db, 44);
      const prior = db
        .prepare('SELECT COUNT(*) AS n FROM schema_migrations')
        .get();
      expect(prior).toEqual({ n: 44 });
      migrateDatabase(db);
      expect(
        db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get(),
      ).toEqual({ v: 47 });
      const restored = new Database(db.serialize());
      try {
        expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
        expect(restored.pragma('foreign_key_check')).toEqual([]);
        expect(readMaisonRecords(restored)).toEqual([]);
      } finally {
        restored.close();
      }
    } finally {
      db.close();
    }
  });
});
