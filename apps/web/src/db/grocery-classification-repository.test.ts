import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fridayDb } from './friday-db.js';
import {
  applyGroceryClassificationChanges,
  getActiveGroceryClassificationJobId,
  getGroceryClassificationCursor,
  listGroceryClassifications,
  setActiveGroceryClassificationJobId,
} from './grocery-classification-repository.js';
import { resetDatabaseForTests } from './task-repository.js';

beforeEach(async () => {
  await fridayDb.open();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe('local grocery classification cache', () => {
  it('encrypts shared classifications and advances their separate cursor', async () => {
    const itemId = 'da166bcc-38c4-4a17-859f-7491e1b2312f';
    await applyGroceryClassificationChanges({
      cursor: 4,
      changes: [
        {
          cursor: 4,
          classification: {
            itemId,
            taxonomyId: 'retail-fr-v1',
            storeFamilyId: 'supermarket',
            aisleId: 'dairy-eggs',
            source: 'manual',
            confidence: 1,
            itemRevision: 1,
            labelFingerprint:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            revision: 1,
            updatedAt: '2026-08-09T12:00:00.000Z',
            updatedByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
          },
        },
      ],
    });

    const raw = await fridayDb.groceryClassifications.get(itemId);
    expect(JSON.stringify(raw?.encrypted)).not.toContain('dairy-eggs');
    expect(await listGroceryClassifications()).toEqual([
      expect.objectContaining({ itemId, aisleId: 'dairy-eggs' }),
    ]);
    expect(await getGroceryClassificationCursor()).toBe(4);
  });

  it('remembers and clears the durable hub job identifier', async () => {
    const jobId = '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb';
    await setActiveGroceryClassificationJobId(jobId);
    expect(await getActiveGroceryClassificationJobId()).toBe(jobId);

    await setActiveGroceryClassificationJobId(null);
    expect(await getActiveGroceryClassificationJobId()).toBeNull();
  });
});
