import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GroceryClassificationChoice } from '@friday/contracts';

import { openDatabase } from '../db/database.js';
import { GroceryClassificationService } from './grocery-classification-service.js';
import type { GroceryClassificationEngine } from './ollama-classification-engine.js';

const HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';
const PROFILE_ID = 'f61f8f8b-8d09-4575-8e83-357618e881ac';
const DEVICE_ID = '5945057a-0b59-4d3b-814f-9581be697098';
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function seedGrocery(
  database: ReturnType<typeof openDatabase>,
  id: string,
  label: string,
  revision = 1,
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO grocery_items (
         id, household_id, revision, label, quantity_text, checked_at,
         created_at, updated_at, deleted_at, created_by_profile_id,
         updated_by_profile_id, device_id, schema_version
       ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, 1)`,
    )
    .run(
      id,
      HOUSEHOLD_ID,
      revision,
      label,
      now,
      now,
      PROFILE_ID,
      PROFILE_ID,
      DEVICE_ID,
    );
}

class ProduceEngine implements GroceryClassificationEngine {
  calls: string[][] = [];

  classify(labels: readonly string[]) {
    this.calls.push([...labels]);
    return Promise.resolve(
      labels.map(() => ({
        storeFamilyId: 'supermarket',
        aisleId: 'produce',
        confidence: 0.92,
      })),
    );
  }
}

class BlockingEngine implements GroceryClassificationEngine {
  started = Promise.resolve();
  private notifyStarted: (() => void) | null = null;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.notifyStarted = resolve;
    });
  }

  classify(
    _labels: readonly string[],
    signal: AbortSignal,
  ): Promise<Array<GroceryClassificationChoice & { confidence: number }>> {
    this.notifyStarted?.();
    return new Promise((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });
  }
}

describe('persistent grocery classification service', () => {
  it('applies a correctable proposal idempotently and learns exact labels', async () => {
    const database = openDatabase(':memory:');
    const engine = new ProduceEngine();
    const service = new GroceryClassificationService(database, engine);
    const milkId = 'da166bcc-38c4-4a17-859f-7491e1b2312f';
    const appleId = 'df64ced6-0f31-4492-975f-19d3b138ce05';
    seedGrocery(database, milkId, 'Lait');
    seedGrocery(database, appleId, 'Pommes');

    const started = service.createOrGetActiveJob(HOUSEHOLD_ID, PROFILE_ID);
    await vi.waitFor(() =>
      expect(service.getJob(HOUSEHOLD_ID, started.id).status).toBe('completed'),
    );
    const completed = service.getJob(HOUSEHOLD_ID, started.id);
    const response = service.apply(HOUSEHOLD_ID, PROFILE_ID, {
      jobId: started.id,
      classifications: (completed.proposal ?? []).map((item) => ({
        itemId: item.itemId,
        expectedClassificationRevision: item.expectedClassificationRevision,
        storeFamilyId: 'supermarket',
        aisleId: item.itemId === milkId ? 'dairy-eggs' : item.aisleId,
      })),
    });
    const repeated = service.apply(HOUSEHOLD_ID, PROFILE_ID, {
      jobId: started.id,
      classifications: [],
    });

    expect(response.classifications).toHaveLength(2);
    expect(response.classifications).toContainEqual(
      expect.objectContaining({
        itemId: milkId,
        aisleId: 'dairy-eggs',
        source: 'manual',
      }),
    );
    expect(repeated).toEqual(response);
    expect(service.pull(HOUSEHOLD_ID, 0).changes).toHaveLength(2);

    const secondMilkId = 'd63b7237-dd8d-48bf-b561-1e6a30a5b46b';
    seedGrocery(database, secondMilkId, '  LAIT  ');
    const learnedJob = service.createOrGetActiveJob(HOUSEHOLD_ID, PROFILE_ID);
    await vi.waitFor(() =>
      expect(service.getJob(HOUSEHOLD_ID, learnedJob.id).status).toBe(
        'completed',
      ),
    );
    expect(
      service
        .getJob(HOUSEHOLD_ID, learnedJob.id)
        .proposal?.find((item) => item.itemId === secondMilkId),
    ).toMatchObject({ aisleId: 'dairy-eggs', source: 'rule' });
    expect(service.getJob(HOUSEHOLD_ID, learnedJob.id).proposal).toHaveLength(
      1,
    );

    const firstClassifications = service.pull(HOUSEHOLD_ID, 0).changes;
    expect(firstClassifications).toHaveLength(2);
    expect(firstClassifications).toContainEqual(
      expect.objectContaining({
        classification: expect.objectContaining({
          itemId: milkId,
          aisleId: 'dairy-eggs',
          source: 'manual',
        }),
      }),
    );

    await service.stop();
    database.close();
  });

  it('only proposes unclassified products and preserves a direct manual aisle', async () => {
    const database = openDatabase(':memory:');
    const engine = new ProduceEngine();
    const service = new GroceryClassificationService(database, engine);
    const manualItemId = 'a85cac6b-d927-42f2-bd5d-334ac84a1df5';
    const newItemId = '4a4477ec-d374-4317-9c74-545d999bbb5f';
    seedGrocery(database, manualItemId, 'Vis inox');
    database
      .prepare(
        `UPDATE grocery_items
            SET manual_store_family_id = 'diy', manual_aisle_id = 'hardware'
          WHERE id = ?`,
      )
      .run(manualItemId);
    seedGrocery(database, newItemId, 'Produit secret beta');

    const started = service.createOrGetActiveJob(HOUSEHOLD_ID, PROFILE_ID);
    await vi.waitFor(() =>
      expect(service.getJob(HOUSEHOLD_ID, started.id).status).toBe('completed'),
    );

    expect(service.getJob(HOUSEHOLD_ID, started.id).proposal).toEqual([
      expect.objectContaining({ itemId: newItemId }),
    ]);
    expect(engine.calls).toEqual([['Produit secret beta']]);

    await service.stop();
    database.close();
  });

  it('cancels a running model call without saving a partial proposal', async () => {
    const database = openDatabase(':memory:');
    const engine = new BlockingEngine();
    const service = new GroceryClassificationService(database, engine);
    seedGrocery(
      database,
      'da166bcc-38c4-4a17-859f-7491e1b2312f',
      'Produit secret Nouchka',
    );

    const started = service.createOrGetActiveJob(HOUSEHOLD_ID, PROFILE_ID);
    await engine.started;
    expect(service.cancelJob(HOUSEHOLD_ID, started.id).status).toBe(
      'cancelling',
    );
    await vi.waitFor(() =>
      expect(service.getJob(HOUSEHOLD_ID, started.id).status).toBe('cancelled'),
    );

    expect(service.getJob(HOUSEHOLD_ID, started.id).proposal).toBeNull();
    expect(service.pull(HOUSEHOLD_ID, 0).changes).toEqual([]);
    await service.stop();
    database.close();
  });

  it('requeues a running job after a hub restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'friday-classification-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'friday.sqlite');
    const firstDatabase = openDatabase(databasePath);
    const blockingEngine = new BlockingEngine();
    const firstService = new GroceryClassificationService(
      firstDatabase,
      blockingEngine,
    );
    seedGrocery(
      firstDatabase,
      'da166bcc-38c4-4a17-859f-7491e1b2312f',
      'Produit secret alpha',
    );
    const started = firstService.createOrGetActiveJob(HOUSEHOLD_ID, PROFILE_ID);
    await blockingEngine.started;
    await firstService.stop();
    firstDatabase.close();

    const secondDatabase = openDatabase(databasePath);
    const secondService = new GroceryClassificationService(
      secondDatabase,
      new ProduceEngine(),
    );
    await vi.waitFor(() =>
      expect(secondService.getJob(HOUSEHOLD_ID, started.id).status).toBe(
        'completed',
      ),
    );

    expect(
      secondService.getJob(HOUSEHOLD_ID, started.id).proposal,
    ).toHaveLength(1);
    await secondService.stop();
    secondDatabase.close();
  });
});
