import {
  applySteeringTrim,
  joystickDriveCommand,
  shouldSendDriveCommand,
  type DriveCommand,
} from './robot-drive-controls.js';

export const GAMEPAD_NEUTRAL_THRESHOLD = 0.25;
export const GAMEPAD_CAMERA_TRIGGER_THRESHOLD = 0.6;
export const GAMEPAD_CAMERA_PAN_STEP = 0.5;
export const GAMEPAD_CAMERA_TILT_STEP = 0.08;

export type RobotGamepadStatus = 'connected' | 'incompatible' | null;
export type RobotDriveControlSource = 'gamepad' | 'touch' | null;

export interface RobotGamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
}

export interface RobotGamepadAxes {
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}

export interface RobotGamepadSelection {
  gamepad: RobotGamepadLike | null;
  status: RobotGamepadStatus;
}

export interface RobotGamepadControlState {
  cameraLatched: boolean;
  canDriveWasEligible: boolean;
  driveSource: RobotDriveControlSource;
  neutralRequired: boolean;
  previousDrive: DriveCommand | null;
}

export interface RobotGamepadFrameOptions {
  active: boolean;
  cameraInFlight: boolean;
  canDrive: boolean;
  canLook: boolean;
  powerPercent: number;
  steeringTrimPercent: number;
}

export interface RobotGamepadFrameResult {
  cameraDelta: { pan: number; tilt: number } | null;
  driveCommand: DriveCommand | null;
  releaseDrive: boolean;
  state: RobotGamepadControlState;
}

function boundedAxis(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value ?? 0));
}

export function isStandardRobotGamepad(gamepad: RobotGamepadLike): boolean {
  return (
    gamepad.connected &&
    gamepad.mapping === 'standard' &&
    gamepad.axes.length >= 4
  );
}

export function selectStandardRobotGamepad(
  gamepads: readonly (RobotGamepadLike | null)[],
  preferredIndex: number | null,
): RobotGamepadSelection {
  let compatible: RobotGamepadLike | null = null;
  let hasConnectedGamepad = false;

  for (const gamepad of gamepads) {
    if (!gamepad?.connected) continue;
    hasConnectedGamepad = true;
    if (!isStandardRobotGamepad(gamepad)) continue;
    if (gamepad.index === preferredIndex)
      return { gamepad, status: 'connected' };
    compatible ??= gamepad;
  }

  if (compatible) return { gamepad: compatible, status: 'connected' };
  return {
    gamepad: null,
    status: hasConnectedGamepad ? 'incompatible' : null,
  };
}

export function readRobotGamepadAxes(
  gamepad: RobotGamepadLike,
): RobotGamepadAxes {
  return {
    leftX: boundedAxis(gamepad.axes[0]),
    leftY: boundedAxis(gamepad.axes[1]),
    rightX: boundedAxis(gamepad.axes[2]),
    rightY: boundedAxis(gamepad.axes[3]),
  };
}

export function areRobotGamepadSticksNeutral(axes: RobotGamepadAxes): boolean {
  return (
    Math.abs(axes.leftX) < GAMEPAD_NEUTRAL_THRESHOLD &&
    Math.abs(axes.leftY) < GAMEPAD_NEUTRAL_THRESHOLD &&
    Math.abs(axes.rightX) < GAMEPAD_NEUTRAL_THRESHOLD &&
    Math.abs(axes.rightY) < GAMEPAD_NEUTRAL_THRESHOLD
  );
}

export function cameraDeltaFromGamepad(
  axes: Pick<RobotGamepadAxes, 'rightX' | 'rightY'>,
): { pan: number; tilt: number } | null {
  const pan =
    Math.abs(axes.rightX) >= GAMEPAD_CAMERA_TRIGGER_THRESHOLD
      ? -Math.sign(axes.rightX) * GAMEPAD_CAMERA_PAN_STEP
      : 0;
  const tilt =
    Math.abs(axes.rightY) >= GAMEPAD_CAMERA_TRIGGER_THRESHOLD
      ? Math.sign(axes.rightY) * GAMEPAD_CAMERA_TILT_STEP
      : 0;
  return pan === 0 && tilt === 0 ? null : { pan, tilt };
}

export function initialRobotGamepadControlState(): RobotGamepadControlState {
  return {
    cameraLatched: true,
    canDriveWasEligible: false,
    driveSource: null,
    neutralRequired: true,
    previousDrive: null,
  };
}

export function resetRobotGamepadControl(
  state: RobotGamepadControlState,
): RobotGamepadControlState {
  return {
    ...state,
    cameraLatched: true,
    driveSource: null,
    neutralRequired: true,
    previousDrive: null,
  };
}

export function claimTouchRobotDrive(state: RobotGamepadControlState): {
  releaseDrive: boolean;
  state: RobotGamepadControlState;
} {
  return {
    releaseDrive: state.driveSource === 'gamepad',
    state: {
      ...state,
      cameraLatched: true,
      driveSource: 'touch',
      neutralRequired: true,
      previousDrive: null,
    },
  };
}

export function releaseTouchRobotDrive(
  state: RobotGamepadControlState,
): RobotGamepadControlState {
  if (state.driveSource !== 'touch') return state;
  return resetRobotGamepadControl(state);
}

export function advanceRobotGamepadControl(
  current: RobotGamepadControlState,
  axes: RobotGamepadAxes,
  options: RobotGamepadFrameOptions,
): RobotGamepadFrameResult {
  let state = { ...current };
  let releaseDrive = false;
  let driveCommand: DriveCommand | null = null;
  let cameraDelta: { pan: number; tilt: number } | null = null;

  if (!options.active) {
    releaseDrive = state.driveSource === 'gamepad';
    state = {
      ...resetRobotGamepadControl(state),
      canDriveWasEligible: options.canDrive,
    };
    return { cameraDelta, driveCommand, releaseDrive, state };
  }

  if (!state.canDriveWasEligible && options.canDrive) {
    releaseDrive = state.driveSource === 'gamepad';
    state = resetRobotGamepadControl(state);
  }
  state.canDriveWasEligible = options.canDrive;

  if (state.neutralRequired) {
    if (areRobotGamepadSticksNeutral(axes)) {
      state.neutralRequired = false;
      state.cameraLatched = false;
    }
    return { cameraDelta, driveCommand, releaseDrive, state };
  }

  const baseDrive = joystickDriveCommand(
    axes.leftX,
    axes.leftY,
    options.powerPercent / 100,
  );
  if (!baseDrive || !options.canDrive) {
    if (state.driveSource === 'gamepad') {
      releaseDrive = true;
      state.driveSource = null;
    }
    state.previousDrive = null;
  } else if (state.driveSource !== 'touch') {
    const nextDrive = applySteeringTrim(
      baseDrive,
      options.steeringTrimPercent / 100,
    );
    const force = state.driveSource !== 'gamepad';
    state.driveSource = 'gamepad';
    if (shouldSendDriveCommand(state.previousDrive, nextDrive, force))
      driveCommand = nextDrive;
    state.previousDrive = nextDrive;
  }

  const rightNeutral =
    Math.abs(axes.rightX) < GAMEPAD_NEUTRAL_THRESHOLD &&
    Math.abs(axes.rightY) < GAMEPAD_NEUTRAL_THRESHOLD;
  if (rightNeutral) state.cameraLatched = false;
  else {
    const nextCamera = cameraDeltaFromGamepad(axes);
    if (nextCamera && !state.cameraLatched) {
      state.cameraLatched = true;
      if (options.canLook && !options.cameraInFlight) cameraDelta = nextCamera;
    }
  }

  return { cameraDelta, driveCommand, releaseDrive, state };
}
