import type { TaskRecord } from '@friday/contracts';

export function formatTaskRecurrence(
  recurrence: TaskRecord['recurrence'],
): string | null {
  if (!recurrence) return null;
  if (typeof recurrence === 'string') {
    return recurrence === 'daily'
      ? 'Chaque jour'
      : recurrence === 'weekly'
        ? 'Chaque semaine'
        : 'Chaque mois';
  }
  if (recurrence.unit === 'day') {
    return recurrence.interval === 1
      ? 'Chaque jour'
      : `Tous les ${recurrence.interval} jours`;
  }
  return recurrence.unit === 'week'
    ? 'Chaque semaine'
    : recurrence.unit === 'month'
      ? 'Chaque mois'
      : 'Chaque année';
}
