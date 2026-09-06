import type { Recipe, RecipeDraft } from '@friday/contracts';
import {
  listMaisonRecords,
  maisonFields,
  saveMaisonCommand,
} from '../../db/maison-repository.js';
import { productForLabel } from './products.js';

export async function saveRecipeDraft(
  draft: RecipeDraft,
  previous: Recipe | null,
  provenance: Recipe['provenance'] = 'manual',
  sources: Recipe['sources'] = [],
): Promise<void> {
  const records = await listMaisonRecords();
  const originalIds = new Set(records.map((r) => r.id));
  const ingredients: Recipe['ingredients'] = [];
  for (const i of draft.ingredients) {
    const product = await productForLabel(i.label, records);
    ingredients.push({
      id:
        previous?.ingredients.find(
          (p) =>
            p.productId === product.id &&
            !ingredients.some((line) => line.id === p.id),
        )?.id ?? crypto.randomUUID(),
      productId: product.id,
      quantity: i.quantity,
      note: i.note,
    });
  }
  const fields = await maisonFields();
  const recipe: Recipe = {
    ...fields,
    kind: 'recipe',
    recipeKey: previous?.recipeKey ?? fields.id,
    version: previous
      ? Math.max(
          ...records
            .filter(
              (r): r is Recipe =>
                r.kind === 'recipe' && r.recipeKey === previous.recipeKey,
            )
            .map((r) => r.version),
        ) + 1
      : 1,
    name: draft.name,
    portionsMilli: draft.portionsMilli,
    ingredients,
    steps: draft.steps,
    durationMinutes: draft.durationMinutes,
    notes: draft.notes,
    provenance,
    sources,
  };
  await saveMaisonCommand([
    ...records.filter((r) => !originalIds.has(r.id)),
    recipe,
  ]);
}
