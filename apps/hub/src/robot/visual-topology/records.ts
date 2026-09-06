import {
  type RobotDirection,
  type RobotState,
  type RobotVisualGraph,
} from '@friday/contracts';
import type { RobotVisionKeyframe } from '../robot-controller.js';
import type { RobotPlaceSignatureFeatures } from '../robot-place-recognition.js';

export interface ViewRow {
  descriptors: Buffer;
  feature_count: number;
  id: string;
  keypoints_json: string;
  perceptual_hash: string;
  place_id: string;
  quality: number;
  luminance: number;
}

export interface NovelPlaceEvidence {
  count: number;
  features: RobotPlaceSignatureFeatures;
  keyframe: RobotVisionKeyframe;
  startedAt: number;
  state: RobotState;
}

export interface MatchBelief {
  count: number;
  placeId: string;
  score: number;
}

export interface TraversalEvidence {
  directions: RobotDirection[];
  fromPlaceId: string;
  startedAt: number;
  translationScore: number;
}

export type RobotVisualMotionState =
  | 'stationary'
  | 'camera_rotation'
  | 'body_rotation'
  | 'translation'
  | 'uncertain';

export interface ObjectPresence {
  lastPersistedAt: number;
  lastSeenAt: number;
}

export interface PanoramaSessionEvidence {
  canonicalFeatures: RobotPlaceSignatureFeatures | null;
  canonicalObjects: Set<string>;
  captureCount: number;
  objectOccurrences: Map<string, number>;
  placeId: string;
}

export interface MergeViewRow {
  id: string;
  luminance: number;
  pan: number;
  place_id: string;
  quality: number;
  tilt: number;
}

export interface RobotVisualObservation {
  imageUsable: boolean;
  placeId: string | null;
  confidence: number;
  stable: boolean;
  motionState: RobotVisualMotionState;
  informationGain: number;
}

export interface RobotVisualMemoryPurgeResult {
  deletedPlaces: number;
  deletedViews: number;
  deletedTransitions: number;
  deletedObjects: number;
  graph: RobotVisualGraph;
}
