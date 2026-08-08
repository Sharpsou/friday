import { describe, expect, it } from 'vitest';

import { compareTasksBySchedule } from './task-sort.js';

function task(
  id: string,
  dueDate: string | null,
  dueTime: string | null,
  createdAt = '2026-08-08T12:00:00.000Z',
) {
  return { createdAt, dueDate, dueTime, id };
}

describe('task chronological order', () => {
  it('sorts by date then time, with undated tasks last', () => {
    const tasks = [
      task('undated', null, null),
      task('late', '2026-08-12', '18:00'),
      task('early', '2026-08-10', '09:00'),
      task('all-day', '2026-08-10', null),
      task('noon', '2026-08-10', '12:00'),
    ];

    expect(tasks.toSorted(compareTasksBySchedule).map(({ id }) => id)).toEqual([
      'all-day',
      'early',
      'noon',
      'late',
      'undated',
    ]);
  });

  it('keeps equal schedules deterministic with creation date then identifier', () => {
    const tasks = [
      task('b', null, null, '2026-08-08T12:00:00.000Z'),
      task('c', null, null, '2026-08-08T11:00:00.000Z'),
      task('a', null, null, '2026-08-08T12:00:00.000Z'),
    ];

    expect(tasks.toSorted(compareTasksBySchedule).map(({ id }) => id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});
