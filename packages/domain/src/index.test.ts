import { describe, expect, it } from 'vitest';

import {
  getNextRecurrenceDate,
  getRecurrenceDates,
  normalizeTaskNote,
  normalizeTaskTitle,
} from './index.js';

describe('normalizeTaskTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeTaskTitle('  Sortir   les poubelles  ')).toBe(
      'Sortir les poubelles',
    );
  });
});

describe('task recurrence', () => {
  it('supports daily, weekly and custom-day intervals', () => {
    expect(getNextRecurrenceDate('2026-08-08', 'daily')).toBe('2026-08-09');
    expect(getNextRecurrenceDate('2026-08-08', 'weekly')).toBe('2026-08-15');
    expect(
      getNextRecurrenceDate('2026-08-08', {
        anchorDate: '2026-08-08',
        interval: 3,
        unit: 'day',
      }),
    ).toBe('2026-08-11');
  });

  it('preserves the anchor day for monthly and yearly recurrences', () => {
    const monthly = {
      anchorDate: '2026-01-31',
      interval: 1,
      unit: 'month',
    } as const;
    expect(getNextRecurrenceDate('2026-01-31', monthly)).toBe('2026-02-28');
    expect(getNextRecurrenceDate('2026-02-28', monthly)).toBe('2026-03-31');
    expect(
      getNextRecurrenceDate('2028-02-29', {
        anchorDate: '2028-02-29',
        interval: 1,
        unit: 'year',
      }),
    ).toBe('2029-02-28');
  });

  it('materializes occurrences through the inclusive end date', () => {
    expect(
      getRecurrenceDates('2026-08-08', {
        anchorDate: '2026-08-08',
        endDate: '2026-08-14',
        interval: 3,
        unit: 'day',
      }),
    ).toEqual(['2026-08-08', '2026-08-11', '2026-08-14']);
  });
});

describe('normalizeTaskNote', () => {
  it('keeps an optional note or returns null when empty', () => {
    expect(normalizeTaskNote('  Penser au justificatif  ')).toBe(
      'Penser au justificatif',
    );
    expect(normalizeTaskNote('   ')).toBeNull();
  });
});
