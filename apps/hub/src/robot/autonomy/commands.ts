import {
  type RobotCameraLookRequest,
  type RobotDirection,
  type RobotDriveRequest,
} from '@friday/contracts';
import { MOTION_WATCHDOG_MS } from './policy.js';
import type { AutonomyState } from './state.js';
export class AutonomyCommands {
  constructor(private readonly state: AutonomyState) {}
  driveCommand(
    direction: RobotDirection,
    intensity = this.state.desiredIntensity,
    maxDurationMs = MOTION_WATCHDOG_MS,
  ): RobotDriveRequest {
    return this.refreshCommand({
      commandId: crypto.randomUUID(),
      direction,
      expiresAt: new Date().toISOString(),
      intensity: Math.min(0.35, Math.max(0.1, intensity)),
      issuedAt: new Date().toISOString(),
      maxDurationMs,
      steering:
        direction === 'forward' ? this.state.steeringTrimPercent / 100 : 0,
    });
  }
  refreshCommand(command: RobotDriveRequest): RobotDriveRequest {
    const now = Date.now();
    return {
      ...command,
      commandId: crypto.randomUUID(),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 1_800).toISOString(),
    };
  }
  lookCommand(pan: number, tilt: number): RobotCameraLookRequest {
    const now = Date.now();
    return {
      commandId: crypto.randomUUID(),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 1_800).toISOString(),
      pan,
      tilt,
    };
  }
}
