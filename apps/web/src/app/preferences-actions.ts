import { applyAppTheme, saveAppPreferences } from '../app-preferences.js';

import type { useAccountsState } from './use-accounts-state.js';
import type { usePreferencesState } from './use-preferences-state.js';
import type { useRobotSettingsState } from './use-robot-settings-state.js';
interface Context {
  setPreferencesDraft: ReturnType<
    typeof usePreferencesState
  >['setPreferencesDraft'];
  preferences: ReturnType<typeof usePreferencesState>['preferences'];
  setAuthManagementMessage: ReturnType<
    typeof useAccountsState
  >['setAuthManagementMessage'];
  setConfirmAdultForget: ReturnType<
    typeof useAccountsState
  >['setConfirmAdultForget'];
  setRobotPurgeConfirmation: ReturnType<
    typeof useRobotSettingsState
  >['setRobotPurgeConfirmation'];
  setRobotSettingsMessage: ReturnType<
    typeof useRobotSettingsState
  >['setRobotSettingsMessage'];
  setSettingsOpen: ReturnType<typeof usePreferencesState>['setSettingsOpen'];
  reloadAuthManagement: () => Promise<void>;
  preferencesDraft: ReturnType<typeof usePreferencesState>['preferencesDraft'];
  setPreferences: ReturnType<typeof usePreferencesState>['setPreferences'];
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
}
export function createPreferencesActions({
  setPreferencesDraft,
  preferences,
  setAuthManagementMessage,
  setConfirmAdultForget,
  setRobotPurgeConfirmation,
  setRobotSettingsMessage,
  setSettingsOpen,
  reloadAuthManagement,
  preferencesDraft,
  setPreferences,
  setMessage,
}: Context) {
  function openSettings() {
    setPreferencesDraft(preferences);
    setAuthManagementMessage(null);
    setConfirmAdultForget(false);
    setRobotPurgeConfirmation(null);
    setRobotSettingsMessage(null);
    setSettingsOpen(true);
    void reloadAuthManagement();
  }
  async function submitPreferences(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const savedPreferences = await saveAppPreferences(preferencesDraft);
      setPreferences(savedPreferences);
      setPreferencesDraft(savedPreferences);
      applyAppTheme(savedPreferences.theme);
      setSettingsOpen(false);
      setMessage('Réglages enregistrés sur cet appareil.');
    } catch {
      setMessage('Impossible d’enregistrer les réglages sur cet appareil.');
    }
  }
  return { openSettings, submitPreferences };
}
