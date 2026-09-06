import { type RobotVisualObservation } from '../robot-visual-topology.js';
import {
  MOTION_SETTLE_MS,
  MOTION_STABLE_FRAMES,
  stabilizationFrameCount,
} from './policy.js';
import type { AutonomyState } from './state.js';
export class AutonomyMotionCycle {
  constructor(private readonly state: AutonomyState) {}
  motionCycleReady(observation: RobotVisualObservation): boolean {
    if (
      this.state.pendingMotionBurstDurationMs > 0 ||
      this.state.motionBurstEndsAt > 0
    )
      return false;
    if (this.state.stabilizationNotBefore === 0) return true;
    const now = Date.now();
    if (now < this.state.stabilizationNotBefore) {
      this.state.stabilizationFrameCount = 0;
      this.state.action = null;
      this.state.blockReason = 'stabilizing';
      this.state.reason = 'Repos mécanique avant analyse visuelle.';
      return false;
    }
    this.state.stabilizationFrameCount = stabilizationFrameCount(
      this.state.stabilizationFrameCount,
      observation,
    );
    if (this.state.stabilizationFrameCount < MOTION_STABLE_FRAMES) {
      this.state.action = null;
      this.state.blockReason = 'stabilizing';
      this.state.reason = `Analyse stable ${this.state.stabilizationFrameCount.toString()}/${MOTION_STABLE_FRAMES.toString()}.`;
      return false;
    }
    this.state.stabilizationNotBefore = 0;
    this.state.stabilizationFrameCount = 0;
    this.state.blockReason = null;
    return true;
  }
  resetMotionCycle(): void {
    this.state.pendingMotionBurstDurationMs = 0;
    this.state.motionBurstEndsAt = 0;
    this.state.stabilizationNotBefore = 0;
    this.state.stabilizationFrameCount = 0;
  }
  beginStabilization(reason: string): void {
    this.state.pendingMotionBurstDurationMs = 0;
    this.state.motionBurstEndsAt = 0;
    this.state.stabilizationNotBefore = Date.now() + MOTION_SETTLE_MS;
    this.state.stabilizationFrameCount = 0;
    this.state.action = null;
    this.state.blockReason = 'stabilizing';
    this.state.reason = reason;
  }
}
