import { describe, expect, it } from 'vitest';

import { cameraCenterDelta, nextCameraPose } from './robot-camera-controls.js';
import {
  applySteeringTrim,
  joystickDriveCommand,
  shouldSendDriveCommand,
} from './robot-drive-controls.js';

describe('RobotView camera controls', () => {
  it('moves pan in large half-range steps while keeping tilt precise', () => {
    expect(nextCameraPose({ pan: 0, tilt: 0 }, -0.5, 0)).toEqual({
      pan: -0.5,
      tilt: 0,
    });
    expect(nextCameraPose({ pan: -0.5, tilt: 0 }, -0.5, 0)).toEqual({
      pan: -1,
      tilt: 0,
    });
    expect(nextCameraPose({ pan: -1, tilt: 0 }, -0.5, 0)).toEqual({
      pan: -1,
      tilt: 0,
    });
    expect(nextCameraPose({ pan: 0, tilt: 0 }, 0, 0.05)).toEqual({
      pan: 0,
      tilt: 0.05,
    });
  });

  it('centers pan while keeping the vertical neutral 20 points lower', () => {
    const pose = { pan: 0.5, tilt: -0.1 };
    const delta = cameraCenterDelta(pose);

    expect(nextCameraPose(pose, delta.pan, delta.tilt)).toEqual({
      pan: 0,
      tilt: 0.2,
    });
  });
});

describe('RobotView drive controls', () => {
  it('keeps small horizontal offsets neutral while moving', () => {
    expect(joystickDriveCommand(0.34, -0.8, 0.2)).toEqual({
      direction: 'forward',
      steering: 0,
    });
    expect(joystickDriveCommand(-0.3, 0.8, 0.2)).toEqual({
      direction: 'backward',
      steering: 0,
    });
  });

  it('applies a softened progressive curve beyond the moving dead zone', () => {
    const gentle = joystickDriveCommand(0.5, -0.8, 0.35);
    const stronger = joystickDriveCommand(0.8, -0.5, 0.35);

    expect(gentle).toMatchObject({ direction: 'forward' });
    expect(gentle!.steering).toBeGreaterThan(0);
    expect(gentle!.steering).toBeLessThan(0.1);
    expect(stronger!.steering).toBeGreaterThan(gentle!.steering);
    expect(stronger!.steering).toBeLessThanOrEqual(0.55);
  });

  it('allows a tighter moving turn at low speed than at high speed', () => {
    const slow = joystickDriveCommand(0.9, -0.4, 0.1);
    const fast = joystickDriveCommand(0.9, -0.4, 0.35);

    expect(slow).toMatchObject({ direction: 'forward' });
    expect(slow!.steering).toBeGreaterThan(fast!.steering);
    expect(slow!.steering).toBeLessThanOrEqual(1);
    expect(fast!.steering).toBeLessThanOrEqual(0.55);
  });

  it('preserves full on-the-spot U-turn commands', () => {
    expect(joystickDriveCommand(0.8, 0.2, 0.35)).toEqual({
      direction: 'right',
      steering: 0,
    });
    expect(joystickDriveCommand(-0.8, -0.1, 0.35)).toEqual({
      direction: 'left',
      steering: 0,
    });
  });

  it('always sends an exact steering reset after a small moving turn', () => {
    expect(
      shouldSendDriveCommand(
        { direction: 'forward', steering: 0.0436 },
        { direction: 'forward', steering: 0 },
      ),
    ).toBe(true);
    expect(
      shouldSendDriveCommand(
        { direction: 'forward', steering: 0 },
        { direction: 'forward', steering: 0.0436 },
      ),
    ).toBe(false);
  });

  it('applies trim only while moving forward and forces the trimmed center update', () => {
    const trimmedStraight = applySteeringTrim(
      { direction: 'forward', steering: 0 },
      -0.05,
    );
    expect(trimmedStraight).toEqual({
      direction: 'forward',
      steering: -0.05,
    });
    expect(
      applySteeringTrim({ direction: 'right', steering: 0 }, -0.05),
    ).toEqual({ direction: 'right', steering: 0 });
    expect(
      applySteeringTrim({ direction: 'backward', steering: 0.2 }, -0.05),
    ).toEqual({ direction: 'backward', steering: 0.2 });
    expect(
      shouldSendDriveCommand(
        { direction: 'forward', steering: -0.02 },
        trimmedStraight,
        true,
      ),
    ).toBe(true);
  });
});
