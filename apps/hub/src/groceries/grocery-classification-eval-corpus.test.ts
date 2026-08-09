import { describe, expect, it } from 'vitest';

import { GroceryClassificationChoiceSchema } from '@friday/contracts';

import { GROCERY_CLASSIFICATION_EVAL_CORPUS } from './grocery-classification-eval-corpus.js';
import { classifyKnownGroceryLabel } from './grocery-classification-rules.js';

describe('French grocery classification evaluation corpus', () => {
  it('contains 150 unique and taxonomy-valid household labels', () => {
    expect(GROCERY_CLASSIFICATION_EVAL_CORPUS).toHaveLength(150);
    expect(
      new Set(
        GROCERY_CLASSIFICATION_EVAL_CORPUS.map((entry) =>
          entry.label.toLocaleLowerCase('fr-FR'),
        ),
      ).size,
    ).toBe(150);
    for (const entry of GROCERY_CLASSIFICATION_EVAL_CORPUS) {
      expect(
        GroceryClassificationChoiceSchema.safeParse({
          storeFamilyId: entry.storeFamilyId,
          aisleId: entry.aisleId,
        }).success,
      ).toBe(true);
    }
  });

  it('keeps common-product rules above the hybrid accuracy floor', () => {
    const matches = GROCERY_CLASSIFICATION_EVAL_CORPUS.map((entry) => ({
      actual: classifyKnownGroceryLabel(entry.label),
      expected: entry,
    }));
    const familyAccuracy =
      matches.filter(
        ({ actual, expected }) =>
          actual?.storeFamilyId === expected.storeFamilyId,
      ).length / matches.length;
    const aisleAccuracy =
      matches.filter(
        ({ actual, expected }) =>
          actual?.storeFamilyId === expected.storeFamilyId &&
          actual.aisleId === expected.aisleId,
      ).length / matches.length;

    expect(familyAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(aisleAccuracy).toBeGreaterThanOrEqual(0.8);
  });
});
