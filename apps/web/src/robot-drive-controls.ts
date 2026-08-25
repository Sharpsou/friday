import type { RobotDirection } from '@friday/contracts';

export type DriveCommand = { direction: RobotDirection; steering: number };

const MOTION_DEAD_ZONE = 0.3;
const PURE_TURN_VERTICAL_BAND = 0.22;
const MOVING_STEERING_DEAD_ZONE = 0.35;
const MOVING_STEERING_EXPONENT = 1.5;
const MIN_INTENSITY = 0.1;
const MAX_INTENSITY = 0.35;
const LOW_SPEED_STEERING_MAX = 1;
const HIGH_SPEED_STEERING_MAX = 0.55;

export function joystickDriveCommand(
  normalizedX: number,
  normalizedY: number,
  intensity: number,
): DriveCommand | null {
  if (Math.hypot(normalizedX, normalizedY) < MOTION_DEAD_ZONE) return null;

  if (Math.abs(normalizedY) < PURE_TURN_VERTICAL_BAND) {
    return {
      direction: normalizedX < 0 ? 'left' : 'right',
      steering: 0,
    };
  }

  const horizontal = Math.abs(normalizedX);
  const boundedIntensity = Math.max(
    MIN_INTENSITY,
    Math.min(MAX_INTENSITY, intensity),
  );
  const speedRatio =
    (boundedIntensity - MIN_INTENSITY) / (MAX_INTENSITY - MIN_INTENSITY);
  const steeringMaximum =
    LOW_SPEED_STEERING_MAX -
    speedRatio * (LOW_SPEED_STEERING_MAX - HIGH_SPEED_STEERING_MAX);
  const steeringMagnitude =
    horizontal <= MOVING_STEERING_DEAD_ZONE
      ? 0
      : Math.pow(
          (horizontal - MOVING_STEERING_DEAD_ZONE) /
            (1 - MOVING_STEERING_DEAD_ZONE),
          MOVING_STEERING_EXPONENT,
        ) * steeringMaximum;

  return {
    direction: normalizedY < 0 ? 'forward' : 'backward',
    steering:
      steeringMagnitude === 0 ? 0 : Math.sign(normalizedX) * steeringMagnitude,
  };
}

export function shouldSendDriveCommand(
  previous: DriveCommand | null,
  next: DriveCommand,
  force = false,
): boolean {
  return (
    force ||
    previous === null ||
    previous.direction !== next.direction ||
    (next.steering === 0 && previous.steering !== 0) ||
    Math.abs(next.steering - previous.steering) >= 0.05
  );
}

export function applySteeringTrim(
  command: DriveCommand,
  trim: number,
): DriveCommand {
  if (command.direction !== 'forward') return command;
  return {
    ...command,
    steering: Math.max(-1, Math.min(1, command.steering + trim)),
  };
}
