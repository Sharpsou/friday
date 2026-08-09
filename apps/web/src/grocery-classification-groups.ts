import {
  GROCERY_TAXONOMY,
  type GroceryClassificationRecord,
} from '@friday/contracts';

import type { LocalGroceryItem } from './db/grocery-repository.js';

export interface GroceryAisleGroup {
  id: string;
  label: string;
  familyLabel: string | null;
  items: LocalGroceryItem[];
}

export function groupGroceriesByAisle(
  items: readonly LocalGroceryItem[],
  classifications: readonly GroceryClassificationRecord[],
): GroceryAisleGroup[] {
  const classificationByItem = new Map(
    classifications.map((classification) => [
      classification.itemId,
      classification,
    ]),
  );
  const itemsByGroup = new Map<string, LocalGroceryItem[]>();
  for (const item of items) {
    const classification = classificationByItem.get(item.id);
    const key =
      item.manualStoreFamilyId && item.manualAisleId
        ? `${item.manualStoreFamilyId}:${item.manualAisleId}`
        : classification
          ? `${classification.storeFamilyId}:${classification.aisleId}`
          : 'other:unclassified';
    const group = itemsByGroup.get(key) ?? [];
    group.push(item);
    itemsByGroup.set(key, group);
  }

  const groups: GroceryAisleGroup[] = [];
  for (const family of GROCERY_TAXONOMY) {
    for (const [aisleId, aisleLabel] of family.aisles) {
      const id = `${family.id}:${aisleId}`;
      const groupedItems = itemsByGroup.get(id);
      if (!groupedItems) continue;
      groups.push({
        id,
        label: aisleLabel,
        familyLabel: family.id === 'supermarket' ? null : family.label,
        items: groupedItems,
      });
    }
  }
  return groups;
}
