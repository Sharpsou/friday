import { fridayDb } from './db/friday-db.js';

export const APP_PREFERENCES_KEY = 'app-preferences-v1';

export const THEME_OPTIONS = [
  { label: 'Menthe', value: 'mint' },
  { label: 'Océan', value: 'ocean' },
  { label: 'Lavande', value: 'lavender' },
  { label: 'Ambre', value: 'amber' },
] as const;

export type AppTheme = (typeof THEME_OPTIONS)[number]['value'];

export interface AppPreferences {
  currentResponsibleName: string;
  otherResponsibleName: string;
  theme: AppTheme;
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  currentResponsibleName: 'Moi',
  otherResponsibleName: 'Autre adulte',
  theme: 'mint',
};

const THEMES = new Set<AppTheme>(THEME_OPTIONS.map((option) => option.value));

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, 40);
  return cleaned || fallback;
}

export function normalizeAppPreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_APP_PREFERENCES;
  const candidate = value as Partial<AppPreferences>;
  return {
    currentResponsibleName: cleanName(
      candidate.currentResponsibleName,
      DEFAULT_APP_PREFERENCES.currentResponsibleName,
    ),
    otherResponsibleName: cleanName(
      candidate.otherResponsibleName,
      DEFAULT_APP_PREFERENCES.otherResponsibleName,
    ),
    theme:
      typeof candidate.theme === 'string' &&
      THEMES.has(candidate.theme as AppTheme)
        ? (candidate.theme as AppTheme)
        : DEFAULT_APP_PREFERENCES.theme,
  };
}

export async function loadAppPreferences(): Promise<AppPreferences> {
  const row = await fridayDb.settings.get(APP_PREFERENCES_KEY);
  return normalizeAppPreferences(row?.value);
}

export async function saveAppPreferences(
  value: AppPreferences,
): Promise<AppPreferences> {
  const preferences = normalizeAppPreferences(value);
  await fridayDb.settings.put({ key: APP_PREFERENCES_KEY, value: preferences });
  return preferences;
}

export function applyAppTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
}
