import { describe, expect, it } from 'vitest';

import {
  getMonthGridDates,
  getWeekDates,
  shiftCalendarPeriod,
} from './task-calendar.js';

describe('task calendar dates', () => {
  it('builds a Monday-to-Sunday week', () => {
    expect(getWeekDates('2026-08-08')).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
    ]);
  });

  it('pads a month to complete calendar weeks', () => {
    const dates = getMonthGridDates('2026-08-08');

    expect(dates).toHaveLength(42);
    expect(dates[0]).toBe('2026-07-27');
    expect(dates.at(-1)).toBe('2026-09-06');
  });

  it('moves only by week or month', () => {
    expect(shiftCalendarPeriod('2026-08-08', 'week', 1)).toBe('2026-08-15');
    expect(shiftCalendarPeriod('2026-08-08', 'week', -1)).toBe('2026-08-01');
    expect(shiftCalendarPeriod('2026-08-31', 'month', 1)).toBe('2026-09-01');
    expect(shiftCalendarPeriod('2026-08-08', 'month', -1)).toBe('2026-07-01');
  });
});
