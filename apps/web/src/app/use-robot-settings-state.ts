import type {
  RobotCameraBandwidthStatus,
  RobotVisualMemoryPurgeScope,
} from '@friday/contracts';
import { useState } from 'react';

export function useRobotSettingsState() {
  const [robotBandwidth, setRobotBandwidth] =
    useState<RobotCameraBandwidthStatus | null>(null);
  const [robotSettingsBusy, setRobotSettingsBusy] = useState(false);
  const [robotSettingsMessage, setRobotSettingsMessage] = useState<
    string | null
  >(null);
  const [robotPurgeConfirmation, setRobotPurgeConfirmation] =
    useState<RobotVisualMemoryPurgeScope | null>(null);
  return {
    robotBandwidth,
    setRobotBandwidth,
    robotSettingsBusy,
    setRobotSettingsBusy,
    robotSettingsMessage,
    setRobotSettingsMessage,
    robotPurgeConfirmation,
    setRobotPurgeConfirmation,
  };
}
