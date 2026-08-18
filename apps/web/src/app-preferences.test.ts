import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_APP_PREFERENCES,
  loadAppPreferences,
  normalizeAppPreferences,
  saveAppPreferences,
} from './app-preferences.js';
import { fridayDb } from './db/friday-db.js';

beforeEach(async () => {
  await fridayDb.open();
});

afterEach(async () => {
  await fridayDb.settings.clear();
});

describe('app preferences', () => {
  it('uses safe defaults for missing or invalid values', () => {
    expect(normalizeAppPreferences(null)).toEqual(DEFAULT_APP_PREFERENCES);
    expect(
      normalizeAppPreferences({
        currentResponsibleName: '  ',
        otherResponsibleName: '  Alex   Martin  ',
        theme: 'neon',
      }),
    ).toEqual({
      assistantModel: 'qwen3.5',
      currentResponsibleName: 'Moi',
      homeTaskLimit: 20,
      otherResponsibleName: 'Alex Martin',
      theme: 'mint',
      todayTaskLimit: 4,
    });
  });

  it('persists responsible names and palette on this device', async () => {
    await saveAppPreferences({
      assistantModel: 'qwen3.5',
      currentResponsibleName: 'Alice',
      homeTaskLimit: 30,
      otherResponsibleName: 'Bob',
      theme: 'ocean',
      todayTaskLimit: 6,
    });

    await expect(loadAppPreferences()).resolves.toEqual({
      assistantModel: 'qwen3.5',
      currentResponsibleName: 'Alice',
      homeTaskLimit: 30,
      otherResponsibleName: 'Bob',
      theme: 'ocean',
      todayTaskLimit: 6,
    });
  });
});
