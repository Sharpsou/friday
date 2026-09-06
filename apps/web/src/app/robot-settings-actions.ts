import type {
  RobotCameraBandwidthProfile,
  RobotVisualMemoryPurgeScope,
} from '@friday/contracts';
import {
  purgeRobotVisualMemory,
  setRobotCameraBandwidth,
} from '../sync/robot-client.js';

import type { useRobotSettingsState } from './use-robot-settings-state.js';
interface Context {
  setRobotSettingsBusy: ReturnType<
    typeof useRobotSettingsState
  >['setRobotSettingsBusy'];
  setRobotSettingsMessage: ReturnType<
    typeof useRobotSettingsState
  >['setRobotSettingsMessage'];
  setRobotBandwidth: ReturnType<
    typeof useRobotSettingsState
  >['setRobotBandwidth'];
  setRobotPurgeConfirmation: ReturnType<
    typeof useRobotSettingsState
  >['setRobotPurgeConfirmation'];
}
export function createRobotSettingsActions({
  setRobotSettingsBusy,
  setRobotSettingsMessage,
  setRobotBandwidth,
  setRobotPurgeConfirmation,
}: Context) {
  async function changeRobotBandwidth(profile: RobotCameraBandwidthProfile) {
    setRobotSettingsBusy(true);
    setRobotSettingsMessage(null);
    try {
      const status = await setRobotCameraBandwidth(profile);
      setRobotBandwidth(status);
      setRobotSettingsMessage(
        profile === 'reduced'
          ? 'Flux réduit activé. La navigation a été arrêtée par sécurité.'
          : 'Flux normal activé. La navigation a été arrêtée par sécurité.',
      );
    } catch (error) {
      setRobotSettingsMessage(
        error instanceof Error ? error.message : 'Modification impossible.',
      );
    } finally {
      setRobotSettingsBusy(false);
    }
  }
  async function purgeRobotPlaces(scope: RobotVisualMemoryPurgeScope) {
    setRobotSettingsBusy(true);
    setRobotSettingsMessage(null);
    try {
      const result = await purgeRobotVisualMemory(scope);
      setRobotPurgeConfirmation(null);
      setRobotSettingsMessage(
        `${result.deletedPlaces.toString()} lieu(x) supprimé(s). La navigation a été arrêtée par sécurité.`,
      );
    } catch (error) {
      setRobotSettingsMessage(
        error instanceof Error ? error.message : 'Purge impossible.',
      );
    } finally {
      setRobotSettingsBusy(false);
    }
  }
  return { changeRobotBandwidth, purgeRobotPlaces };
}
