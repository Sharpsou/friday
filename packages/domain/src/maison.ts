import type {
  MaisonRecord,
  MaisonQuantity,
  MaisonUnit,
  Product,
  Recipe,
  Preparation,
  MealSlot,
  StockEntry,
  GroceryItemRecord,
  ShoppingCoverage,
} from '@friday/contracts';

export const MAISON_HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';
export const LOCATION_LABELS = {
  fridge: 'Frigo',
  freezer: 'Congélateur',
  dry: 'Sec',
  produce: 'Fruits et légumes',
  household: 'Entretien et hygiène',
} as const;
export const UNIT_LABELS = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  piece: 'pièce(s)',
  pack: 'paquet(s)',
  portion: 'portion(s)',
  tbsp: 'c. à soupe',
  tsp: 'c. à café',
} as const;
export function parseMilli(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,3})?$/u.test(normalized))
    throw new Error('Quantité positive, avec au plus trois décimales.');
  const [whole = '0', fraction = ''] = normalized.split('.');
  const result = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(result) || result > 1_000_000_000_000)
    throw new Error('Quantité trop grande.');
  return result;
}
export function displayMilli(milli: number): string {
  return (milli / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}
export function quantityLabel(q: MaisonQuantity | null): string {
  return q ? `${displayMilli(q.milli)} ${UNIT_LABELS[q.unit]}` : 'À vérifier';
}
export function scaleMilli(
  amount: number,
  numerator: number,
  denominator: number,
): number {
  if (denominator <= 0) throw new Error('Portions de référence manquantes.');
  const result =
    (BigInt(amount) * BigInt(numerator) + BigInt(denominator) / 2n) /
    BigInt(denominator);
  if (result > 1_000_000_000_000n)
    throw new Error('Quantité calculée trop grande.');
  return Number(result);
}
export function convertQuantity(
  q: MaisonQuantity,
  to: MaisonUnit,
  product?: Product,
): MaisonQuantity | null {
  if (q.unit === to) return q;
  const units: Partial<
    Record<MaisonUnit, { dimension: string; factor: number }>
  > = {
    g: { dimension: 'mass', factor: 1 },
    kg: { dimension: 'mass', factor: 1000 },
    ml: { dimension: 'volume', factor: 1 },
    l: { dimension: 'volume', factor: 1000 },
  };
  const fromUnit = units[q.unit];
  const toUnit = units[to];
  if (fromUnit && toUnit && fromUnit.dimension === toUnit.dimension)
    return {
      unit: to,
      milli: scaleMilli(q.milli, fromUnit.factor, toUnit.factor),
    };
  const direct = product?.conversions.find(
    (c) => c.from === q.unit && c.to === to,
  );
  if (direct)
    return { unit: to, milli: scaleMilli(q.milli, direct.factorMilli, 1000) };
  const reverse = product?.conversions.find(
    (c) => c.to === q.unit && c.from === to,
  );
  return reverse
    ? { unit: to, milli: scaleMilli(q.milli, 1000, reverse.factorMilli) }
    : null;
}
export function activeRecords(
  records: readonly MaisonRecord[],
): MaisonRecord[] {
  return records.filter((r) => !r.deletedAt);
}
export function latestRecipes(records: readonly MaisonRecord[]): Recipe[] {
  const latest = new Map<string, Recipe>();
  for (const r of records)
    if (
      r.kind === 'recipe' &&
      r.version > (latest.get(r.recipeKey)?.version ?? 0)
    )
      latest.set(r.recipeKey, r);
  return [...latest.values()]
    .filter((r) => !r.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
export function validateMaisonState(records: readonly MaisonRecord[]): void {
  const active = activeRecords(records);
  const byId = new Map(active.map((r) => [r.id, r]));
  const allocated = new Map<string, number>();
  const mealKeys = new Set<string>();
  const originKeys = new Set<string>();
  const receiptKeys = new Set<string>();
  function requireKind(id: string, kind: MaisonRecord['kind']) {
    if (byId.get(id)?.kind !== kind)
      throw new Error('Référence Maison absente ou supprimée.');
  }
  for (const r of active) {
    if (r.kind === 'product') {
      const pairs = new Set<string>();
      for (const c of r.conversions) {
        const key = [c.from, c.to].sort().join(':');
        if (c.from === c.to || pairs.has(key))
          throw new Error('Correspondance d’unités dupliquée ou inutile.');
        pairs.add(key);
        const standard = convertQuantity({ unit: c.from, milli: 1000 }, c.to);
        if (standard && standard.milli !== c.factorMilli)
          throw new Error(
            'Cette correspondance contredit les unités usuelles.',
          );
      }
    }
    if (r.kind === 'recipe') {
      for (const i of r.ingredients) requireKind(i.productId, 'product');
      if (new Set(r.ingredients.map((i) => i.id)).size !== r.ingredients.length)
        throw new Error('Ingrédient dupliqué.');
    }
    if (r.kind === 'preparation') {
      requireKind(r.recipeId, 'recipe');
      if ((r.status === 'prepared') !== (r.actualPortionsMilli !== null))
        throw new Error('Portions préparées incohérentes.');
    }
    if (r.kind === 'meal' && r.status !== 'cancelled') {
      const key = `${r.date}:${r.slot}`;
      if (mealKeys.has(key)) throw new Error('Ce repas existe déjà.');
      mealKeys.add(key);
      if (r.status === 'outside' && r.servings.length)
        throw new Error('Un repas extérieur ne consomme pas de préparation.');
      if (
        new Set(r.servings.map((s) => s.preparationId)).size !==
        r.servings.length
      )
        throw new Error('Préparation dupliquée dans le repas.');
      for (const s of r.servings) {
        requireKind(s.preparationId, 'preparation');
        const p = byId.get(s.preparationId) as Preparation;
        if (p.status === 'cancelled') throw new Error('Préparation annulée.');
        if (p.date > r.date)
          throw new Error('Le repas précède sa préparation.');
        if (r.status === 'eaten' && p.status !== 'prepared')
          throw new Error('Confirmez la préparation avant le repas.');
        allocated.set(p.id, (allocated.get(p.id) ?? 0) + s.portionsMilli);
      }
    }
    if (r.kind === 'stock') {
      if (r.productId) requireKind(r.productId, 'product');
      if (r.preparationId) {
        requireKind(r.preparationId, 'preparation');
        if ((byId.get(r.preparationId) as Preparation).status !== 'prepared')
          throw new Error('Les restes exigent une préparation confirmée.');
        if (r.quantity?.unit !== 'portion')
          throw new Error('Les restes se comptent en portions.');
      }
      if (r.status === 'empty' && r.quantity && r.quantity.milli !== 0)
        throw new Error('Une réserve épuisée doit être à zéro.');
    }
    if (r.kind === 'movement') requireKind(r.stockId, 'stock');
    if (r.kind === 'coverage') {
      requireKind(r.productId, 'product');
      if (originKeys.has(r.originKey)) throw new Error('Besoin déjà couvert.');
      originKeys.add(r.originKey);
    }
    if (r.kind === 'receipt') {
      if (r.stockId) requireKind(r.stockId, 'stock');
      const key = `${r.groceryItemId}:${r.checkedAt}`;
      if (receiptKeys.has(key)) throw new Error('Cet achat est déjà rangé.');
      receiptKeys.add(key);
    }
  }
  for (const p of active)
    if (p.kind === 'preparation' && p.status === 'prepared') {
      const remaining = active
        .filter(
          (r): r is StockEntry =>
            r.kind === 'stock' && r.preparationId === p.id,
        )
        .reduce((n, r) => n + (r.quantity?.milli ?? 0), 0);
      const eaten = active
        .filter((r): r is MealSlot => r.kind === 'meal' && r.status === 'eaten')
        .flatMap((r) => r.servings)
        .filter((s) => s.preparationId === p.id)
        .reduce((n, s) => n + s.portionsMilli, 0);
      if (remaining + eaten > p.actualPortionsMilli!)
        throw new Error(
          'Les restes et les repas mangés dépassent les portions réellement préparées.',
        );
    }
  for (const [id, portions] of allocated) {
    const p = byId.get(id) as Preparation;
    if (portions > (p.actualPortionsMilli ?? p.portionsMilli))
      throw new Error('Les repas dépassent les portions disponibles.');
    if (p.status === 'prepared') {
      const future = active
        .filter(
          (r): r is MealSlot => r.kind === 'meal' && r.status === 'planned',
        )
        .flatMap((r) => r.servings)
        .filter((s) => s.preparationId === id)
        .reduce((n, s) => n + s.portionsMilli, 0);
      const remaining = active
        .filter(
          (r): r is StockEntry => r.kind === 'stock' && r.preparationId === id,
        )
        .reduce((n, s) => n + (s.quantity?.milli ?? 0), 0);
      if (future > remaining)
        throw new Error(
          'Les restes ne suffisent plus aux repas prévus. Ajustez les repas dans le même bilan.',
        );
    }
  }
}

export interface IngredientNeed {
  originKey: string;
  preparationId: string;
  ingredientId: string;
  productId: string;
  label: string;
  quantity: MaisonQuantity | null;
  reserved: number;
  missing: MaisonQuantity | null;
  note: string;
  allocations: Array<{ stockId: string; quantity: MaisonQuantity }>;
}
/** Allocate every planned preparation before filtering a shopping period. No stock is mutated. */
export function ingredientNeeds(
  records: readonly MaisonRecord[],
  today: string,
): IngredientNeed[] {
  const active = activeRecords(records);
  const byId = new Map(active.map((r) => [r.id, r]));
  const stock = active
    .filter(
      (r): r is StockEntry =>
        r.kind === 'stock' &&
        r.productId !== null &&
        r.quantity !== null &&
        r.status !== 'check' &&
        r.status !== 'empty' &&
        (!r.expiresOn || r.expiresOn >= today),
    )
    .sort(
      (a, b) =>
        (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') ||
        a.id.localeCompare(b.id),
    );
  const remaining = new Map(stock.map((s) => [s.id, s.quantity!.milli]));
  const result: IngredientNeed[] = [];
  const preparations = active
    .filter(
      (r): r is Preparation =>
        r.kind === 'preparation' && r.status === 'planned',
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const p of preparations) {
    const recipe = byId.get(p.recipeId);
    if (recipe?.kind !== 'recipe') continue;
    for (const line of recipe.ingredients) {
      const product = byId.get(line.productId);
      if (product?.kind !== 'product') continue;
      const quantity = line.quantity
        ? {
            ...line.quantity,
            milli: scaleMilli(
              line.quantity.milli,
              p.portionsMilli,
              recipe.portionsMilli,
            ),
          }
        : null;
      let outstanding = quantity?.milli ?? 0;
      const allocations: IngredientNeed['allocations'] = [];
      if (quantity)
        for (const s of stock) {
          if (s.productId !== product.id) continue;
          const available = {
            unit: s.quantity!.unit,
            milli: remaining.get(s.id) ?? 0,
          };
          const converted = convertQuantity(available, quantity.unit, product);
          if (!converted) continue;
          const take = Math.min(outstanding, converted.milli);
          if (!take) continue;
          const source = convertQuantity(
            { milli: take, unit: quantity.unit },
            available.unit,
            product,
          );
          if (!source || source.milli === 0) continue;
          remaining.set(s.id, Math.max(0, available.milli - source.milli));
          allocations.push({ stockId: s.id, quantity: source });
          outstanding -= take;
        }
      result.push({
        originKey: `${p.id}:${line.id}`,
        preparationId: p.id,
        ingredientId: line.id,
        productId: product.id,
        label: product.name,
        quantity,
        reserved: (quantity?.milli ?? 0) - outstanding,
        missing: quantity ? { ...quantity, milli: outstanding } : null,
        note: line.note,
        allocations,
      });
    }
  }
  return result;
}
export function preparationsForPeriod(
  records: readonly MaisonRecord[],
  from: string,
  to: string,
  slots: readonly MealSlot['slot'][],
): Set<string> {
  return new Set(
    activeRecords(records)
      .filter(
        (r): r is MealSlot =>
          r.kind === 'meal' &&
          r.date >= from &&
          r.date <= to &&
          slots.includes(r.slot) &&
          r.status === 'planned',
      )
      .flatMap((m) => m.servings.map((s) => s.preparationId)),
  );
}
export function shoppingNeeds(
  records: readonly MaisonRecord[],
  from: string,
  to: string,
  slots: readonly MealSlot['slot'][],
  today: string,
): IngredientNeed[] {
  const ids = preparationsForPeriod(records, from, to, slots);
  return ingredientNeeds(records, today).filter((n) =>
    ids.has(n.preparationId),
  );
}
export function needsRestock(s: StockEntry, product?: Product): boolean {
  if (s.status === 'low' || s.status === 'empty') return true;
  if (!s.threshold || !s.quantity || s.status === 'check') return false;
  const q = convertQuantity(s.quantity, s.threshold.unit, product);
  return q !== null && q.milli <= s.threshold.milli;
}
/** A purchase lot reaching zero must not hide newer stock, or create duplicate suggestions. */
export function restockSuggestions(
  records: readonly MaisonRecord[],
): Array<{ stock: StockEntry; originKey: string }> {
  const active = activeRecords(records);
  const result: Array<{ stock: StockEntry; originKey: string }> = [];
  for (const product of active)
    if (product.kind === 'product') {
      const entries = active
        .filter(
          (r): r is StockEntry =>
            r.kind === 'stock' && r.productId === product.id,
        )
        .sort(
          (a, b) =>
            b.confirmedAt.localeCompare(a.confirmedAt) ||
            a.id.localeCompare(b.id),
        );
      const newest = entries[0];
      if (!newest) continue;
      const threshold = entries.find((s) => s.threshold)?.threshold;
      let shortage: boolean;
      if (
        threshold &&
        entries.every(
          (s) =>
            s.status !== 'check' &&
            (s.status === 'empty' ||
              (s.quantity &&
                convertQuantity(s.quantity, threshold.unit, product))),
        )
      ) {
        const total = entries.reduce(
          (sum, s) =>
            sum +
            (s.status === 'empty'
              ? 0
              : convertQuantity(s.quantity!, threshold.unit, product)!.milli),
          0,
        );
        shortage = total <= threshold.milli;
      } else
        shortage =
          entries.every((s) => s.status === 'low' || s.status === 'empty') &&
          entries.some((s) => needsRestock(s, product));
      if (shortage)
        result.push({
          stock: newest,
          originKey: `restock:${product.id}:${newest.confirmedAt}`,
        });
    }
  return result;
}
export function coverageIsProtected(
  c: ShoppingCoverage,
  groceries: readonly GroceryItemRecord[],
): boolean {
  if (!c.managed) return true;
  if (!c.groceryItemId) return false;
  const g = groceries.find((g) => g.id === c.groceryItemId);
  return (
    !g ||
    !!g.checkedAt ||
    !!g.deletedAt ||
    g.label !== c.labelSnapshot ||
    g.quantityText !== c.quantityTextSnapshot
  );
}
export function suggestRecipes(
  records: readonly MaisonRecord[],
  today: string,
): Recipe[] {
  const active = activeRecords(records);
  const last = new Map<string, string>();
  for (const p of active)
    if (p.kind === 'preparation' && p.status !== 'cancelled') {
      const recipe = active.find((r) => r.id === p.recipeId);
      if (recipe?.kind === 'recipe')
        last.set(
          recipe.recipeKey,
          [last.get(recipe.recipeKey) ?? '', p.date].sort().at(-1)!,
        );
    }
  function missingCount(recipe: Recipe) {
    const id = `suggestion:${recipe.id}`;
    const candidate: Preparation = {
      ...recipe,
      id,
      kind: 'preparation',
      recipeId: recipe.id,
      date: today,
      actualPortionsMilli: null,
      status: 'planned',
    };
    return new Set(
      ingredientNeeds([...active, candidate], today)
        .filter(
          (n) => n.preparationId === id && (!n.missing || n.missing.milli > 0),
        )
        .map((n) => n.productId),
    ).size;
  }
  return latestRecipes(records)
    .filter(
      (r) =>
        r.ingredients.length > 0 &&
        r.ingredients.every((i) => i.quantity !== null),
    )
    .sort(
      (a, b) =>
        (last.get(a.recipeKey) ?? '').localeCompare(
          last.get(b.recipeKey) ?? '',
        ) ||
        missingCount(a) - missingCount(b) ||
        a.id.localeCompare(b.id),
    );
}
