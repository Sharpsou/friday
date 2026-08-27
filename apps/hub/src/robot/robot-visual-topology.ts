import type Database from 'better-sqlite3';

import {
  RobotVisualGraphSchema,
  type RobotDirection,
  type RobotState,
  type RobotVisualGraph,
  type RobotVisualMemoryPurgeScope,
} from '@friday/contracts';

import type { RobotVisionKeyframe } from './robot-controller.js';
import type {
  RobotPlaceCandidate,
  RobotPlaceRecognitionEngine,
  RobotPlaceSignatureFeatures,
  RobotVisualMask,
  RobotVisualMotionFeatures,
} from './robot-place-recognition.js';

const MAX_PLACES = 128;
const MAX_VIEWS_PER_PLACE = 3;
const MAX_OBJECTS = 512;
const MAX_IMAGE_BYTES = 128 * 1_024;
const IMAGE_QUOTA_BYTES = 32 * 1_024 * 1_024;
const DESCRIPTOR_QUOTA_BYTES = 8 * 1_024 * 1_024;
const PROVISIONAL_TTL_MS = 7 * 24 * 60 * 60_000;
const OBJECT_REAPPEAR_GAP_MS = 30_000;
const OBJECT_HEARTBEAT_MS = 30_000;

interface ViewRow {
  descriptors: Buffer;
  feature_count: number;
  id: string;
  keypoints_json: string;
  perceptual_hash: string;
  place_id: string;
  quality: number;
  luminance: number;
}

interface NovelPlaceEvidence {
  count: number;
  features: RobotPlaceSignatureFeatures;
  keyframe: RobotVisionKeyframe;
  startedAt: number;
  state: RobotState;
}

interface MatchBelief {
  count: number;
  placeId: string;
  score: number;
}

interface TraversalEvidence {
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

interface ObjectPresence {
  lastPersistedAt: number;
  lastSeenAt: number;
}

interface PanoramaSessionEvidence {
  canonicalFeatures: RobotPlaceSignatureFeatures | null;
  canonicalObjects: Set<string>;
  captureCount: number;
  objectOccurrences: Map<string, number>;
  placeId: string;
}

interface MergeViewRow {
  id: string;
  luminance: number;
  pan: number;
  place_id: string;
  quality: number;
  tilt: number;
}

export class RobotVisualTopologyError extends Error {
  constructor(
    readonly code: 'conflict' | 'not_found',
    message: string,
  ) {
    super(message);
  }
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

export class RobotVisualTopologyService {
  private currentPlaceId: string | null = null;
  private lastFrameId: number | null = null;
  private novelPlace: NovelPlaceEvidence | null = null;
  private matchBelief: MatchBelief | null = null;
  private traversal: TraversalEvidence | null = null;
  private lastDrive: { at: number; direction: RobotDirection } | null = null;
  private unlocalizedTranslationScore = 0;
  private lastImage: Buffer | null = null;
  private lastCameraPose: { pan: number; tilt: number } | null = null;
  private lastFeatures: RobotPlaceSignatureFeatures | null = null;
  private observationEpoch = 0;
  private observationsPaused = false;
  private readonly objectPresence = new Map<string, ObjectPresence>();
  private lastVisibleObjectLabels = new Set<string>();
  private panoramaSession: PanoramaSessionEvidence | null = null;
  private settleUntil = 0;
  private latestObservation: RobotVisualObservation = {
    confidence: 0,
    imageUsable: false,
    placeId: null,
    stable: false,
    motionState: 'uncertain',
    informationGain: 0,
  };
  private queue = Promise.resolve<RobotVisualObservation>({
    confidence: 0,
    imageUsable: false,
    placeId: null,
    stable: false,
    motionState: 'uncertain',
    informationGain: 0,
  });

  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly recognition?: RobotPlaceRecognitionEngine,
  ) {
    this.expireProvisionalPlaces();
  }

  observe(
    state: RobotState,
    keyframe: RobotVisionKeyframe | null,
  ): Promise<RobotVisualObservation> {
    const epoch = this.observationEpoch;
    this.queue = this.queue
      .catch(() => ({
        confidence: 0,
        imageUsable: false,
        placeId: null,
        stable: false,
        motionState: 'uncertain' as const,
        informationGain: 0,
      }))
      .then(() => this.processObservation(state, keyframe, epoch))
      .then((observation) => {
        this.latestObservation = observation;
        return observation;
      });
    return this.queue;
  }

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

  recordDriveCommand(direction: RobotDirection): void {
    const now = Date.now();
    this.lastDrive = { at: now, direction };
    if (!this.currentPlaceId) return;
    if (!this.traversal || this.traversal.fromPlaceId !== this.currentPlaceId) {
      this.traversal = {
        directions: [direction],
        fromPlaceId: this.currentPlaceId,
        startedAt: now,
        translationScore: 0,
      };
      return;
    }
    if (this.traversal.directions.at(-1) !== direction)
      this.traversal.directions.push(direction);
  }

  snapshot(): RobotVisualGraph {
    const places = this.database
      .prepare(
        `SELECT p.id, p.status, p.label, p.confidence, p.panorama_status,
                p.canonical_sector_id,
                COUNT(DISTINCT v.id) AS view_count,
                COUNT(DISTINCT o.id) AS object_count,
                p.first_seen_at, p.last_seen_at
           FROM robot_visual_places p
           LEFT JOIN robot_visual_place_views v ON v.place_id = p.id
           LEFT JOIN robot_visual_objects o ON o.place_id = p.id
          WHERE p.household_id = ?
          GROUP BY p.id ORDER BY p.last_seen_at DESC LIMIT ?`,
      )
      .all(this.householdId, MAX_PLACES) as Array<Record<string, unknown>>;
    const views = this.database
      .prepare(
        `SELECT id, place_id, observed_at, pan, tilt, quality,
                image_jpeg IS NOT NULL AS has_image
           FROM robot_visual_place_views
          WHERE household_id = ? ORDER BY observed_at DESC LIMIT ?`,
      )
      .all(this.householdId, MAX_PLACES * MAX_VIEWS_PER_PLACE) as Array<
      Record<string, unknown>
    >;
    const transitions = this.database
      .prepare(
        `SELECT id, from_place_id, to_place_id, from_sector_id, to_sector_id,
                direction, status, confidence, traversal_count, success_count,
                failure_count, expected_duration_ms, last_traversed_at
           FROM robot_visual_transitions WHERE household_id = ?
          ORDER BY last_traversed_at DESC LIMIT 1024`,
      )
      .all(this.householdId) as Array<Record<string, unknown>>;
    const sectors = this.database
      .prepare(
        `SELECT id, place_id, ordinal, quality, observed_at, is_canonical
           FROM robot_visual_anchor_sectors WHERE household_id = ?
          ORDER BY place_id, ordinal LIMIT 1536`,
      )
      .all(this.householdId) as Array<Record<string, unknown>>;
    const ports = this.database
      .prepare(
        `SELECT id, place_id, sector_id, status, evidence_count,
                failure_count, blocked_until
           FROM robot_visual_ports WHERE household_id = ? LIMIT 1536`,
      )
      .all(this.householdId) as Array<Record<string, unknown>>;
    const objects = this.database
      .prepare(
        `SELECT id, place_id, class_label, display_name, confidence,
                sighting_count, last_seen_at
           FROM robot_visual_objects WHERE household_id = ?
          ORDER BY last_seen_at DESC LIMIT ?`,
      )
      .all(this.householdId, MAX_OBJECTS) as Array<Record<string, unknown>>;
    const storage = this.database
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(length(image_jpeg)), 0)
              FROM robot_visual_place_views WHERE household_id = ?) AS image_bytes,
           (SELECT COALESCE(SUM(length(descriptors)), 0)
              FROM robot_visual_place_views WHERE household_id = ?) +
           (SELECT COALESCE(SUM(length(descriptors)), 0)
              FROM robot_visual_anchor_sectors WHERE household_id = ?)
              AS descriptor_bytes`,
      )
      .get(this.householdId, this.householdId, this.householdId) as {
      descriptor_bytes: number;
      image_bytes: number;
    };

    return RobotVisualGraphSchema.parse({
      version:
        places.length +
        views.length +
        sectors.length +
        ports.length +
        transitions.length +
        objects.length,
      currentPlaceId: this.currentPlaceId,
      places: places.map((row) => ({
        id: row.id,
        status: row.status,
        label: row.label,
        confidence: row.confidence,
        viewCount: row.view_count,
        objectCount: row.object_count,
        panoramaStatus: row.panorama_status,
        canonicalSectorId: row.canonical_sector_id,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
      })),
      views: views.map((row) => ({
        id: row.id,
        placeId: row.place_id,
        observedAt: row.observed_at,
        pan: row.pan,
        tilt: row.tilt,
        quality: row.quality,
        hasImage: Boolean(row.has_image),
      })),
      sectors: sectors.map((row) => ({
        id: row.id,
        placeId: row.place_id,
        ordinal: row.ordinal,
        quality: row.quality,
        observedAt: row.observed_at,
        isCanonical: Boolean(row.is_canonical),
      })),
      ports: ports.map((row) => ({
        id: row.id,
        placeId: row.place_id,
        sectorId: row.sector_id,
        status: row.status,
        evidenceCount: row.evidence_count,
        failureCount: row.failure_count,
        blockedUntil: row.blocked_until,
      })),
      transitions: transitions.map((row) => ({
        id: row.id,
        fromPlaceId: row.from_place_id,
        toPlaceId: row.to_place_id,
        direction: row.direction,
        status: row.status,
        confidence: row.confidence,
        traversalCount: row.traversal_count,
        successCount: row.success_count,
        failureCount: row.failure_count,
        fromSectorId: row.from_sector_id,
        toSectorId: row.to_sector_id,
        expectedDurationMs: row.expected_duration_ms,
        lastTraversedAt: row.last_traversed_at,
      })),
      objects: objects.map((row) => ({
        id: row.id,
        placeId: row.place_id,
        classLabel: row.class_label,
        displayName: row.display_name,
        confidence: row.confidence,
        sightingCount: row.sighting_count,
        lastSeenAt: row.last_seen_at,
      })),
      storage: {
        imageBytes: storage.image_bytes,
        imageQuotaBytes: IMAGE_QUOTA_BYTES,
        descriptorBytes: storage.descriptor_bytes,
        descriptorQuotaBytes: DESCRIPTOR_QUOTA_BYTES,
      },
    });
  }

  image(
    placeId: string,
    viewId: string,
  ): { image: Buffer; observedAt: string } | null {
    const row = this.database
      .prepare(
        `SELECT image_jpeg, observed_at FROM robot_visual_place_views
          WHERE id = ? AND place_id = ? AND household_id = ?`,
      )
      .get(viewId, placeId, this.householdId) as
      { image_jpeg: Buffer | null; observed_at: string } | undefined;
    return row?.image_jpeg
      ? { image: row.image_jpeg, observedAt: row.observed_at }
      : null;
  }

  renameObject(id: string, displayName: string): RobotVisualGraph {
    const result = this.database
      .prepare(
        `UPDATE robot_visual_objects SET display_name = ?, updated_at = ?
          WHERE id = ? AND household_id = ?`,
      )
      .run(displayName, new Date().toISOString(), id, this.householdId);
    if (result.changes === 0) throw new Error('Objet visuel introuvable.');
    return this.snapshot();
  }

  renamePlace(id: string, label: string): RobotVisualGraph {
    const result = this.database
      .prepare(
        `UPDATE robot_visual_places SET label = ?, updated_at = ?
          WHERE id = ? AND household_id = ?`,
      )
      .run(label, new Date().toISOString(), id, this.householdId);
    if (result.changes === 0) throw new Error('Repère visuel introuvable.');
    return this.snapshot();
  }

  async mergePlaces(
    targetPlaceId: string,
    sourcePlaceId: string,
  ): Promise<RobotVisualGraph> {
    if (targetPlaceId === sourcePlaceId)
      throw new RobotVisualTopologyError(
        'conflict',
        'Un repère ne peut pas être fusionné avec lui-même.',
      );
    this.pauseObservations();
    await this.queue.catch(() => undefined);
    try {
      this.database.transaction(() => {
        const places = this.database
          .prepare(
            `SELECT id, status, label, confidence, observation_count,
                    first_seen_at, last_seen_at
               FROM robot_visual_places
              WHERE household_id = ? AND id IN (?, ?)`,
          )
          .all(this.householdId, targetPlaceId, sourcePlaceId) as Array<{
          confidence: number;
          first_seen_at: string;
          id: string;
          label: string | null;
          last_seen_at: string;
          observation_count: number;
          status: string;
        }>;
        const target = places.find((place) => place.id === targetPlaceId);
        const source = places.find((place) => place.id === sourcePlaceId);
        if (!target || !source)
          throw new RobotVisualTopologyError(
            'not_found',
            'Repère visuel introuvable.',
          );

        const views = this.database
          .prepare(
            `SELECT id, place_id, quality, luminance, pan, tilt
               FROM robot_visual_place_views
              WHERE household_id = ? AND place_id IN (?, ?)`,
          )
          .all(
            this.householdId,
            targetPlaceId,
            sourcePlaceId,
          ) as MergeViewRow[];
        const selectedViewIds = new Set(
          selectMergedPlaceViews(views, targetPlaceId, sourcePlaceId),
        );
        for (const view of views) {
          if (selectedViewIds.has(view.id)) {
            if (view.place_id === sourcePlaceId)
              this.database
                .prepare(
                  'UPDATE robot_visual_place_views SET place_id = ? WHERE id = ?',
                )
                .run(targetPlaceId, view.id);
          } else {
            this.database
              .prepare('DELETE FROM robot_visual_place_views WHERE id = ?')
              .run(view.id);
          }
        }

        this.mergePlaceObjects(targetPlaceId, sourcePlaceId);
        this.mergePlaceTransitions(targetPlaceId, sourcePlaceId);
        const now = new Date().toISOString();
        this.database
          .prepare(
            `UPDATE robot_visual_places
                SET status = 'confirmed', label = ?, confidence = ?,
                    observation_count = ?, first_seen_at = ?, last_seen_at = ?,
                    updated_at = ?
              WHERE household_id = ? AND id = ?`,
          )
          .run(
            target.label ?? source.label,
            Math.max(0.9, target.confidence, source.confidence),
            target.observation_count + source.observation_count,
            target.first_seen_at < source.first_seen_at
              ? target.first_seen_at
              : source.first_seen_at,
            target.last_seen_at > source.last_seen_at
              ? target.last_seen_at
              : source.last_seen_at,
            now,
            this.householdId,
            targetPlaceId,
          );
        this.deleteLearningForPlace(sourcePlaceId);
        this.database
          .prepare(
            'DELETE FROM robot_visual_places WHERE household_id = ? AND id = ?',
          )
          .run(this.householdId, sourcePlaceId);
      })();

      if (this.currentPlaceId === sourcePlaceId)
        this.currentPlaceId = targetPlaceId;
      this.resetRuntimeAfterGraphMutation(this.currentPlaceId);
      return this.snapshot();
    } finally {
      this.resumeObservationsAfter(700);
    }
  }

  async deletePlace(placeId: string): Promise<RobotVisualGraph> {
    this.pauseObservations();
    await this.queue.catch(() => undefined);
    try {
      this.database.transaction(() => {
        const exists = this.database
          .prepare(
            'SELECT 1 FROM robot_visual_places WHERE household_id = ? AND id = ?',
          )
          .get(this.householdId, placeId);
        if (!exists)
          throw new RobotVisualTopologyError(
            'not_found',
            'Repère visuel introuvable.',
          );
        this.deleteLearningForPlace(placeId);
        this.database
          .prepare(
            'DELETE FROM robot_visual_places WHERE household_id = ? AND id = ?',
          )
          .run(this.householdId, placeId);
      })();
      if (this.currentPlaceId === placeId) this.currentPlaceId = null;
      this.resetRuntimeAfterGraphMutation(this.currentPlaceId);
      return this.snapshot();
    } finally {
      this.resumeObservationsAfter(700);
    }
  }

  deleteObject(objectId: string): RobotVisualGraph {
    const row = this.database
      .prepare(
        `SELECT place_id, class_label FROM robot_visual_objects
          WHERE household_id = ? AND id = ?`,
      )
      .get(this.householdId, objectId) as
      { class_label: string; place_id: string } | undefined;
    if (!row)
      throw new RobotVisualTopologyError(
        'not_found',
        'Objet visuel introuvable.',
      );
    this.database
      .prepare(
        'DELETE FROM robot_visual_objects WHERE household_id = ? AND id = ?',
      )
      .run(this.householdId, objectId);
    this.objectPresence.delete(`${row.place_id}\u0000${row.class_label}`);
    return this.snapshot();
  }

  async purge(
    scope: RobotVisualMemoryPurgeScope,
  ): Promise<RobotVisualMemoryPurgeResult> {
    this.pauseObservations();
    await this.queue.catch(() => undefined);
    try {
      const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
      const rows = this.database
        .prepare(
          `SELECT id FROM robot_visual_places
            WHERE household_id = ?${scope === 'last_hour' ? ' AND first_seen_at >= ?' : ''}`,
        )
        .all(
          ...(scope === 'last_hour'
            ? [this.householdId, cutoff]
            : [this.householdId]),
        ) as Array<{ id: string }>;
      const placeIds = rows.map((row) => row.id);
      const placeholders = placeIds.map(() => '?').join(', ');
      const counts = {
        deletedPlaces: placeIds.length,
        deletedViews: 0,
        deletedTransitions: 0,
        deletedObjects: 0,
      };

      this.database.transaction(() => {
        if (placeIds.length > 0) {
          counts.deletedViews = (
            this.database
              .prepare(
                `SELECT COUNT(*) AS count FROM robot_visual_place_views
                  WHERE household_id = ? AND place_id IN (${placeholders})`,
              )
              .get(this.householdId, ...placeIds) as { count: number }
          ).count;
          counts.deletedTransitions = (
            this.database
              .prepare(
                `SELECT COUNT(*) AS count FROM robot_visual_transitions
                  WHERE household_id = ? AND
                    (from_place_id IN (${placeholders}) OR to_place_id IN (${placeholders}))`,
              )
              .get(this.householdId, ...placeIds, ...placeIds) as {
              count: number;
            }
          ).count;
          counts.deletedObjects = (
            this.database
              .prepare(
                `SELECT COUNT(*) AS count FROM robot_visual_objects
                  WHERE household_id = ? AND place_id IN (${placeholders})`,
              )
              .get(this.householdId, ...placeIds) as { count: number }
          ).count;

          this.database
            .prepare(
              `DELETE FROM robot_visual_places
                WHERE household_id = ? AND id IN (${placeholders})`,
            )
            .run(this.householdId, ...placeIds);
        }

        if (scope === 'all') {
          this.database
            .prepare('DELETE FROM robot_habit_values WHERE household_id = ?')
            .run(this.householdId);
          this.database
            .prepare('DELETE FROM robot_recovery_skills WHERE household_id = ?')
            .run(this.householdId);
        } else {
          for (const placeId of placeIds) {
            // Habit keys are intentionally place-agnostic and survive a
            // selective purge.  Only a full reset forgets procedural habits.
            this.database
              .prepare(
                `DELETE FROM robot_recovery_skills
                  WHERE household_id = ? AND instr(situation_key, ?) > 0`,
              )
              .run(this.householdId, placeId);
          }
        }
      })();

      this.currentPlaceId = null;
      this.lastFrameId = null;
      this.novelPlace = null;
      this.matchBelief = null;
      this.traversal = null;
      this.lastImage = null;
      this.objectPresence.clear();
      this.lastVisibleObjectLabels.clear();
      this.panoramaSession = null;
      this.latestObservation = {
        confidence: 0,
        imageUsable: false,
        placeId: null,
        stable: false,
        motionState: 'uncertain',
        informationGain: 0,
      };
      return { ...counts, graph: this.snapshot() };
    } finally {
      this.resumeObservationsAfter(700);
    }
  }

  hasConfirmedPlace(placeId: string): boolean {
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM robot_visual_places
            WHERE id = ? AND household_id = ? AND status = 'confirmed'`,
        )
        .get(placeId, this.householdId),
    );
  }

  hasConfirmedArrival(placeId: string): boolean {
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM robot_visual_transitions t
             JOIN robot_visual_places a ON a.id = t.from_place_id
             JOIN robot_visual_places b ON b.id = t.to_place_id
            WHERE t.household_id = ? AND t.to_place_id = ?
              AND a.status = 'confirmed' AND b.status = 'confirmed'
              AND t.status = 'confirmed'
            LIMIT 1`,
        )
        .get(this.householdId, placeId),
    );
  }

  confirmedPath(from: string, to: string): string[] | null {
    return this.navigationPath(from, to, false);
  }

  validationPath(from: string, to: string): string[] | null {
    return this.navigationPath(from, to, true);
  }

  panoramaProgress(): {
    complete: boolean;
    placeId: string | null;
    sectorCount: number;
  } {
    if (!this.currentPlaceId)
      return { complete: false, placeId: null, sectorCount: 0 };
    const row = this.database
      .prepare(
        `SELECT p.panorama_status,
                (SELECT COUNT(*) FROM robot_visual_anchor_sectors s
                  WHERE s.place_id = p.id) AS sector_count
           FROM robot_visual_places p
          WHERE p.household_id = ? AND p.id = ?`,
      )
      .get(this.householdId, this.currentPlaceId) as {
      panorama_status: string;
      sector_count: number;
    };
    return {
      complete: row.panorama_status === 'complete',
      placeId: this.currentPlaceId,
      sectorCount: row.sector_count,
    };
  }

  beginPanoramaSession(): void {
    this.panoramaSession = this.currentPlaceId
      ? {
          canonicalFeatures: null,
          canonicalObjects: new Set<string>(),
          captureCount: 0,
          objectOccurrences: new Map<string, number>(),
          placeId: this.currentPlaceId,
        }
      : null;
  }

  async captureStablePanoramaSector(): Promise<{
    added: boolean;
    complete: boolean;
    sectorCount: number;
  }> {
    const placeId = this.currentPlaceId;
    const features = this.lastFeatures;
    if (!placeId || !features || !this.recognition || !isUsableVisual(features))
      return { added: false, complete: false, sectorCount: 0 };
    const rows = this.database
      .prepare(
        `SELECT id, place_id, perceptual_hash, keypoints_json, descriptors,
                feature_count, quality, 0 AS luminance
           FROM robot_visual_anchor_sectors
          WHERE household_id = ? AND place_id = ? ORDER BY ordinal`,
      )
      .all(this.householdId, placeId) as ViewRow[];
    const session =
      this.panoramaSession?.placeId === placeId
        ? this.panoramaSession
        : {
            canonicalFeatures: null,
            canonicalObjects: new Set<string>(),
            captureCount: 0,
            objectOccurrences: new Map<string, number>(),
            placeId,
          };
    this.panoramaSession = session;
    const hasSessionStart = session.canonicalFeatures !== null;
    if (!session.canonicalFeatures) {
      session.canonicalFeatures = features;
      session.canonicalObjects = new Set(this.lastVisibleObjectLabels);
    }
    session.captureCount += 1;
    for (const label of this.lastVisibleObjectLabels)
      session.objectOccurrences.set(
        label,
        (session.objectOccurrences.get(label) ?? 0) + 1,
      );
    const sessionStartCandidateId = '__panorama_session_start__';
    const matches = await this.recognition.match(features, [
      ...rows.map(toCandidate),
      ...(hasSessionStart
        ? [
            {
              id: sessionStartCandidateId,
              descriptors: session.canonicalFeatures.descriptors,
              featureCount: session.canonicalFeatures.featureCount,
              keypoints: session.canonicalFeatures.keypoints,
              luminance: session.canonicalFeatures.luminance,
              perceptualHash: session.canonicalFeatures.perceptualHash,
              quality: session.canonicalFeatures.quality,
            },
          ]
        : []),
    ]);
    const canonicalMatch = matches.find(
      (match) => match.candidateId === sessionStartCandidateId,
    );
    const recurringCanonicalObject = [...session.canonicalObjects].some(
      (label) =>
        this.lastVisibleObjectLabels.has(label) &&
        (session.objectOccurrences.get(label) ?? 0) >= 3,
    );
    const perceptualDistance = hammingDistance(
      session.canonicalFeatures.perceptualHash,
      features.perceptualHash,
    );
    const strongVisualClosure =
      canonicalMatch &&
      isAcceptedPlaceMatch(canonicalMatch) &&
      canonicalMatch.score >= 0.7;
    const objectCorroboratedClosure =
      recurringCanonicalObject &&
      (perceptualDistance <= 12 ||
        (canonicalMatch && isCorroboratedPanoramaMatch(canonicalMatch)));
    if (
      rows.length >= 6 &&
      session.captureCount >= 6 &&
      (strongVisualClosure ||
        perceptualDistance <= 6 ||
        objectCorroboratedClosure)
    ) {
      this.database
        .prepare(
          `UPDATE robot_visual_places
              SET panorama_status = 'complete', status = 'confirmed',
                  updated_at = ? WHERE household_id = ? AND id = ?`,
        )
        .run(new Date().toISOString(), this.householdId, placeId);
      this.panoramaSession = null;
      return { added: false, complete: true, sectorCount: rows.length };
    }
    const duplicate = matches.some(
      (match) => isAcceptedPlaceMatch(match) && match.score >= 0.78,
    );
    if (duplicate || rows.length >= 12)
      return { added: false, complete: false, sectorCount: rows.length };
    const id = crypto.randomUUID();
    const ordinal = rows.length;
    const trimmed = trimSectorFeatures(features);
    const descriptorBytes = Buffer.from(
      trimmed.descriptors,
      'base64',
    ).byteLength;
    if (
      this.snapshot().storage.descriptorBytes + descriptorBytes >
      DESCRIPTOR_QUOTA_BYTES
    )
      return { added: false, complete: false, sectorCount: rows.length };
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO robot_visual_anchor_sectors(
             id, household_id, place_id, ordinal, perceptual_hash,
             keypoints_json, descriptors, feature_count, quality, observed_at,
             is_canonical
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.householdId,
          placeId,
          ordinal,
          trimmed.perceptualHash,
          JSON.stringify(trimmed.keypoints),
          Buffer.from(trimmed.descriptors, 'base64'),
          trimmed.featureCount,
          trimmed.quality,
          now,
          ordinal === 0 ? 1 : 0,
        );
      this.database
        .prepare(
          `INSERT INTO robot_visual_ports(
             id, household_id, place_id, sector_id, status, evidence_count,
             failure_count, blocked_until, updated_at
           ) VALUES (?, ?, ?, ?, 'unknown', 0, 0, NULL, ?)`,
        )
        .run(crypto.randomUUID(), this.householdId, placeId, id, now);
      this.database
        .prepare(
          `UPDATE robot_visual_places
              SET panorama_status = 'incomplete',
                  canonical_sector_id = COALESCE(canonical_sector_id, ?),
                  updated_at = ? WHERE household_id = ? AND id = ?`,
        )
        .run(id, now, this.householdId, placeId);
      if (ordinal === 0) {
        this.database
          .prepare(
            `UPDATE robot_visual_transitions
                SET from_sector_id = COALESCE(from_sector_id, ?)
              WHERE household_id = ? AND from_place_id = ?`,
          )
          .run(id, this.householdId, placeId);
        this.database
          .prepare(
            `UPDATE robot_visual_transitions
                SET to_sector_id = COALESCE(to_sector_id, ?)
              WHERE household_id = ? AND to_place_id = ?`,
          )
          .run(id, this.householdId, placeId);
      }
    })();
    return { added: true, complete: false, sectorCount: ordinal + 1 };
  }

  markPanoramaIncomplete(): void {
    this.panoramaSession = null;
    if (!this.currentPlaceId) return;
    this.database
      .prepare(
        `UPDATE robot_visual_places SET panorama_status = 'incomplete',
                updated_at = ? WHERE household_id = ? AND id = ?
                  AND panorama_status != 'complete'`,
      )
      .run(new Date().toISOString(), this.householdId, this.currentPlaceId);
  }

  markCurrentPortBlocked(): void {
    if (!this.currentPlaceId) return;
    const sectorId = this.canonicalSectorId(this.currentPlaceId);
    if (!sectorId) return;
    const now = new Date();
    this.database
      .prepare(
        `UPDATE robot_visual_ports
            SET status = 'temporarily_blocked',
                failure_count = failure_count + 1,
                blocked_until = ?, updated_at = ?
          WHERE household_id = ? AND place_id = ? AND sector_id = ?`,
      )
      .run(
        new Date(now.getTime() + 60_000).toISOString(),
        now.toISOString(),
        this.householdId,
        this.currentPlaceId,
        sectorId,
      );
  }

  private navigationPath(
    from: string,
    to: string,
    allowCandidates: boolean,
  ): string[] | null {
    if (from === to) return [from];
    const rows = this.database
      .prepare(
        `SELECT t.from_place_id, t.to_place_id
           FROM robot_visual_transitions t
           JOIN robot_visual_places a ON a.id = t.from_place_id
           JOIN robot_visual_places b ON b.id = t.to_place_id
          WHERE t.household_id = ? AND a.status = 'confirmed'
            AND b.status = 'confirmed'
            AND a.panorama_status = 'complete'
            AND b.panorama_status = 'complete'
            AND t.status IN (${allowCandidates ? "'confirmed', 'candidate'" : "'confirmed'"})`,
      )
      .all(this.householdId) as Array<{
      from_place_id: string;
      to_place_id: string;
    }>;
    const neighbors = new Map<string, string[]>();
    for (const row of rows)
      neighbors.set(row.from_place_id, [
        ...(neighbors.get(row.from_place_id) ?? []),
        row.to_place_id,
      ]);
    const queue: string[][] = [[from]];
    const seen = new Set([from]);
    while (queue.length > 0) {
      const path = queue.shift()!;
      if (allowCandidates && path.length >= 4) continue;
      for (const next of neighbors.get(path.at(-1)!) ?? []) {
        if (seen.has(next)) continue;
        const candidate = [...path, next];
        if (next === to) {
          const edgeCount = candidate.length - 1;
          if (!allowCandidates || (edgeCount >= 2 && edgeCount <= 3))
            return candidate;
          continue;
        }
        seen.add(next);
        queue.push(candidate);
      }
    }
    return null;
  }

  async close(): Promise<void> {
    await this.queue.catch(() => undefined);
    await this.recognition?.close();
  }

  private async processObservation(
    state: RobotState,
    keyframe: RobotVisionKeyframe | null,
    epoch: number,
  ): Promise<RobotVisualObservation> {
    if (
      this.observationsPaused ||
      epoch !== this.observationEpoch ||
      Date.now() < this.settleUntil
    )
      return {
        confidence: 0,
        imageUsable: false,
        placeId: this.currentPlaceId,
        stable: false,
        motionState: 'uncertain',
        informationGain: 0,
      };
    if (!this.recognition || !state.vision || !keyframe)
      return {
        confidence: this.currentPlaceId ? 0.5 : 0,
        imageUsable: false,
        placeId: this.currentPlaceId,
        stable: false,
        motionState: 'uncertain',
        informationGain: 0,
      };
    if (state.vision.frameId === this.lastFrameId)
      return this.latestObservation;
    this.lastFrameId = state.vision.frameId;
    let rawMotion: RobotVisualMotionFeatures | null = null;
    if (this.lastImage) {
      try {
        rawMotion = await this.recognition.motion(
          this.lastImage,
          keyframe.image,
        );
      } catch {
        rawMotion = null;
      }
    }
    this.lastImage = Buffer.from(keyframe.image);
    const cameraMoved =
      this.lastCameraPose !== null &&
      (Math.abs(this.lastCameraPose.pan - state.cameraPose.pan) > 0.015 ||
        Math.abs(this.lastCameraPose.tilt - state.cameraPose.tilt) > 0.015);
    this.lastCameraPose = { ...state.cameraPose };
    const motionState = classifyVisualMotion(
      rawMotion,
      cameraMoved,
      this.lastDrive && Date.now() - this.lastDrive.at <= 1_000
        ? this.lastDrive.direction
        : null,
    );
    this.lastVisibleObjectLabels = new Set(
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
      if (this.traversal)
        this.traversal.translationScore += rawMotion.medianFlowPx;
      else
        this.unlocalizedTranslationScore += Math.max(0, rawMotion.medianFlowPx);
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
    this.lastFeatures = features;
    if (epoch !== this.observationEpoch || this.observationsPaused)
      return {
        confidence: 0,
        imageUsable: false,
        placeId: this.currentPlaceId,
        stable: false,
        motionState,
        informationGain: 0,
      };
    const imageUsable = isUsableVisual(features);
    if (!imageUsable)
      return {
        confidence: 0,
        imageUsable: false,
        placeId: this.currentPlaceId,
        stable: false,
        motionState,
        informationGain: 0,
      };

    const rows = this.readCandidateViews();
    const matches = await this.recognition.match(
      features,
      rows.map(toCandidate),
    );
    if (epoch !== this.observationEpoch || this.observationsPaused)
      return {
        confidence: 0,
        imageUsable: false,
        placeId: this.currentPlaceId,
        stable: false,
        motionState,
        informationGain: 0,
      };
    const accepted = matches.filter(isAcceptedPlaceMatch).map((match) => ({
      ...match,
      placeId: rows.find((row) => row.id === match.candidateId)!.place_id,
    }));
    const ranked = this.rankBySequence(accepted);
    if (ranked[0]) {
      const ambiguous =
        ranked[1] &&
        ranked[1].placeId !== ranked[0].placeId &&
        ranked[0].rank - ranked[1].rank < 0.08;
      const placeId = ranked[0].placeId;
      const stableFrame = motionState === 'stationary';
      this.matchBelief =
        stableFrame && !ambiguous && this.matchBelief?.placeId === placeId
          ? {
              count: this.matchBelief.count + 1,
              placeId,
              score: (this.matchBelief.score + ranked[0].score) / 2,
            }
          : {
              count: stableFrame && !ambiguous ? 1 : 0,
              placeId,
              score: ranked[0].score,
            };
      if (this.matchBelief.count < 3) {
        return {
          confidence: ambiguous ? 0.4 : ranked[0].score,
          imageUsable: true,
          placeId: this.currentPlaceId,
          stable: false,
          motionState,
          informationGain: ambiguous ? -0.1 : 0.1,
        };
      }
      const returningToPlace =
        this.currentPlaceId !== null && this.currentPlaceId !== placeId;
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
      this.enterPlace(placeId, ranked[0].score, keyframe.observedAt);
      this.persistViewIfUseful(
        placeId,
        state,
        keyframe,
        features,
        personDetections.length > 0,
      );
      this.persistObjects(placeId, state, returningToPlace);
      this.novelPlace = null;
      return {
        confidence: ranked[0].score,
        imageUsable: true,
        placeId,
        stable: true,
        motionState,
        informationGain: returningToPlace ? 0.5 : 0,
      };
    }

    this.matchBelief = null;

    const placeCount = this.database
      .prepare(
        'SELECT COUNT(*) AS count FROM robot_visual_places WHERE household_id = ?',
      )
      .get(this.householdId) as { count: number };
    const stationary = motionState === 'stationary';
    if (
      stationary &&
      this.novelPlace &&
      hammingDistance(
        this.novelPlace.features.perceptualHash,
        features.perceptualHash,
      ) <= 10
    ) {
      this.novelPlace = {
        count: this.novelPlace.count + 1,
        features,
        keyframe,
        startedAt: this.novelPlace.startedAt,
        state,
      };
    } else if (stationary) {
      this.novelPlace = {
        count: 1,
        features,
        keyframe,
        startedAt: Date.parse(keyframe.observedAt),
        state,
      };
    } else {
      this.novelPlace = null;
    }
    const hasTranslationEvidence =
      placeCount.count === 0 ||
      (this.traversal?.translationScore ?? 0) >= 6 ||
      this.unlocalizedTranslationScore >= 6;
    if (
      !this.novelPlace ||
      this.novelPlace.count < 6 ||
      Date.parse(keyframe.observedAt) - this.novelPlace.startedAt < 1_500 ||
      !hasTranslationEvidence
    )
      return {
        confidence: 0.2,
        imageUsable: true,
        placeId: this.currentPlaceId,
        stable: false,
        motionState,
        informationGain: 0,
      };
    const pending = this.novelPlace;
    this.novelPlace = null;
    const placeId = this.createPlace(
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

  private readCandidateViews(): ViewRow[] {
    return this.database
      .prepare(
        `SELECT id, place_id, perceptual_hash, keypoints_json, descriptors,
                feature_count, quality, luminance
           FROM robot_visual_place_views WHERE household_id = ?
          ORDER BY observed_at DESC LIMIT ?`,
      )
      .all(this.householdId, MAX_PLACES * MAX_VIEWS_PER_PLACE) as ViewRow[];
  }

  private rankBySequence<T extends { placeId: string; score: number }>(
    matches: T[],
  ) {
    const neighborIds = new Set<string>();
    if (this.currentPlaceId) {
      const rows = this.database
        .prepare(
          `SELECT to_place_id FROM robot_visual_transitions
            WHERE household_id = ? AND from_place_id = ?`,
        )
        .all(this.householdId, this.currentPlaceId) as Array<{
        to_place_id: string;
      }>;
      rows.forEach((row) => neighborIds.add(row.to_place_id));
    }
    return matches
      .map((match) => ({
        ...match,
        rank:
          match.score +
          (match.placeId === this.currentPlaceId ? 0.12 : 0) +
          (neighborIds.has(match.placeId) ? 0.08 : 0),
      }))
      .sort((a, b) => b.rank - a.rank);
  }

  private createPlace(
    state: RobotState,
    keyframe: RobotVisionKeyframe,
    features: RobotPlaceSignatureFeatures,
    containsPerson: boolean,
  ): string {
    const count = this.database
      .prepare(
        'SELECT COUNT(*) AS count FROM robot_visual_places WHERE household_id = ?',
      )
      .get(this.householdId) as { count: number };
    if (count.count >= MAX_PLACES) {
      const fallback =
        this.currentPlaceId ??
        (
          this.database
            .prepare(
              `SELECT id FROM robot_visual_places
                WHERE household_id = ? ORDER BY last_seen_at DESC LIMIT 1`,
            )
            .get(this.householdId) as { id: string } | undefined
        )?.id;
      if (!fallback)
        throw new Error('Capacité des repères visuels atteinte sans repli.');
      this.currentPlaceId = fallback;
      return fallback;
    }
    const id = crypto.randomUUID();
    this.database
      .prepare(
        `INSERT INTO robot_visual_places(
           id, household_id, status, label, confidence, observation_count,
           first_seen_at, last_seen_at, updated_at
         ) VALUES (?, ?, 'provisional', NULL, 0.45, 1, ?, ?, ?)`,
      )
      .run(
        id,
        this.householdId,
        keyframe.observedAt,
        keyframe.observedAt,
        keyframe.observedAt,
      );
    this.persistView(id, state, keyframe, features, containsPerson);
    this.persistObjects(id, state);
    this.enterPlace(id, 0.45, keyframe.observedAt);
    return id;
  }

  private enterPlace(
    placeId: string,
    confidence: number,
    observedAt: string,
  ): void {
    const previous = this.currentPlaceId;
    this.currentPlaceId = placeId;
    this.unlocalizedTranslationScore = 0;
    const traversal = this.traversal;
    if (
      previous === placeId &&
      traversal?.fromPlaceId === placeId &&
      traversal.translationScore >= 6
    ) {
      const sectorId = this.canonicalSectorId(placeId);
      if (sectorId)
        this.database
          .prepare(
            `UPDATE robot_visual_ports
                SET failure_count = failure_count + 1,
                    status = CASE WHEN failure_count + 1 >= 2
                                  THEN 'dead_end_confirmed'
                                  ELSE 'dead_end_probable' END,
                    updated_at = ?
              WHERE household_id = ? AND place_id = ? AND sector_id = ?`,
          )
          .run(new Date().toISOString(), this.householdId, placeId, sectorId);
      this.traversal = null;
      return;
    }
    if (
      !previous ||
      previous === placeId ||
      !traversal ||
      traversal.fromPlaceId !== previous ||
      traversal.translationScore < 6
    )
      return;
    const direction = dominantDirection(traversal.directions);
    const durationMs = Math.max(
      1,
      Math.min(120_000, Date.now() - traversal.startedAt),
    );
    const fromSector = this.canonicalSectorId(previous);
    const toSector = this.canonicalSectorId(placeId);
    this.database
      .prepare(
        `INSERT INTO robot_visual_transitions(
           id, household_id, from_place_id, to_place_id, from_sector_id,
           to_sector_id, direction, status, confidence, traversal_count,
           success_count, failure_count, expected_duration_ms,
           motion_sequence_json, first_traversed_at, last_traversed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', ?, 1, 1, 0, ?, ?, ?, ?)
         ON CONFLICT(household_id, from_place_id, to_place_id, direction)
         DO UPDATE SET confidence = MIN(1, (confidence + excluded.confidence) / 2 + 0.1),
                       traversal_count = traversal_count + 1,
                       success_count = success_count + 1,
                       status = CASE WHEN success_count + 1 >= 2 THEN 'confirmed' ELSE status END,
                       from_sector_id = COALESCE(from_sector_id, excluded.from_sector_id),
                       to_sector_id = COALESCE(to_sector_id, excluded.to_sector_id),
                       expected_duration_ms = CAST((COALESCE(expected_duration_ms, excluded.expected_duration_ms) + excluded.expected_duration_ms) / 2 AS INTEGER),
                       motion_sequence_json = excluded.motion_sequence_json,
                       last_traversed_at = excluded.last_traversed_at`,
      )
      .run(
        crypto.randomUUID(),
        this.householdId,
        previous,
        placeId,
        fromSector,
        toSector,
        direction,
        confidence,
        durationMs,
        JSON.stringify(traversal.directions),
        observedAt,
        observedAt,
      );
    if (fromSector) {
      const transition = this.database
        .prepare(
          `SELECT status FROM robot_visual_transitions
            WHERE household_id = ? AND from_place_id = ? AND to_place_id = ?
              AND direction = ?`,
        )
        .get(this.householdId, previous, placeId, direction) as {
        status: string;
      };
      this.database
        .prepare(
          `UPDATE robot_visual_ports SET status = ?, evidence_count = evidence_count + 1,
                  blocked_until = NULL, updated_at = ?
            WHERE household_id = ? AND place_id = ? AND sector_id = ?`,
        )
        .run(
          transition.status === 'confirmed'
            ? 'passage_confirmed'
            : 'passage_candidate',
          observedAt,
          this.householdId,
          previous,
          fromSector,
        );
    }
    this.database
      .prepare(
        `INSERT INTO robot_visual_transitions(
           id, household_id, from_place_id, to_place_id, from_sector_id,
           to_sector_id, direction, status, confidence, traversal_count,
           success_count, failure_count, expected_duration_ms,
           motion_sequence_json, first_traversed_at, last_traversed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reverse_hypothesis', ?, 1, 0, 0, ?, ?, ?, ?)
         ON CONFLICT(household_id, from_place_id, to_place_id, direction)
         DO NOTHING`,
      )
      .run(
        crypto.randomUUID(),
        this.householdId,
        placeId,
        previous,
        toSector,
        fromSector,
        inverseDirection(direction),
        Math.min(0.5, confidence),
        durationMs,
        JSON.stringify(traversal.directions.toReversed().map(inverseDirection)),
        observedAt,
        observedAt,
      );
    this.traversal = null;
  }

  private canonicalSectorId(placeId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT canonical_sector_id FROM robot_visual_places
          WHERE household_id = ? AND id = ?`,
      )
      .get(this.householdId, placeId) as
      { canonical_sector_id: string | null } | undefined;
    return row?.canonical_sector_id ?? null;
  }

  private persistViewIfUseful(
    placeId: string,
    state: RobotState,
    keyframe: RobotVisionKeyframe,
    features: RobotPlaceSignatureFeatures,
    containsPerson: boolean,
  ): void {
    const existing = this.database
      .prepare(
        `SELECT pan, tilt FROM robot_visual_place_views
          WHERE place_id = ? ORDER BY quality DESC`,
      )
      .all(placeId) as Array<{ pan: number; tilt: number }>;
    if (existing.length >= MAX_VIEWS_PER_PLACE) return;
    if (
      existing.some(
        (view) =>
          Math.abs(view.pan - state.cameraPose.pan) < 0.2 &&
          Math.abs(view.tilt - state.cameraPose.tilt) < 0.2,
      )
    )
      return;
    this.persistView(placeId, state, keyframe, features, containsPerson);
  }

  private persistView(
    placeId: string,
    state: RobotState,
    keyframe: RobotVisionKeyframe,
    features: RobotPlaceSignatureFeatures,
    containsPerson: boolean,
  ): void {
    const descriptors = Buffer.from(features.descriptors, 'base64');
    const storage = this.database
      .prepare(
        `SELECT COALESCE(SUM(length(descriptors)), 0) AS bytes
           FROM robot_visual_place_views WHERE household_id = ?`,
      )
      .get(this.householdId) as { bytes: number };
    if (storage.bytes + descriptors.length > DESCRIPTOR_QUOTA_BYTES) return;
    this.pruneImages(keyframe.image.length);
    const image =
      !containsPerson && keyframe.image.length <= MAX_IMAGE_BYTES
        ? keyframe.image
        : null;
    this.database
      .prepare(
        `INSERT OR IGNORE INTO robot_visual_place_views(
           id, household_id, place_id, frame_id, perceptual_hash,
           keypoints_json, descriptors, feature_count, quality, luminance,
           pan, tilt, image_jpeg, observed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        this.householdId,
        placeId,
        keyframe.frameId,
        features.perceptualHash,
        JSON.stringify(features.keypoints),
        descriptors,
        features.featureCount,
        features.quality,
        features.luminance,
        state.cameraPose.pan,
        state.cameraPose.tilt,
        image,
        keyframe.observedAt,
        new Date().toISOString(),
      );
  }

  private mergePlaceObjects(
    targetPlaceId: string,
    sourcePlaceId: string,
  ): void {
    const rows = this.database
      .prepare(
        `SELECT id, place_id, class_label, display_name, confidence,
                sighting_count, first_seen_at, last_seen_at
           FROM robot_visual_objects
          WHERE household_id = ? AND place_id IN (?, ?)`,
      )
      .all(this.householdId, targetPlaceId, sourcePlaceId) as Array<{
      class_label: string;
      confidence: number;
      display_name: string;
      first_seen_at: string;
      id: string;
      last_seen_at: string;
      place_id: string;
      sighting_count: number;
    }>;
    const targetByClass = new Map(
      rows
        .filter((row) => row.place_id === targetPlaceId)
        .map((row) => [row.class_label, row]),
    );
    const now = new Date().toISOString();
    for (const source of rows.filter((row) => row.place_id === sourcePlaceId)) {
      const target = targetByClass.get(source.class_label);
      if (!target) {
        this.database
          .prepare(
            `UPDATE robot_visual_objects SET place_id = ?, updated_at = ?
              WHERE id = ?`,
          )
          .run(targetPlaceId, now, source.id);
        continue;
      }
      const targetCustom = target.display_name !== target.class_label;
      const sourceCustom = source.display_name !== source.class_label;
      const displayName = targetCustom
        ? target.display_name
        : sourceCustom
          ? source.display_name
          : target.display_name;
      this.database
        .prepare(
          `UPDATE robot_visual_objects
              SET display_name = ?, confidence = ?, sighting_count = ?,
                  first_seen_at = ?, last_seen_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          displayName,
          Math.max(target.confidence, source.confidence),
          target.sighting_count + source.sighting_count,
          target.first_seen_at < source.first_seen_at
            ? target.first_seen_at
            : source.first_seen_at,
          target.last_seen_at > source.last_seen_at
            ? target.last_seen_at
            : source.last_seen_at,
          now,
          target.id,
        );
      this.database
        .prepare('DELETE FROM robot_visual_objects WHERE id = ?')
        .run(source.id);
    }
  }

  private mergePlaceTransitions(
    _targetPlaceId: string,
    sourcePlaceId: string,
  ): void {
    // Sector-relative routes cannot be safely redirected to another panorama.
    // Forget only the absorbed place's routes and let them be observed again.
    this.database
      .prepare(
        `DELETE FROM robot_visual_transitions
          WHERE household_id = ? AND (from_place_id = ? OR to_place_id = ?)`,
      )
      .run(this.householdId, sourcePlaceId, sourcePlaceId);
  }

  private deleteLearningForPlace(placeId: string): void {
    // Procedural habits deliberately do not contain place identifiers.
    this.database
      .prepare(
        `DELETE FROM robot_recovery_skills
          WHERE household_id = ? AND instr(situation_key, ?) > 0`,
      )
      .run(this.householdId, placeId);
  }

  private resetRuntimeAfterGraphMutation(placeId: string | null): void {
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

  private persistObjects(
    placeId: string,
    state: RobotState,
    returningToPlace = false,
  ): void {
    if (!state.vision) return;
    const now = state.vision.observedAt;
    const nowMs = Date.parse(now);
    const detections = new Map<string, number>();
    for (const detection of state.vision.detections) {
      if (detection.kind !== 'object' || detection.label === 'Personne')
        continue;
      detections.set(
        detection.label,
        Math.max(
          detections.get(detection.label) ?? 0,
          detection.confidence ?? 0.5,
        ),
      );
    }
    for (const [label, confidence] of detections) {
      const key = `${placeId}\u0000${label}`;
      const row = this.database
        .prepare(
          `SELECT confidence, last_seen_at FROM robot_visual_objects
            WHERE household_id = ? AND place_id = ? AND class_label = ?`,
        )
        .get(this.householdId, placeId, label) as
        { confidence: number; last_seen_at: string } | undefined;
      if (!row) {
        const count = this.database
          .prepare(
            'SELECT COUNT(*) AS count FROM robot_visual_objects WHERE household_id = ?',
          )
          .get(this.householdId) as { count: number };
        if (count.count >= MAX_OBJECTS) break;
        this.database
          .prepare(
            `INSERT INTO robot_visual_objects(
               id, household_id, place_id, class_label, display_name,
               confidence, sighting_count, first_seen_at, last_seen_at,
               updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          )
          .run(
            crypto.randomUUID(),
            this.householdId,
            placeId,
            label,
            label,
            confidence,
            now,
            now,
            now,
          );
        this.objectPresence.set(key, {
          lastPersistedAt: nowMs,
          lastSeenAt: nowMs,
        });
        continue;
      }

      const storedAt = Date.parse(row.last_seen_at);
      const presence = this.objectPresence.get(key) ?? {
        lastPersistedAt: storedAt,
        lastSeenAt: storedAt,
      };
      const newSighting =
        returningToPlace ||
        nowMs - presence.lastSeenAt >= OBJECT_REAPPEAR_GAP_MS;
      const shouldPersist =
        newSighting ||
        confidence > row.confidence ||
        nowMs - presence.lastPersistedAt >= OBJECT_HEARTBEAT_MS;
      if (shouldPersist) {
        this.database
          .prepare(
            `UPDATE robot_visual_objects
                SET confidence = MAX(confidence, ?),
                    sighting_count = sighting_count + ?,
                    last_seen_at = ?, updated_at = ?
              WHERE household_id = ? AND place_id = ? AND class_label = ?`,
          )
          .run(
            confidence,
            newSighting ? 1 : 0,
            now,
            now,
            this.householdId,
            placeId,
            label,
          );
      }
      this.objectPresence.set(key, {
        lastPersistedAt: shouldPersist ? nowMs : presence.lastPersistedAt,
        lastSeenAt: nowMs,
      });
    }
  }

  private pruneImages(incomingBytes: number): void {
    let total = (
      this.database
        .prepare(
          `SELECT COALESCE(SUM(length(image_jpeg)), 0) AS bytes
             FROM robot_visual_place_views WHERE household_id = ?`,
        )
        .get(this.householdId) as { bytes: number }
    ).bytes;
    const oldest = this.database
      .prepare(
        `SELECT id, length(image_jpeg) AS bytes FROM robot_visual_place_views
          WHERE household_id = ? AND image_jpeg IS NOT NULL
          ORDER BY observed_at`,
      )
      .all(this.householdId) as Array<{ bytes: number; id: string }>;
    for (const row of oldest) {
      if (total + incomingBytes <= IMAGE_QUOTA_BYTES) break;
      this.database
        .prepare(
          'UPDATE robot_visual_place_views SET image_jpeg = NULL WHERE id = ?',
        )
        .run(row.id);
      total -= row.bytes;
    }
  }

  private expireProvisionalPlaces(): void {
    this.database
      .prepare(
        `DELETE FROM robot_visual_places
          WHERE household_id = ? AND status = 'provisional' AND last_seen_at < ?`,
      )
      .run(
        this.householdId,
        new Date(Date.now() - PROVISIONAL_TTL_MS).toISOString(),
      );
  }
}

function toCandidate(row: ViewRow): RobotPlaceCandidate {
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

function dominantDirection(directions: RobotDirection[]): RobotDirection {
  const counts = new Map<RobotDirection, number>();
  for (const direction of directions)
    counts.set(direction, (counts.get(direction) ?? 0) + 1);
  return (
    [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    'forward'
  );
}

function inverseDirection(direction: RobotDirection): RobotDirection {
  if (direction === 'left') return 'right';
  if (direction === 'right') return 'left';
  if (direction === 'forward') return 'backward';
  if (direction === 'backward') return 'forward';
  return 'forward';
}

function trimSectorFeatures(
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

function selectMergedPlaceViews(
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
