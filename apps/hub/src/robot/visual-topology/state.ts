import { type RobotDirection } from '@friday/contracts';
import type { RobotPlaceSignatureFeatures } from '../robot-place-recognition.js';
import type {
  MatchBelief,
  NovelPlaceEvidence,
  ObjectPresence,
  PanoramaSessionEvidence,
  RobotVisualObservation,
  TraversalEvidence,
} from './records.js';
export class VisualObservationState {
  currentPlaceId: string | null = null;
  lastFrameId: number | null = null;
  novelPlace: NovelPlaceEvidence | null = null;
  matchBelief: MatchBelief | null = null;
  traversal: TraversalEvidence | null = null;
  lastDrive: { at: number; direction: RobotDirection } | null = null;
  unlocalizedTranslationScore = 0;
  lastImage: Buffer | null = null;
  lastCameraPose: { pan: number; tilt: number } | null = null;
  lastFeatures: RobotPlaceSignatureFeatures | null = null;
  observationEpoch = 0;
  observationsPaused = false;
  readonly objectPresence = new Map<string, ObjectPresence>();
  lastVisibleObjectLabels = new Set<string>();
  panoramaSession: PanoramaSessionEvidence | null = null;
  settleUntil = 0;
  latestObservation: RobotVisualObservation = {
    confidence: 0,
    imageUsable: false,
    placeId: null,
    stable: false,
    motionState: 'uncertain',
    informationGain: 0,
  };

  pauseObservations(): void {
    this.observationEpoch += 1;
    this.observationsPaused = true;
    this.novelPlace = null;
    this.matchBelief = null;
  }
  resumeObservationsAfter(durationMs: number): void {
    this.observationsPaused = false;
    this.settleUntil = Date.now() + durationMs;
  }
  resetRuntimeAfterGraphMutation(placeId: string | null): void {
    this.lastFrameId = null;
    this.novelPlace = null;
    this.matchBelief = null;
    this.traversal = null;
    this.lastImage = null;
    this.objectPresence.clear();
    this.lastVisibleObjectLabels.clear();
    this.panoramaSession = null;
    this.latestObservation = {
      confidence: placeId ? 0.5 : 0,
      imageUsable: false,
      placeId,
      stable: false,
      motionState: 'uncertain',
      informationGain: 0,
    };
  }
}
