import type {
  MaisonQuantity,
  MaisonUnit,
  MaisonRecord,
  MealSlot,
} from '@friday/contracts';
import { parseMilli } from '@friday/domain';

export function inputQuantity(
  amount: string,
  unit: MaisonUnit,
): MaisonQuantity | null {
  return amount.trim() ? { milli: parseMilli(amount), unit } : null;
}
export function mealLabel(
  meal: MealSlot,
  records: readonly MaisonRecord[],
): string {
  if (meal.status === 'outside') return 'Repas extérieur';
  return (
    meal.servings
      .map((s) => {
        const p = records.find((r) => r.id === s.preparationId);
        const recipe =
          p?.kind === 'preparation'
            ? records.find((r) => r.id === p.recipeId)
            : null;
        return recipe?.kind === 'recipe' ? recipe.name : 'À préciser';
      })
      .join(' + ') || 'Menu à choisir'
  );
}
