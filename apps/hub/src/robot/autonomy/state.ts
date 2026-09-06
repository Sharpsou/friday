import {
  type RobotAutonomyAction,
  type RobotAutonomyStatus,
  type RobotDirection,
} from '@friday/contracts';
import {
  type RobotHabitChoice,
  type RobotHabitContext,
} from '../robot-habit-learning.js';
import { type RobotVisualObservation } from '../robot-visual-topology.js';
import {
  type GraphEvidence,
  type RecoveryCapture,
  type RecoveryReplay,
} from './policy.js';
export class AutonomyState {
  controlEpoch = 0;
  startingEpoch: number | null = null;
  stopping = false;
  runId: string | null = null;
  routeTrialId: string | null = null;
  routeSegmentPlaceId: string | null = null;
  routeSegmentStartedAt = 0;
  routePlacePath: string[] = [];
  startedAt: string | null = null;
  updatedAt = new Date().toISOString();
  mode: RobotAutonomyStatus['status'] = 'inactive';
  action: RobotAutonomyAction | null = null;
  targetPlaceId: string | null = null;
  allowCandidatePath = false;
  powerPercent = 20;
  steeringTrimPercent = 0;
  panoramaPulseMs = 220;
  reward: number | null = null;
  reason: string | null = null;
  confidence = 0;
  habitConfidence = 0;
  informationGain = 0;
  imageUsable = false;
  motionState: RobotVisualObservation['motionState'] = 'uncertain';
  blockReason: RobotAutonomyStatus['blockReason'] = 'stabilizing';
  learningStepCount = 0;
  lastUsableImageAt = Date.now();
  lastOutcome: RobotHabitContext['previousOutcome'] = 'none';
  lastEvidence: GraphEvidence = {
    confirmedPlaces: 0,
    confirmedTransitions: 0,
    resolvedPorts: 0,
  };
  previousChoice: RobotHabitChoice | null = null;
  previousChoiceAt = 0;
  readonly recentActions: Array<{
    action: RobotAutonomyAction;
    at: number;
  }> = [];
  desiredDirection: RobotDirection | null = null;
  desiredIntensity = 0.12;
  pendingMotionBurstDurationMs = 0;
  motionBurstEndsAt = 0;
  stabilizationNotBefore = 0;
  stabilizationFrameCount = 0;
  unlocalizedNextPulseAt = 0;
  unlocalizedPulseCount = 0;
  unlocalizedStableFrameCount = 0;
  recovery: RecoveryCapture | null = null;
  replay: RecoveryReplay | null = null;
}
