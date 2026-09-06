import type { MaisonRecord, MealSlot, Preparation } from '@friday/contracts';
import { maisonFields, saveMaisonCommand } from '../../db/maison-repository.js';
import { addLocalDays } from '../../task-calendar.js';

export async function copyMealPeriod(
  records: readonly MaisonRecord[],
  from: string,
  to: string,
  destination: string,
): Promise<void> {
  const span = Math.round(
    (Date.parse(`${destination}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  );
  const meals = records.filter(
    (r): r is MealSlot =>
      r.kind === 'meal' &&
      !r.deletedAt &&
      r.date >= from &&
      r.date <= to &&
      r.status !== 'cancelled',
  );
  const copies = new Map<string, Preparation>();
  const writes: MaisonRecord[] = [];
  for (const meal of meals) {
    const date = addLocalDays(meal.date, span);
    if (
      records.some(
        (r) =>
          r.kind === 'meal' &&
          !r.deletedAt &&
          r.date === date &&
          r.slot === meal.slot &&
          r.status !== 'cancelled',
      )
    )
      continue;
    const servings: MealSlot['servings'] = [];
    for (const serving of meal.servings) {
      let copy = copies.get(serving.preparationId);
      if (!copy) {
        const original = records.find(
          (r): r is Preparation =>
            r.kind === 'preparation' && r.id === serving.preparationId,
        );
        if (!original) throw new Error('Préparation à copier absente.');
        copy = {
          ...original,
          ...(await maisonFields()),
          date: addLocalDays(original.date, span),
          status: 'planned',
          actualPortionsMilli: null,
        };
        copies.set(original.id, copy);
        writes.push(copy);
      }
      servings.push({ ...serving, preparationId: copy.id });
    }
    writes.push({
      ...meal,
      ...(await maisonFields()),
      date,
      servings,
      status: meal.status === 'outside' ? 'outside' : 'planned',
    });
  }
  if (!writes.length)
    throw new Error('Aucun repas à copier dans les créneaux libres.');
  await saveMaisonCommand(writes);
}
