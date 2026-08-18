import { fridayDb } from './db/friday-db.js';
import type { AssistantModel } from '@friday/contracts';

export const APP_PREFERENCES_KEY = 'app-preferences-v1';

export const THEME_OPTIONS = [
  { label: 'Menthe', value: 'mint' },
  { label: 'Océan', value: 'ocean' },
  { label: 'Lavande', value: 'lavender' },
  { label: 'Ambre', value: 'amber' },
] as const;

export type AppTheme = (typeof THEME_OPTIONS)[number]['value'];

export interface AppPreferences {
  assistantModel: AssistantModel;
  currentResponsibleName: string;
  homeTaskLimit: number;
  otherResponsibleName: string;
  theme: AppTheme;
  todayTaskLimit: number;
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  assistantModel: 'qwen3.5',
  currentResponsibleName: 'Moi',
  homeTaskLimit: 20,
  otherResponsibleName: 'Autre adulte',
  theme: 'mint',
  todayTaskLimit: 4,
};

const THEMES = new Set<AppTheme>(THEME_OPTIONS.map((option) => option.value));

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, 40);
  return cleaned || fallback;
}

function cleanLimit(value: unknown, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(maximum, Math.max(1, value))
    : fallback;
}

export function normalizeAppPreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_APP_PREFERENCES;
  const candidate = value as Partial<AppPreferences>;
  return {
    assistantModel:
      candidate.assistantModel === 'gemma4' ? 'gemma4' : 'qwen3.5',
    currentResponsibleName: cleanName(
      candidate.currentResponsibleName,
      DEFAULT_APP_PREFERENCES.currentResponsibleName,
    ),
    homeTaskLimit: cleanLimit(
      candidate.homeTaskLimit,
      DEFAULT_APP_PREFERENCES.homeTaskLimit,
      200,
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
    todayTaskLimit: cleanLimit(
      candidate.todayTaskLimit,
      DEFAULT_APP_PREFERENCES.todayTaskLimit,
      50,
    ),
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
