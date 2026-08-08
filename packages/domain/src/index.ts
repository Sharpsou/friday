export function normalizeTaskTitle(input: string): string {
  return input.trim().replace(/\s+/gu, ' ').slice(0, 200);
}

export function normalizeTaskNote(input: string): string | null {
  const note = input.trim().replace(/\r\n?/gu, '\n').slice(0, 2_000);
  return note || null;
}

interface RecurrenceRule {
  anchorDate: string;
  interval: number;
  unit: 'day' | 'week' | 'month' | 'year';
}

export function getRecurrenceDates(
  firstDate: string,
  rule: RecurrenceRule & { endDate: string },
  maximumOccurrences = 500,
): string[] {
  const dates = [firstDate];
  let current = firstDate;
  while (true) {
    const next = getNextRecurrenceDate(current, rule);
    if (next > rule.endDate) return dates;
    if (dates.length >= maximumOccurrences) {
      throw new Error(
        `Cette récurrence dépasse ${maximumOccurrences} occurrences. Rapprochez la date de fin.`,
      );
    }
    dates.push(next);
    current = next;
  }
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

function formatDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function clampedDate(year: number, month: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatDate(new Date(Date.UTC(year, month, Math.min(day, lastDay))));
}

export function getNextRecurrenceDate(
  currentDate: string,
  rule: RecurrenceRule | 'daily' | 'weekly' | 'monthly',
): string {
  const normalized: RecurrenceRule =
    typeof rule === 'string'
      ? {
          anchorDate: currentDate,
          interval: 1,
          unit: rule === 'daily' ? 'day' : rule === 'weekly' ? 'week' : 'month',
        }
      : rule;
  const current = parseDate(currentDate);
  if (normalized.unit === 'day' || normalized.unit === 'week') {
    current.setUTCDate(
      current.getUTCDate() +
        normalized.interval * (normalized.unit === 'week' ? 7 : 1),
    );
    return formatDate(current);
  }

  const anchor = parseDate(normalized.anchorDate);
  if (normalized.unit === 'month') {
    return clampedDate(
      current.getUTCFullYear(),
      current.getUTCMonth() + 1,
      anchor.getUTCDate(),
    );
  }
  return clampedDate(
    current.getUTCFullYear() + 1,
    anchor.getUTCMonth(),
    anchor.getUTCDate(),
  );
}
