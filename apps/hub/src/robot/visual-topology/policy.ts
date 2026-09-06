import { type RobotDirection } from '@friday/contracts';
import type {
  RobotPlaceCandidate,
  RobotPlaceSignatureFeatures,
  RobotVisualMotionFeatures,
} from '../robot-place-recognition.js';
import type {
  MergeViewRow,
  RobotVisualMotionState,
  ViewRow,
} from './records.js';

export const MAX_PLACES = 128;

export const MAX_VIEWS_PER_PLACE = 3;

export const MAX_OBJECTS = 512;

export const MAX_IMAGE_BYTES = 128 * 1_024;

export const IMAGE_QUOTA_BYTES = 32 * 1_024 * 1_024;

export const DESCRIPTOR_QUOTA_BYTES = 8 * 1_024 * 1_024;

export const PROVISIONAL_TTL_MS = 7 * 24 * 60 * 60_000;

export const OBJECT_REAPPEAR_GAP_MS = 30_000;

export const OBJECT_HEARTBEAT_MS = 30_000;

export function toCandidate(row: ViewRow): RobotPlaceCandidate {
  return {
    id: row.id,
    descriptors: row.descriptors.toString('base64'),
    featureCount: row.feature_count,
    keypoints: JSON.parse(row.keypoints_json) as Array<
      [number, number, number]
    >,
    luminance: row.luminance,
    perceptualHash: row.perceptual_hash,
    quality: row.quality,
  };
}

export function isUsableVisual(features: RobotPlaceSignatureFeatures): boolean {
  return (
    features.luminance >= 20 &&
    features.quality >= 45 &&
    features.featureCount >= 45
  );
}

export function isAcceptedPlaceMatch(match: {
  coverage: number;
  inlierRatio: number;
  inliers: number;
  rawMatches: number;
}): boolean {
  return (
    match.rawMatches >= 30 &&
    match.inliers >= 18 &&
    match.inlierRatio >= 0.45 &&
    match.coverage >= 3
  );
}

export function isCorroboratedPanoramaMatch(match: {
  coverage: number;
  inlierRatio: number;
  inliers: number;
  rawMatches: number;
  score: number;
}): boolean {
  return (
    match.rawMatches >= 22 &&
    match.inliers >= 12 &&
    match.inlierRatio >= 0.35 &&
    match.coverage >= 2.5 &&
    match.score >= 0.58
  );
}

export function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let bits =
      Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16);
    while (bits > 0) {
      distance += bits & 1;
      bits >>>= 1;
    }
  }
  return distance;
}

export function classifyVisualMotion(
  motion: RobotVisualMotionFeatures | null,
  cameraMoved: boolean,
  driveDirection: RobotDirection | null,
): RobotVisualMotionState {
  if (cameraMoved) return 'camera_rotation';
  if (!motion || motion.trackCount < 12 || motion.coherence < 0.25)
    return 'uncertain';
  if (motion.medianFlowPx < 0.8 && Math.abs(motion.rotationRad) < 0.01)
    return 'stationary';
  if (driveDirection === 'left' || driveDirection === 'right')
    return 'body_rotation';
  if (
    (driveDirection === 'forward' || driveDirection === 'backward') &&
    motion.medianFlowPx >= 1.2
  )
    return 'translation';
  return Math.abs(motion.rotationRad) >= 0.015 ? 'body_rotation' : 'uncertain';
}

export function dominantDirection(
  directions: RobotDirection[],
): RobotDirection {
  const counts = new Map<RobotDirection, number>();
  for (const direction of directions)
    counts.set(direction, (counts.get(direction) ?? 0) + 1);
  return (
    [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    'forward'
  );
}

export function inverseDirection(direction: RobotDirection): RobotDirection {
  if (direction === 'left') return 'right';
  if (direction === 'right') return 'left';
  if (direction === 'forward') return 'backward';
  if (direction === 'backward') return 'forward';
  return 'forward';
}

export function trimSectorFeatures(
  features: RobotPlaceSignatureFeatures,
): RobotPlaceSignatureFeatures {
  const count = Math.min(150, features.featureCount);
  return {
    ...features,
    featureCount: count,
    keypoints: features.keypoints.slice(0, count),
    descriptors: Buffer.from(features.descriptors, 'base64')
      .subarray(0, count * 32)
      .toString('base64'),
  };
}

export function selectMergedPlaceViews(
  views: MergeViewRow[],
  targetPlaceId: string,
  sourcePlaceId: string,
): string[] {
  const selected: MergeViewRow[] = [];
  const addBest = (placeId: string) => {
    const best = views
      .filter((view) => view.place_id === placeId)
      .toSorted((left, right) => right.quality - left.quality)[0];
    if (best && !selected.some((view) => view.id === best.id))
      selected.push(best);
  };
  addBest(targetPlaceId);
  addBest(sourcePlaceId);
  while (selected.length < MAX_VIEWS_PER_PLACE) {
    const remaining = views.filter(
      (candidate) => !selected.some((view) => view.id === candidate.id),
    );
    if (remaining.length === 0) break;
    const scored = remaining.map((candidate) => ({
      candidate,
      diversity:
        selected.length === 0
          ? 0
          : Math.min(
              ...selected.map(
                (view) =>
                  Math.abs(candidate.luminance - view.luminance) / 255 +
                  Math.abs(candidate.pan - view.pan) +
                  Math.abs(candidate.tilt - view.tilt),
              ),
            ),
    }));
    scored.sort(
      (left, right) =>
        right.diversity - left.diversity ||
        right.candidate.quality - left.candidate.quality,
    );
    selected.push(scored[0]!.candidate);
  }
  return selected.map((view) => view.id);
}
