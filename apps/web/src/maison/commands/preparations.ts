import type {
  MaisonRecord,
  MealSlot,
  Preparation,
  StockEntry,
} from '@friday/contracts';
import { ingredientNeeds } from '@friday/domain';
import {
  listMaisonRecords,
  maisonFields,
  saveMaisonCommand,
} from '../../db/maison-repository.js';
import { stockMovement } from './stock.js';

export async function confirmPreparation(
  preparation: Preparation,
  portions: number,
  uses: Array<{ stockId: string; milli: number }>,
  immediateMealId: string | null,
  location: StockEntry['location'],
): Promise<void> {
  const records = await listMaisonRecords();
  if (preparation.status !== 'planned')
    throw new Error('Cette préparation a déjà été traitée.');
  const recipe = records.find((r) => r.id === preparation.recipeId);
  if (recipe?.kind !== 'recipe') throw new Error('Recette absente.');
  const writes: MaisonRecord[] = [];
  const seen = new Set<string>();
  for (const use of uses) {
    if (seen.has(use.stockId)) throw new Error('Réserve dupliquée.');
    seen.add(use.stockId);
    const stock = records.find(
      (r): r is StockEntry => r.kind === 'stock' && r.id === use.stockId,
    );
    if (!stock?.quantity || use.milli > stock.quantity.milli || use.milli < 0)
      throw new Error('La quantité utilisée dépasse la réserve.');
    const next = {
      ...stock,
      quantity: { ...stock.quantity, milli: stock.quantity.milli - use.milli },
      confirmedAt: new Date().toISOString(),
      status:
        use.milli === stock.quantity.milli ? ('empty' as const) : stock.status,
    };
    writes.push(
      next,
      await stockMovement(stock, next, 'prepare', preparation.id),
    );
  }
  let immediate = 0;
  if (immediateMealId) {
    const meal = records.find(
      (r): r is MealSlot => r.kind === 'meal' && r.id === immediateMealId,
    );
    if (
      !meal ||
      meal.status !== 'planned' ||
      meal.servings.some((s) => s.preparationId !== preparation.id)
    )
      throw new Error(
        'Confirmez séparément ce repas composé de plusieurs préparations.',
      );
    immediate = meal.servings.reduce((n, s) => n + s.portionsMilli, 0);
    writes.push({ ...meal, status: 'eaten' });
  }
  if (immediate > portions) throw new Error('Portions insuffisantes.');
  const leftover: StockEntry = {
    ...(await maisonFields()),
    kind: 'stock',
    preparationId: preparation.id,
    productId: null,
    label: recipe.name,
    quantity: { milli: portions - immediate, unit: 'portion' },
    location,
    status: portions === immediate ? 'empty' : 'present',
    confirmedAt: new Date().toISOString(),
    expiresOn: null,
    threshold: null,
  };
  writes.push(
    { ...preparation, status: 'prepared', actualPortionsMilli: portions },
    leftover,
    await stockMovement(leftover, leftover, 'prepare', preparation.id),
  );
  await saveMaisonCommand(writes);
}

export async function eatMeal(meal: MealSlot): Promise<void> {
  if (meal.status !== 'planned') throw new Error('Ce repas a déjà été traité.');
  const records = await listMaisonRecords();
  const writes: MaisonRecord[] = [{ ...meal, status: 'eaten' }];
  for (const serving of meal.servings) {
    let remaining = serving.portionsMilli;
    for (const stock of records.filter(
      (r): r is StockEntry =>
        r.kind === 'stock' &&
        r.preparationId === serving.preparationId &&
        !r.deletedAt,
    )) {
      if (!stock.quantity || !remaining) continue;
      const take = Math.min(remaining, stock.quantity.milli);
      remaining -= take;
      const next: StockEntry = {
        ...stock,
        quantity: { ...stock.quantity, milli: stock.quantity.milli - take },
        status: stock.quantity.milli === take ? 'empty' : stock.status,
        confirmedAt: new Date().toISOString(),
      };
      writes.push(next, await stockMovement(stock, next, 'eat', meal.id));
    }
    if (remaining)
      throw new Error(
        'Confirmez la préparation ou corrigez les restes disponibles.',
      );
  }
  await saveMaisonCommand(writes);
}

export function defaultPreparationUses(
  records: readonly MaisonRecord[],
  preparationId: string,
  today: string,
) {
  const uses = new Map<string, number>();
  for (const need of ingredientNeeds(records, today).filter(
    (n) => n.preparationId === preparationId,
  ))
    for (const a of need.allocations)
      uses.set(a.stockId, (uses.get(a.stockId) ?? 0) + a.quantity.milli);
  return [...uses].map(([stockId, milli]) => ({ stockId, milli }));
}
