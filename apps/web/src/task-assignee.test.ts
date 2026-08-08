import { describe, expect, it } from 'vitest';

import {
  CURRENT_PROFILE_ID,
  OTHER_ADULT_PROFILE_ID,
  getAssigneeChoices,
  getAssigneeFilters,
  getAssigneeLabel,
  getAssigneeProfileId,
  matchesAssigneeFilter,
} from './task-assignee.js';

describe('task assignees', () => {
  it('maps the pilot choices to stable profile identifiers', () => {
    expect(getAssigneeProfileId('unassigned')).toBeNull();
    expect(getAssigneeProfileId('current')).toBe(CURRENT_PROFILE_ID);
    expect(getAssigneeProfileId('other')).toBe(OTHER_ADULT_PROFILE_ID);
  });

  it('formats known and unassigned profiles', () => {
    expect(getAssigneeLabel(null)).toBe('Non attribuée');
    expect(getAssigneeLabel(CURRENT_PROFILE_ID)).toBe('Moi');
    expect(getAssigneeLabel(OTHER_ADULT_PROFILE_ID)).toBe('Autre adulte');
  });

  it('uses configured names without changing stable profile identifiers', () => {
    const labels = { current: 'Alice', other: 'Bob' };
    expect(getAssigneeLabel(CURRENT_PROFILE_ID, labels)).toBe('Alice');
    expect(getAssigneeLabel(OTHER_ADULT_PROFILE_ID, labels)).toBe('Bob');
    expect(getAssigneeChoices(labels).map(({ label }) => label)).toEqual([
      'Non attribuée',
      'Alice',
      'Bob',
    ]);
    expect(getAssigneeFilters(labels).map(({ label }) => label)).toContain(
      'Bob',
    );
  });

  it('filters without changing the underlying task list', () => {
    expect(matchesAssigneeFilter(CURRENT_PROFILE_ID, 'all')).toBe(true);
    expect(matchesAssigneeFilter(CURRENT_PROFILE_ID, 'current')).toBe(true);
    expect(matchesAssigneeFilter(CURRENT_PROFILE_ID, 'other')).toBe(false);
    expect(matchesAssigneeFilter(null, 'unassigned')).toBe(true);
  });
});
