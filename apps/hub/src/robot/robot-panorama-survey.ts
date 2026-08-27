import type {
  RobotCameraLookRequest,
  RobotDirection,
  RobotDriveRequest,
  RobotState,
} from '@friday/contracts';

import type { RobotController } from './robot-controller.js';
import type {
  RobotVisualObservation,
  RobotVisualTopologyService,
} from './robot-visual-topology.js';

const SETTLE_MS = 700;
const DEFAULT_PULSE_MS = 220;
const MIN_PULSE_MS = 120;
const MAX_PULSE_MS = 1_000;
const COMMAND_WATCHDOG_MS = 500;
const COMMAND_RENEW_MS = 200;
const UNUSABLE_VIEW_SKIP_MS = 2_000;

type PanoramaPhase =
  'idle' | 'stabilizing' | 'rotating' | 'settling' | 'complete' | 'incomplete';

export interface RobotPanoramaStatus {
  active: boolean;
  impulseCount: number;
  phase: PanoramaPhase;
  sectorCount: number;
}

export class RobotPanoramaSurveyController {
  private phase: PanoramaPhase = 'idle';
  private phaseUntil = 0;
  private rotationRenewAt = 0;
  private stabilizationDeadline = 0;
  private stableFrames = 0;
  private impulseCount = 0;
  private sectorCount = 0;
  private pulseMs = DEFAULT_PULSE_MS;
  private driveIntensity = 0.2;
  private direction: Extract<RobotDirection, 'left' | 'right'> = 'right';

  constructor(
    private readonly robot: RobotController,
    private readonly topology: RobotVisualTopologyService,
    private readonly driveCommand: (
      direction: Extract<RobotDirection, 'left' | 'right'>,
      intensity: number,
      durationMs: number,
    ) => RobotDriveRequest,
    private readonly lookCommand: (
      pan: number,
      tilt: number,
    ) => RobotCameraLookRequest,
  ) {}

  status(): RobotPanoramaStatus {
    return {
      active: !['idle', 'complete', 'incomplete'].includes(this.phase),
      impulseCount: this.impulseCount,
      phase: this.phase,
      sectorCount: this.sectorCount,
    };
  }

  setPulseDuration(durationMs: number): void {
    this.pulseMs = Math.max(
      MIN_PULSE_MS,
      Math.min(MAX_PULSE_MS, Math.round(durationMs)),
    );
  }

  setDriveIntensity(intensity: number): void {
    this.driveIntensity = Math.max(0.1, Math.min(0.35, intensity));
  }

  async start(state: RobotState): Promise<boolean> {
    if (this.status().active || !this.topology.panoramaProgress().placeId)
      return false;
    if (
      state.telemetry.irLeftClear === false &&
      state.telemetry.irRightClear === false
    )
      return false;
    this.direction = state.telemetry.irRightClear === false ? 'left' : 'right';
    this.impulseCount = 0;
    this.sectorCount = this.topology.panoramaProgress().sectorCount;
    this.stableFrames = 0;
    this.rotationRenewAt = 0;
    this.topology.beginPanoramaSession();
    await this.robot.stop();
    this.topology.pauseObservations();
    try {
      await this.robot.look(this.lookCommand(0, 0.2));
    } finally {
      this.topology.resumeObservationsAfter(SETTLE_MS);
    }
    this.phase = 'stabilizing';
    this.phaseUntil = Date.now() + SETTLE_MS;
    this.stabilizationDeadline = this.phaseUntil + UNUSABLE_VIEW_SKIP_MS;
    return true;
  }

  async tick(
    state: RobotState,
    observation: RobotVisualObservation,
  ): Promise<RobotPanoramaStatus> {
    if (!this.status().active) return this.status();
    if (
      !state.actuators.wheelsEnabled ||
      (state.telemetry.irLeftClear === false &&
        state.telemetry.irRightClear === false)
    ) {
      await this.finish(false);
      return this.status();
    }
    if (this.phase === 'rotating') {
      const now = Date.now();
      if (now >= this.phaseUntil) {
        await this.robot.stop();
        this.topology.resumeObservationsAfter(SETTLE_MS);
        this.phase = 'settling';
        this.phaseUntil = now + SETTLE_MS;
        this.rotationRenewAt = 0;
        this.stabilizationDeadline = this.phaseUntil + UNUSABLE_VIEW_SKIP_MS;
        this.stableFrames = 0;
      } else if (now >= this.rotationRenewAt) {
        const remainingMs = this.phaseUntil - now;
        if (remainingMs >= 100)
          await this.robot.drive(
            this.driveCommand(
              this.direction,
              this.driveIntensity,
              Math.min(COMMAND_WATCHDOG_MS, remainingMs),
            ),
          );
        this.rotationRenewAt = now + COMMAND_RENEW_MS;
      }
      return this.status();
    }
    if (this.phase === 'settling' && Date.now() >= this.phaseUntil)
      this.phase = 'stabilizing';
    if (this.phase !== 'stabilizing' || Date.now() < this.phaseUntil)
      return this.status();
    this.stableFrames =
      observation.imageUsable && observation.motionState === 'stationary'
        ? this.stableFrames + 1
        : 0;
    if (this.stableFrames < 3) {
      if (Date.now() >= this.stabilizationDeadline)
        await this.startRotationPulse();
      return this.status();
    }
    const captured = await this.topology.captureStablePanoramaSector();
    this.sectorCount = captured.sectorCount;
    this.stableFrames = 0;
    if (captured.complete) {
      await this.finish(true);
      return this.status();
    }
    await this.startRotationPulse();
    return this.status();
  }

  async cancel(): Promise<void> {
    if (!this.status().active) return;
    await this.finish(false);
  }

  private async finish(complete: boolean): Promise<void> {
    await this.robot.stop();
    this.topology.resumeObservationsAfter(SETTLE_MS);
    if (!complete) this.topology.markPanoramaIncomplete();
    this.phase = complete ? 'complete' : 'incomplete';
    this.rotationRenewAt = 0;
    this.stabilizationDeadline = 0;
  }

  private async startRotationPulse(): Promise<void> {
    this.topology.pauseObservations();
    this.topology.recordDriveCommand(this.direction);
    await this.robot.drive(
      this.driveCommand(
        this.direction,
        this.driveIntensity,
        Math.min(COMMAND_WATCHDOG_MS, this.pulseMs),
      ),
    );
    const now = Date.now();
    this.impulseCount += 1;
    this.phase = 'rotating';
    this.phaseUntil = now + this.pulseMs;
    this.rotationRenewAt = now + COMMAND_RENEW_MS;
    this.stabilizationDeadline = 0;
    this.stableFrames = 0;
  }
}
