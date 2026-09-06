import type { BudgetCategory } from '@friday/contracts';

export const CATEGORY_LABELS: Record<BudgetCategory, string> = {
  fixed: 'Frais fixes',
  groceries: 'Courses',
  health: 'Santé',
  leisure: 'Loisirs',
  extra: 'Extras',
};

const CURRENCY = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
});

export function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

export function monthBounds(date = today()): { end: string; start: string } {
  const [year, month] = date.split('-').map(Number);
  const endDay = new Date(year!, month!, 0).getDate();
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
}

export function cents(value: string): number {
  return Math.round(Number(value.replace(',', '.')) * 100);
}

export function formatCents(value: number): string {
  return CURRENCY.format(value / 100);
}

export function plannedHorizon(dueDate: string): string {
  const days = Math.ceil(
    (Date.parse(`${dueDate}T12:00:00`) - Date.parse(`${today()}T12:00:00`)) /
      86_400_000,
  );
  if (days < 0) return 'En retard';
  if (days <= 30) return 'Sous 30 jours';
  if (days <= 60) return '31–60 jours';
  if (days <= 90) return '61–90 jours';
  return 'Après 90 jours';
}
