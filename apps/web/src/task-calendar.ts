export type CalendarPeriod = 'week' | 'month';

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12);
}

export function getTodayLocalDate(): string {
  return formatLocalDate(new Date());
}

export function addLocalDays(value: string, amount: number): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + amount);
  return formatLocalDate(date);
}

export function getWeekDates(anchorDate: string): string[] {
  const date = parseLocalDate(anchorDate);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  const monday = addLocalDays(anchorDate, -daysSinceMonday);
  return Array.from({ length: 7 }, (_, index) => addLocalDays(monday, index));
}

export function getMonthGridDates(anchorDate: string): string[] {
  const anchor = parseLocalDate(anchorDate);
  const firstOfMonth = formatLocalDate(
    new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12),
  );
  const lastOfMonth = formatLocalDate(
    new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12),
  );
  const firstDay = getWeekDates(firstOfMonth)[0] ?? firstOfMonth;
  const lastDate = parseLocalDate(lastOfMonth);
  const daysUntilSunday = (7 - lastDate.getDay()) % 7;
  const finalDay = addLocalDays(lastOfMonth, daysUntilSunday);
  const dates: string[] = [];

  for (let date = firstDay; date <= finalDay; date = addLocalDays(date, 1)) {
    dates.push(date);
  }

  return dates;
}

export function shiftCalendarPeriod(
  anchorDate: string,
  period: CalendarPeriod,
  direction: -1 | 1,
): string {
  if (period === 'week') return addLocalDays(anchorDate, direction * 7);
  const anchor = parseLocalDate(anchorDate);
  return formatLocalDate(
    new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1, 12),
  );
}
