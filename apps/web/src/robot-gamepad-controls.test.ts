import { describe, expect, it } from 'vitest';

import {
  advanceRobotGamepadControl,
  cameraDeltaFromGamepad,
  claimTouchRobotDrive,
  initialRobotGamepadControlState,
  readRobotGamepadAxes,
  releaseTouchRobotDrive,
  resetRobotGamepadControl,
  selectStandardRobotGamepad,
  type RobotGamepadAxes,
  type RobotGamepadControlState,
  type RobotGamepadFrameOptions,
  type RobotGamepadLike,
} from './robot-gamepad-controls.js';

const NEUTRAL: RobotGamepadAxes = {
  leftX: 0,
  leftY: 0,
  rightX: 0,
  rightY: 0,
};
const ELIGIBLE: RobotGamepadFrameOptions = {
  active: true,
  cameraInFlight: false,
  canDrive: true,
  canLook: true,
  powerPercent: 20,
  steeringTrimPercent: 0,
};

function gamepad(
  index: number,
  axes: readonly number[] = [0, 0, 0, 0],
  mapping = 'standard',
): RobotGamepadLike {
  return { axes, connected: true, index, mapping };
}

function readyState(): RobotGamepadControlState {
  return advanceRobotGamepadControl(
    initialRobotGamepadControlState(),
    NEUTRAL,
    ELIGIBLE,
  ).state;
}

describe('robot gamepad discovery', () => {
  it('keeps the preferred compatible controller and rejects raw mappings', () => {
    const first = gamepad(0);
    const preferred = gamepad(2);
    expect(selectStandardRobotGamepad([first, null, preferred], 2)).toEqual({
      gamepad: preferred,
      status: 'connected',
    });
    expect(
      selectStandardRobotGamepad([gamepad(1, [0, 0, 0, 0], '')], null),
    ).toEqual({ gamepad: null, status: 'incompatible' });
    expect(selectStandardRobotGamepad([], null)).toEqual({
      gamepad: null,
      status: null,
    });
  });

  it('reads the standard four axes and bounds invalid values', () => {
    expect(readRobotGamepadAxes(gamepad(0, [-2, 0.5, Number.NaN, 4]))).toEqual({
      leftX: -1,
      leftY: 0.5,
      rightX: 0,
      rightY: 1,
    });
  });
});

describe('robot gamepad locomotion', () => {
  it('applies the shared forward trim and leaves reverse untrimmed', () => {
    const forward = advanceRobotGamepadControl(
      readyState(),
      { ...NEUTRAL, leftY: -1 },
      { ...ELIGIBLE, steeringTrimPercent: 7 },
    );
    const backward = advanceRobotGamepadControl(
      readyState(),
      { ...NEUTRAL, leftY: 1 },
      { ...ELIGIBLE, steeringTrimPercent: 7 },
    );

    expect(forward.driveCommand).toEqual({
      direction: 'forward',
      steering: 0.07,
    });
    expect(backward.driveCommand).toEqual({
      direction: 'backward',
      steering: 0,
    });
  });

  it('requires a neutral frame, then reuses the drive curve and forward trim', () => {
    const ready = readyState();
    const moving = advanceRobotGamepadControl(
      ready,
      { ...NEUTRAL, leftX: 0.8, leftY: -0.7 },
      { ...ELIGIBLE, powerPercent: 35, steeringTrimPercent: -5 },
    );

    expect(moving.driveCommand).toMatchObject({ direction: 'forward' });
    expect(moving.driveCommand!.steering).toBeGreaterThan(0);
    expect(moving.state.driveSource).toBe('gamepad');

    const held = advanceRobotGamepadControl(
      moving.state,
      { ...NEUTRAL, leftX: 0.8, leftY: -0.7 },
      { ...ELIGIBLE, powerPercent: 35, steeringTrimPercent: -5 },
    );
    expect(held.driveCommand).toBeNull();

    const stopped = advanceRobotGamepadControl(held.state, NEUTRAL, ELIGIBLE);
    expect(stopped.releaseDrive).toBe(true);
    expect(stopped.state.driveSource).toBeNull();
  });

  it('makes touch authoritative until it releases and the gamepad recenters', () => {
    const gamepadDrive = advanceRobotGamepadControl(
      readyState(),
      { ...NEUTRAL, leftY: -1 },
      ELIGIBLE,
    );
    const touch = claimTouchRobotDrive(gamepadDrive.state);
    expect(touch.releaseDrive).toBe(true);
    expect(touch.state.driveSource).toBe('touch');

    const ignored = advanceRobotGamepadControl(
      touch.state,
      { ...NEUTRAL, leftY: -1 },
      ELIGIBLE,
    );
    expect(ignored.driveCommand).toBeNull();

    const released = releaseTouchRobotDrive(ignored.state);
    expect(
      advanceRobotGamepadControl(released, { ...NEUTRAL, leftY: -1 }, ELIGIBLE)
        .driveCommand,
    ).toBeNull();
    const recentered = advanceRobotGamepadControl(released, NEUTRAL, ELIGIBLE);
    expect(
      advanceRobotGamepadControl(
        recentered.state,
        { ...NEUTRAL, leftY: -1 },
        ELIGIBLE,
      ).driveCommand,
    ).toEqual({ direction: 'forward', steering: 0 });
  });

  it('stays inactive in autonomous mode and gates wheel reactivation', () => {
    const autonomous = advanceRobotGamepadControl(
      readyState(),
      { leftX: 1, leftY: -1, rightX: 1, rightY: -1 },
      { ...ELIGIBLE, active: false, canDrive: false, canLook: false },
    );
    expect(autonomous.driveCommand).toBeNull();
    expect(autonomous.cameraDelta).toBeNull();
    expect(autonomous.state.neutralRequired).toBe(true);

    const wheelsOnWhileHeld = advanceRobotGamepadControl(
      autonomous.state,
      { ...NEUTRAL, leftY: -1 },
      ELIGIBLE,
    );
    expect(wheelsOnWhileHeld.driveCommand).toBeNull();
    expect(wheelsOnWhileHeld.state.neutralRequired).toBe(true);
  });
});

describe('robot gamepad camera', () => {
  it('maps horizontal, vertical and diagonal gestures to the existing steps', () => {
    expect(cameraDeltaFromGamepad({ rightX: -1, rightY: 0 })).toEqual({
      pan: 0.5,
      tilt: 0,
    });
    expect(cameraDeltaFromGamepad({ rightX: 1, rightY: 0 })).toEqual({
      pan: -0.5,
      tilt: 0,
    });
    expect(cameraDeltaFromGamepad({ rightX: -1, rightY: -1 })).toEqual({
      pan: 0.5,
      tilt: -0.08,
    });
  });

  it('emits one camera step per gesture and rearms only near center', () => {
    const ready = readyState();
    const gesture = advanceRobotGamepadControl(
      ready,
      { ...NEUTRAL, rightX: 0.8 },
      ELIGIBLE,
    );
    expect(gesture.cameraDelta).toEqual({ pan: -0.5, tilt: 0 });
    expect(
      advanceRobotGamepadControl(
        gesture.state,
        { ...NEUTRAL, rightX: 0.8 },
        ELIGIBLE,
      ).cameraDelta,
    ).toBeNull();

    const notCentered = advanceRobotGamepadControl(
      gesture.state,
      { ...NEUTRAL, rightX: 0.3 },
      ELIGIBLE,
    );
    expect(notCentered.state.cameraLatched).toBe(true);
    const centered = advanceRobotGamepadControl(
      notCentered.state,
      { ...NEUTRAL, rightX: 0.2 },
      ELIGIBLE,
    );
    expect(centered.state.cameraLatched).toBe(false);
  });

  it('consumes a camera gesture while rolling or while a move is in flight', () => {
    const rolling = advanceRobotGamepadControl(
      readyState(),
      { ...NEUTRAL, rightY: -1 },
      { ...ELIGIBLE, canLook: false },
    );
    expect(rolling.cameraDelta).toBeNull();
    expect(rolling.state.cameraLatched).toBe(true);
    expect(
      advanceRobotGamepadControl(
        rolling.state,
        { ...NEUTRAL, rightY: -1 },
        ELIGIBLE,
      ).cameraDelta,
    ).toBeNull();

    const reset = advanceRobotGamepadControl(rolling.state, NEUTRAL, ELIGIBLE);
    expect(
      advanceRobotGamepadControl(
        reset.state,
        { ...NEUTRAL, rightY: -1 },
        { ...ELIGIBLE, cameraInFlight: true },
      ).cameraDelta,
    ).toBeNull();
  });

  it('resets safely after a disconnect or loss of page control', () => {
    const driving = advanceRobotGamepadControl(
      readyState(),
      { ...NEUTRAL, leftY: -1 },
      ELIGIBLE,
    ).state;
    expect(resetRobotGamepadControl(driving)).toMatchObject({
      cameraLatched: true,
      driveSource: null,
      neutralRequired: true,
      previousDrive: null,
    });
  });
});
