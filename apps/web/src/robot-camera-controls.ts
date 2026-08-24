import type { RobotState } from '@friday/contracts';

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
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
