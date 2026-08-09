import { describe, expect, it } from 'vitest';

import type { GroceryClassificationRecord } from '@friday/contracts';

import type { LocalGroceryItem } from './db/grocery-repository.js';
import { groupGroceriesByAisle } from './grocery-classification-groups.js';

function grocery(
  id: string,
  label: string,
  profileId: string,
): LocalGroceryItem {
  return {
    id,
    householdId: '1030b4f6-1e0f-48fa-adab-865750ce597d',
    revision: 1,
    label,
    quantityText: null,
    checkedAt: null,
    createdAt: '2026-08-09T12:00:00.000Z',
    updatedAt: '2026-08-09T12:00:00.000Z',
    deletedAt: null,
    createdByProfileId: profileId,
    updatedByProfileId: profileId,
    deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
    schemaVersion: 1,
    syncState: 'acknowledged',
  };
}

function classification(
  itemId: string,
  aisleId: string,
): GroceryClassificationRecord {
  return {
    itemId,
    taxonomyId: 'retail-fr-v1',
    storeFamilyId: 'supermarket',
    aisleId,
    source: 'llm',
    confidence: 0.9,
    itemRevision: 1,
    labelFingerprint:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    revision: 1,
    updatedAt: '2026-08-09T12:00:00.000Z',
    updatedByProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
  };
}

describe('grocery aisle grouping', () => {
  it('merges both profiles in generic aisle order and leaves new items last', () => {
    const firstProfile = 'f61f8f8b-8d09-4575-8e83-357618e881ac';
    const secondProfile = '2d45be8d-aa45-4c41-8d25-b8c553fc6367';
    const apples = grocery(
      'da166bcc-38c4-4a17-859f-7491e1b2312f',
      'Pommes',
      firstProfile,
    );
    const pears = grocery(
      'df64ced6-0f31-4492-975f-19d3b138ce05',
      'Poires',
      secondProfile,
    );
    const milk = grocery(
      'd63b7237-dd8d-48bf-b561-1e6a30a5b46b',
      'Lait',
      firstProfile,
    );
    const addedLater = grocery(
      '3f103ee8-07a2-42fc-8f49-aa97db9b3653',
      'Mystère maison',
      secondProfile,
    );

    const groups = groupGroceriesByAisle(
      [milk, addedLater, pears, apples],
      [
        classification(apples.id, 'produce'),
        classification(pears.id, 'produce'),
        classification(milk.id, 'dairy-eggs'),
      ],
    );

    expect(groups.map((group) => group.label)).toEqual([
      'Fruits et légumes',
      'Laitages et œufs',
      'À classer',
    ]);
    expect(groups[0]?.items.map((item) => item.label)).toEqual([
      'Poires',
      'Pommes',
    ]);
  });
});
