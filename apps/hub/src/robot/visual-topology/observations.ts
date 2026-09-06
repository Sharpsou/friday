import { type RobotState } from '@friday/contracts';
import type Database from 'better-sqlite3';
import type { RobotVisionKeyframe } from '../robot-controller.js';
import type {
  RobotPlaceRecognitionEngine,
  RobotVisualMask,
  RobotVisualMotionFeatures,
} from '../robot-place-recognition.js';
import type { VisualObjectTracker } from './objects.js';
import {
  classifyVisualMotion,
  hammingDistance,
  isAcceptedPlaceMatch,
  isUsableVisual,
  toCandidate,
} from './policy.js';
import type { RobotVisualObservation } from './records.js';
import type { VisualTopologyRepository } from './repository.js';
import type { VisualObservationState } from './state.js';
import type { VisualTransitions } from './transitions.js';
export class VisualObservationProcessor {
  constructor(
    private readonly state: VisualObservationState,
    private readonly recognition: RobotPlaceRecognitionEngine | undefined,
    private readonly repository: VisualTopologyRepository,
    private readonly transitions: VisualTransitions,
    private readonly database: Database.Database,
    private readonly objects: VisualObjectTracker,
    private readonly householdId: string,
  ) {}
  async processObservation(
    state: RobotState,
    keyframe: RobotVisionKeyframe | null,
    epoch: number,
  ): Promise<RobotVisualObservation> {
    if (
      this.state.observationsPaused ||
      epoch !== this.state.observationEpoch ||
      Date.now() < this.state.settleUntil
    )
      return {
        confidence: 0,
        imageUsable: false,
        placeId: this.state.currentPlaceId,
        stable: false,
        motionState: 'uncertain',
        informationGain: 0,
      };
    if (!this.recognition || !state.vision || !keyframe)
      return {
        confidence: this.state.currentPlaceId ? 0.5 : 0,
        imageUsable: false,
        placeId: this.state.currentPlaceId,
        stable: false,
        motionState: 'uncertain',
        informationGain: 0,
      };
    if (state.vision.frameId === this.state.lastFrameId)
      return this.state.latestObservation;
    this.state.lastFrameId = state.vision.frameId;
    let rawMotion: RobotVisualMotionFeatures | null = null;
    if (this.state.lastImage) {
      try {
        rawMotion = await this.recognition.motion(
          this.state.lastImage,
          keyframe.image,
        );
      } catch {
        rawMotion = null;
      }
    }
    this.state.lastImage = Buffer.from(keyframe.image);
    const cameraMoved =
      this.state.lastCameraPose !== null &&
      (Math.abs(this.state.lastCameraPose.pan - state.cameraPose.pan) > 0.015 ||
        Math.abs(this.state.lastCameraPose.tilt - state.cameraPose.tilt) >
          0.015);
    this.state.lastCameraPose = { ...state.cameraPose };
    const motionState = classifyVisualMotion(
      rawMotion,
      cameraMoved,
      this.state.lastDrive && Date.now() - this.state.lastDrive.at <= 1_000
        ? this.state.lastDrive.direction
        : null,
    );
    this.state.lastVisibleObjectLabels = new Set(
      state.vision.detections
        .filter(
          (item) =>
            item.kind === 'object' &&
            item.confidence !== null &&
            item.confidence >= 0.35,
        )
        .map((item) => item.label),
    );
    if (motionState === 'translation' && rawMotion) {
      if (this.state.traversal)
        this.state.traversal.translationScore += rawMotion.medianFlowPx;
      else
        this.state.unlocalizedTranslationScore += Math.max(
          0,
          rawMotion.medianFlowPx,
        );
    }
    const personDetections = state.vision.detections.filter(
      (item) => item.kind === 'person' || item.kind === 'identity',
    );
    const masks: RobotVisualMask[] = personDetections.map((item) => ({
      height: item.height,
      width: item.width,
      x: item.x,
      y: item.y,
    }));
    const features = await this.recognition.extract(keyframe.image, masks);
    this.state.lastFeatures = features;
    if (epoch !== this.state.observationEpoch || this.state.observationsPaused)
      return {
        confidence: 0,
        imageUsable: false,
        placeId: this.state.currentPlaceId,
        stable: false,
        motionState,
        informationGain: 0,
      };
    const imageUsable = isUsableVisual(features);
    if (!imageUsable)
      return {
        confidence: 0,
        imageUsable: false,
        placeId: this.state.currentPlaceId,
        stable: false,
        motionState,
        informationGain: 0,
      };

    const rows = this.repository.readCandidateViews();
    const matches = await this.recognition.match(
      features,
      rows.map(toCandidate),
    );
    if (epoch !== this.state.observationEpoch || this.state.observationsPaused)
      return {
        confidence: 0,
        imageUsable: false,
        placeId: this.state.currentPlaceId,
        stable: false,
        motionState,
        informationGain: 0,
      };
    const accepted = matches.filter(isAcceptedPlaceMatch).map((match) => ({
      ...match,
      placeId: rows.find((row) => row.id === match.candidateId)!.place_id,
    }));
    const ranked = this.transitions.rankBySequence(accepted);
    if (ranked[0]) {
      const ambiguous =
        ranked[1] &&
        ranked[1].placeId !== ranked[0].placeId &&
        ranked[0].rank - ranked[1].rank < 0.08;
      const placeId = ranked[0].placeId;
      const stableFrame = motionState === 'stationary';
      this.state.matchBelief =
        stableFrame && !ambiguous && this.state.matchBelief?.placeId === placeId
          ? {
              count: this.state.matchBelief.count + 1,
              placeId,
              score: (this.state.matchBelief.score + ranked[0].score) / 2,
            }
          : {
              count: stableFrame && !ambiguous ? 1 : 0,
              placeId,
              score: ranked[0].score,
            };
      if (this.state.matchBelief.count < 3) {
        return {
          confidence: ambiguous ? 0.4 : ranked[0].score,
          imageUsable: true,
          placeId: this.state.currentPlaceId,
          stable: false,
          motionState,
          informationGain: ambiguous ? -0.1 : 0.1,
        };
      }
      const returningToPlace =
        this.state.currentPlaceId !== null &&
        this.state.currentPlaceId !== placeId;
      this.database
        .prepare(
          `UPDATE robot_visual_places
              SET status = CASE WHEN ? THEN 'ambiguous'
                                WHEN observation_count >= 1 THEN 'confirmed'
                                ELSE status END,
                  confidence = ?, observation_count = observation_count + 1,
                  last_seen_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          ambiguous ? 1 : 0,
          ambiguous ? 0.4 : ranked[0].score,
          keyframe.observedAt,
          keyframe.observedAt,
          placeId,
        );
      this.transitions.enterPlace(
        placeId,
        ranked[0].score,
        keyframe.observedAt,
      );
      this.repository.persistViewIfUseful(
        placeId,
        state,
        keyframe,
        features,
        personDetections.length > 0,
      );
      this.objects.persistObjects(placeId, state, returningToPlace);
      this.state.novelPlace = null;
      return {
        confidence: ranked[0].score,
        imageUsable: true,
        placeId,
        stable: true,
        motionState,
        informationGain: returningToPlace ? 0.5 : 0,
      };
    }

    this.state.matchBelief = null;

    const placeCount = this.database
      .prepare(
        'SELECT COUNT(*) AS count FROM robot_visual_places WHERE household_id = ?',
      )
      .get(this.householdId) as { count: number };
    const stationary = motionState === 'stationary';
    if (
      stationary &&
      this.state.novelPlace &&
      hammingDistance(
        this.state.novelPlace.features.perceptualHash,
        features.perceptualHash,
      ) <= 10
    ) {
      this.state.novelPlace = {
        count: this.state.novelPlace.count + 1,
        features,
        keyframe,
        startedAt: this.state.novelPlace.startedAt,
        state,
      };
    } else if (stationary) {
      this.state.novelPlace = {
        count: 1,
        features,
        keyframe,
        startedAt: Date.parse(keyframe.observedAt),
        state,
      };
    } else {
      this.state.novelPlace = null;
    }
    const hasTranslationEvidence =
      placeCount.count === 0 ||
      (this.state.traversal?.translationScore ?? 0) >= 6 ||
      this.state.unlocalizedTranslationScore >= 6;
    if (
      !this.state.novelPlace ||
      this.state.novelPlace.count < 6 ||
      Date.parse(keyframe.observedAt) - this.state.novelPlace.startedAt <
        1_500 ||
      !hasTranslationEvidence
    )
      return {
        confidence: 0.2,
        imageUsable: true,
        placeId: this.state.currentPlaceId,
        stable: false,
        motionState,
        informationGain: 0,
      };
    const pending = this.state.novelPlace;
    this.state.novelPlace = null;
    const placeId = this.transitions.createPlace(
      pending.state,
      pending.keyframe,
      pending.features,
      personDetections.length > 0,
    );
    return {
      confidence: 0.45,
      imageUsable: true,
      placeId,
      stable: true,
      motionState,
      informationGain: 0.5,
    };
  }
}
