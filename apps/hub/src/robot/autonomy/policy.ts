import {
  type RobotAutonomyAction,
  type RobotDirection,
  type RobotDriveRequest,
  type RobotState,
} from '@friday/contracts';
import type { RobotVisualTopologyService } from '../robot-visual-topology.js';
import { type RobotVisualObservation } from '../robot-visual-topology.js';
export const LOOP_MS = 250;
export const MOTION_REFRESH_MS = 100;
export const MOTION_WATCHDOG_MS = 300;
export const MOTION_SETTLE_MS = 700;
export const MOTION_STABLE_FRAMES = 3;
export const DARK_LIMIT_MS = 15_000;
export const UNLOCALIZED_INITIAL_SETTLE_MS = 1_200;
export const UNLOCALIZED_SETTLE_MS = 700;
export const UNLOCALIZED_ANCHOR_SETTLE_MS = 2_500;
export const UNLOCALIZED_SCAN_PULSES = 8;
export class RobotAutonomyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface RecoveryCapture {
  commands: RobotDriveRequest[];
  situationKey: string;
  sourcePlaceId: string | null;
  startedAt: string;
}
export interface RecoveryReplay {
  commands: RobotDriveRequest[];
  index: number;
}
export interface GraphEvidence {
  confirmedPlaces: number;
  confirmedTransitions: number;
  resolvedPorts: number;
}
export function graphEvidence(
  graph: ReturnType<RobotVisualTopologyService['snapshot']>,
): GraphEvidence {
  return {
    confirmedPlaces: graph.places.filter(
      (place) => place.status === 'confirmed',
    ).length,
    confirmedTransitions: graph.transitions.filter(
      (transition) => transition.status === 'confirmed',
    ).length,
    resolvedPorts: graph.ports.filter((port) =>
      ['passage_confirmed', 'dead_end_confirmed'].includes(port.status),
    ).length,
  };
}
export function actionForDirection(
  direction: RobotDirection | 'unknown',
): RobotAutonomyAction {
  if (direction === 'left') return 'pivot_left';
  if (direction === 'right') return 'pivot_right';
  if (direction === 'backward') return 'return_to_last_anchor';
  return 'advance_slow';
}
export function autonomousActionIntensity(
  _action: RobotAutonomyAction,
  powerPercent: number,
): number {
  return Math.max(10, Math.min(35, Math.round(powerPercent))) / 100;
}
export function motionBurstDurationMs(
  action: RobotAutonomyAction,
  powerPercent: number,
): number {
  const power = Math.max(10, Math.min(35, Math.round(powerPercent)));
  const durationAtTwentyPercent = action === 'advance_normal' ? 320 : 220;
  const minimum = action === 'advance_normal' ? 180 : 140;
  const maximum = action === 'advance_normal' ? 500 : 400;
  return Math.max(
    minimum,
    Math.min(maximum, Math.round((durationAtTwentyPercent * 20) / power)),
  );
}
export function stabilizationFrameCount(
  currentCount: number,
  observation: Pick<
    RobotVisualObservation,
    'imageUsable' | 'motionState' | 'stable'
  >,
): number {
  return observation.imageUsable &&
    observation.stable &&
    observation.motionState === 'stationary'
    ? currentCount + 1
    : 0;
}
export function unlocalizedSearchDirection(
  state: RobotState,
  completedScanPulses: number,
): Extract<RobotDirection, 'forward' | 'left' | 'right'> | null {
  const leftClear = state.telemetry.irLeftClear !== false;
  const rightClear = state.telemetry.irRightClear !== false;
  if (!leftClear && !rightClear) return null;
  if (!leftClear) return 'right';
  if (!rightClear) return 'left';
  return completedScanPulses >= UNLOCALIZED_SCAN_PULSES ? 'forward' : 'right';
}
export function directionForAction(
  action: RobotAutonomyAction,
  state: RobotState,
): RobotDirection {
  if (action === 'pivot_left') return 'left';
  if (action === 'pivot_right') return 'right';
  if (action === 'return_to_last_anchor') return 'backward';
  if (action === 'try_alternate_port')
    return state.telemetry.irLeftClear === false ? 'right' : 'left';
  return 'forward';
}
export function recoverySituationKey(
  state: RobotState,
  motion: RobotVisualObservation['motionState'],
): string {
  return [
    state.telemetry.irLeftClear === false ? 'left-blocked' : 'left-clear',
    state.telemetry.irRightClear === false ? 'right-blocked' : 'right-clear',
    motion,
  ].join('|');
}
