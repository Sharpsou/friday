import { useRef, useState } from 'react';
import { DEFAULT_APP_PREFERENCES } from '../app-preferences.js';

export function usePreferencesState() {
  const [preferences, setPreferences] = useState(DEFAULT_APP_PREFERENCES);
  const [preferencesDraft, setPreferencesDraft] = useState(
    DEFAULT_APP_PREFERENCES,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  return {
    preferences,
    setPreferences,
    preferencesDraft,
    setPreferencesDraft,
    settingsOpen,
    setSettingsOpen,
    settingsCloseRef,
  };
}
