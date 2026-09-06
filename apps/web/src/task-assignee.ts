import {
  CURRENT_PROFILE_ID,
  OTHER_ADULT_PROFILE_ID,
} from './db/profile-defaults.js';
export {
  CURRENT_PROFILE_ID,
  OTHER_ADULT_PROFILE_ID,
} from './db/profile-defaults.js';

export type AssigneeChoice = 'unassigned' | 'current' | 'other';
export type AssigneeFilter = 'all' | AssigneeChoice;

export interface AssigneeLabels {
  current: string;
  other: string;
}

export function getAssigneeChoices(labels: AssigneeLabels): readonly {
  label: string;
  value: AssigneeChoice;
}[] {
  return [
    { label: 'Non attribuée', value: 'unassigned' },
    { label: labels.current, value: 'current' },
    { label: labels.other, value: 'other' },
  ];
}

export function getAssigneeFilters(labels: AssigneeLabels): readonly {
  label: string;
  value: AssigneeFilter;
}[] {
  return [
    { label: 'Toutes', value: 'all' },
    { label: labels.current, value: 'current' },
    { label: labels.other, value: 'other' },
    { label: 'Non attribuées', value: 'unassigned' },
  ];
}

export function getAssigneeProfileId(choice: AssigneeChoice): string | null {
  if (choice === 'current') return CURRENT_PROFILE_ID;
  if (choice === 'other') return OTHER_ADULT_PROFILE_ID;
  return null;
}

export function getAssigneeLabel(
  profileId: string | null,
  labels: AssigneeLabels = { current: 'Moi', other: 'Autre adulte' },
): string {
  if (profileId === CURRENT_PROFILE_ID) return labels.current;
  if (profileId === OTHER_ADULT_PROFILE_ID) return labels.other;
  return profileId === null ? 'Non attribuée' : 'Autre profil';
}

export function matchesAssigneeFilter(
  profileId: string | null,
  filter: AssigneeFilter,
): boolean {
  if (filter === 'all') return true;
  return profileId === getAssigneeProfileId(filter);
}
