import { type WatchCreateRequest } from '@friday/contracts';

export function assertTimeZone(timeZone: string): void {
  new Intl.DateTimeFormat('fr-FR', { timeZone }).format(new Date());
}

export function nextScheduledAt(
  input: Pick<
    WatchCreateRequest,
    'cadence' | 'localTime' | 'timeZone' | 'weekday'
  >,
  after: Date,
): Date {
  const [targetHour, targetMinute] = input.localTime.split(':').map(Number);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: input.timeZone,
    weekday: 'short',
  });
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const start = Math.floor(after.valueOf() / 60_000) * 60_000 + 60_000;
  for (let offset = 0; offset <= 8 * 24 * 60; offset += 1) {
    const candidate = new Date(start + offset * 60_000);
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
    );
    if (
      Number(parts.hour) === targetHour &&
      Number(parts.minute) === targetMinute &&
      (input.cadence === 'daily' ||
        weekdays[parts.weekday ?? ''] === input.weekday)
    )
      return candidate;
  }
  throw new Error('Impossible de calculer la prochaine échéance de veille.');
}
