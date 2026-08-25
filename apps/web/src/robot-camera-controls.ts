import type { RobotState } from '@friday/contracts';

function clamp(value: number): number {
  const bounded = Math.max(-1, Math.min(1, value));
  return Math.round(bounded * 10_000) / 10_000;
}

export const CAMERA_NEUTRAL_TILT = 0.2;

export function cameraCenterDelta(
  pose: RobotState['cameraPose'],
): RobotState['cameraPose'] {
  return {
    pan: -pose.pan,
    tilt: CAMERA_NEUTRAL_TILT - pose.tilt,
  };
}

export function nextCameraPose(
  pose: RobotState['cameraPose'],
  panDelta: number,
  tiltDelta: number,
): RobotState['cameraPose'] {
  return {
    pan: clamp(pose.pan + panDelta),
    tilt: clamp(pose.tilt + tiltDelta),
  };
}
