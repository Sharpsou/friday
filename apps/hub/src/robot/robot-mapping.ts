import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import {
  RobotMapSnapshotSchema,
  RobotMissionPreviewSchema,
  type RobotDriveRequest,
  type RobotMapSnapshot,
  type RobotMissionPreview,
  type RobotOperatingMode,
  type RobotState,
} from '@friday/contracts';

import type { RobotVisionKeyframe } from './robot-controller.js';
import type {
  RobotPlaceCandidate,
  RobotPlaceMatch,
  RobotPlaceRecognitionEngine,
  RobotPlaceSignatureFeatures,
} from './robot-localization-engine.js';

const MAP_QUOTA_BYTES = 250 * 1024 * 1024;
const VISUAL_MEMORY_QUOTA_BYTES = 16 * 1024 * 1024;
const SIGNATURE_QUOTA_BYTES = 12 * 1024 * 1024;
const MAX_PLACE_SIGNATURES = 600;
const SIGNATURE_MIN_DISTANCE = 0.25;
const SIGNATURE_MIN_HEADING = Math.PI / 9;
const SIGNATURE_MIN_CAMERA_DELTA = 0.18;
const SIGNATURE_COOLDOWN_MS = 2_000;
const RELOCALIZATION_COOLDOWN_MS = 450;
const MIN_SIGNATURE_QUALITY = 35;
const MIN_RAW_MATCHES = 30;
const MIN_INLIERS = 18;
const MIN_INLIER_RATIO = 0.45;
const MIN_COVERAGE = 3;
const MIN_MATCH_SCORE = 0.72;
const MIN_MATCH_MARGIN = 0.1;
const BYTES_PER_POINT = 96;
const MAX_SESSION_POINTS = 2_000;
const MAX_HOUSEHOLD_POINTS = 10_000;
const DRAFT_RETENTION_MS = 7 * 24 * 60 * 60_000;

interface RuntimeRow {
  correction_revision: number;
  drive_sequence: number;
  heading: number;
  last_frame_id: number | null;
  last_relocalized_at: string | null;
  localization_started_at: string | null;
  localization_confidence: number;
  localization_status:
    'estimated' | 'lost' | 'relocalizing' | 'uncertain' | 'unknown';
  operating_mode: 'autonomous' | 'manual';
  pose_source: 'odometry' | 'visual_loop' | 'visual_relocalization';
  segment_id: string;
  uncertainty: number;
  updated_at: string;
  x: number;
  y: number;
}

interface PlaceSignatureRow {
  descriptors: Buffer;
  drive_sequence: number;
  feature_count: number;
  id: string;
  keypoints_json: string;
  map_heading: number;
  map_point_id: string | null;
  map_x: number;
  map_y: number;
  object_labels_json: string;
  observed_at: string;
  pan: number;
  perceptual_hash: string;
  quality: number;
  segment_id: string;
  session_id: string | null;
  tilt: number;
}

interface LocalizationConfirmation {
  candidate: PlaceSignatureRow;
  currentDriveSequence: number;
  firstObservedAt: number;
  heading: number;
  match: RobotPlaceMatch;
  manualCandidate: boolean;
  observations: number;
  pan: number;
  currentSignatureId: string | null;
  x: number;
  y: number;
}

export interface PoseGraphRow {
  direction: RobotDriveRequest['direction'] | null;
  heading: number;
  id: string;
  raw_heading: number;
  raw_x: number;
  raw_y: number;
  segment_id: string;
  sequence: number;
  session_id: string;
  x: number;
  y: number;
}

export interface PoseGraphNode {
  heading: number;
  id: string;
  segmentId: string;
  x: number;
  y: number;
}

export interface PoseGraphConstraint {
  dheading: number;
  dx: number;
  dy: number;
  sourceId: string;
  targetId: string;
  weight: number;
}

export interface RobotMappingOptions {
  onLocalizationError?: (error: unknown) => void;
  placeRecognition?: RobotPlaceRecognitionEngine;
}

interface SessionRow {
  created_at: string;
  id: string;
  name: string;
  point_count: number;
  started_at: string;
  status:
    'certified' | 'draft' | 'explored' | 'paused' | 'processing' | 'recording';
  storage_bytes: number;
  updated_at: string;
}

export class RobotMappingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class RobotMappingService {
  private lastDriveAtMs: number | null = null;
  private localizationTask: Promise<void> | null = null;
  private lastLocalizationAtMs = 0;
  private confirmation: LocalizationConfirmation | null = null;
  private stationaryMismatchCount = 0;
  private localizationDegradedUntil = 0;

  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly options: RobotMappingOptions = {},
  ) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT OR IGNORE INTO robot_map_runtime(
           household_id, operating_mode, x, y, heading, uncertainty, updated_at
         ) VALUES (?, 'manual', 0, 0, 0, 1, ?)`,
      )
      .run(this.householdId, now);
    const runtime = this.runtime();
    if (!isUuid(runtime.segment_id))
      this.database
        .prepare(
          `UPDATE robot_map_runtime SET segment_id = ? WHERE household_id = ?`,
        )
        .run(randomUUID(), this.householdId);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO robot_odometry_calibration(household_id, updated_at)
         VALUES (?, ?)`,
      )
      .run(this.householdId, now);
    this.database
      .prepare(
        `UPDATE robot_mapping_sessions
            SET status = 'paused', updated_at = ?
          WHERE household_id = ? AND status = 'recording'`,
      )
      .run(now, this.householdId);
  }

  snapshot(): RobotMapSnapshot {
    const runtime = this.runtime();
    const active = this.activeSession();
    const sessions = this.database
      .prepare(
        `SELECT id, name, status, point_count, storage_bytes, started_at,
                created_at, updated_at
           FROM robot_mapping_sessions
          WHERE household_id = ?
          ORDER BY updated_at DESC LIMIT 20`,
      )
      .all(this.householdId) as SessionRow[];
    const paths = sessions.map((session) => ({
      id: session.id,
      name: session.name,
      status: mapPathStatus(session.status),
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      points: (
        this.database
          .prepare(
            `SELECT id, x, y, heading, uncertainty, segment_id, pose_source,
                    correction_revision, recorded_at
               FROM robot_map_points WHERE session_id = ?
              ORDER BY sequence LIMIT ?`,
          )
          .all(session.id, MAX_SESSION_POINTS) as Array<{
          heading: number;
          id: string;
          correction_revision: number;
          recorded_at: string;
          pose_source: 'odometry' | 'visual_loop' | 'visual_relocalization';
          segment_id: string;
          uncertainty: number;
          x: number;
          y: number;
        }>
      ).map((point) => ({
        id: point.id,
        x: point.x,
        y: point.y,
        heading: point.heading,
        uncertainty: point.uncertainty,
        segmentId: point.segment_id,
        source: point.pose_source,
        correctionRevision: point.correction_revision,
        recordedAt: point.recorded_at,
      })),
    }));
    const objects = (
      this.database
        .prepare(
          `SELECT e.id, e.display_name, e.class_label, e.map_x, e.map_y,
                  e.map_uncertainty, e.confidence, e.sighting_count,
                  e.viewpoint_keys_json, e.last_seen_at,
                  (SELECT ke.keyframe_id
                     FROM robot_memory_keyframe_entities ke
                     JOIN robot_memory_keyframes k ON k.id = ke.keyframe_id
                    WHERE ke.entity_id = e.id
                    ORDER BY k.observed_at DESC LIMIT 1) AS keyframe_id
             FROM robot_memory_entities e
            WHERE e.household_id = ? AND e.status = 'confirmed'
              AND e.map_x IS NOT NULL AND e.map_y IS NOT NULL
            ORDER BY e.last_seen_at DESC LIMIT 100`,
        )
        .all(this.householdId) as Array<{
        class_label: string;
        confidence: number;
        display_name: string;
        id: string;
        last_seen_at: string;
        keyframe_id: string | null;
        map_uncertainty: number | null;
        map_x: number;
        map_y: number;
        sighting_count: number;
        viewpoint_keys_json: string;
      }>
    ).map((object) => ({
      id: object.id,
      displayName: object.display_name,
      classLabel: object.class_label,
      x: object.map_x,
      y: object.map_y,
      uncertainty: object.map_uncertainty ?? 2,
      confidence: object.confidence,
      sightingCount: object.sighting_count,
      viewpointCount: (JSON.parse(object.viewpoint_keys_json) as string[])
        .length,
      keyframeId: object.keyframe_id,
      lastSeenAt: object.last_seen_at,
    }));
    const viewpoints = (
      this.database
        .prepare(
          `SELECT v.id, v.x, v.y, v.heading, v.pan, v.tilt,
                  v.observation_count, v.last_seen_at,
                  EXISTS(
                    SELECT 1 FROM robot_memory_keyframes k
                     WHERE k.household_id = v.household_id
                       AND abs(k.map_x - v.x) < 0.11
                       AND abs(k.map_y - v.y) < 0.11
                       AND abs(k.pan - v.pan) < 0.13
                       AND abs(k.tilt - v.tilt) < 0.18
                  ) AS has_keyframe
             FROM robot_map_viewpoints v
            WHERE v.household_id = ?
            ORDER BY v.last_seen_at DESC LIMIT 200`,
        )
        .all(this.householdId) as Array<{
        has_keyframe: number;
        heading: number;
        id: string;
        last_seen_at: string;
        observation_count: number;
        pan: number;
        tilt: number;
        x: number;
        y: number;
      }>
    ).map((viewpoint) => ({
      id: viewpoint.id,
      x: viewpoint.x,
      y: viewpoint.y,
      heading: viewpoint.heading,
      pan: viewpoint.pan,
      tilt: viewpoint.tilt,
      observationCount: viewpoint.observation_count,
      hasKeyframe: Boolean(viewpoint.has_keyframe),
      lastSeenAt: viewpoint.last_seen_at,
    }));
    const visualMemory = this.database
      .prepare(
        `SELECT COUNT(*) AS keyframe_count,
                COALESCE(SUM(length(image_jpeg)), 0) AS storage_bytes
           FROM robot_memory_keyframes WHERE household_id = ?`,
      )
      .get(this.householdId) as {
      keyframe_count: number;
      storage_bytes: number;
    };
    const signatureMemory = this.database
      .prepare(
        `SELECT COUNT(*) AS signature_count,
                COALESCE(SUM(storage_bytes), 0) AS storage_bytes
           FROM robot_place_signatures WHERE household_id = ?`,
      )
      .get(this.householdId) as {
      signature_count: number;
      storage_bytes: number;
    };
    const localizationEvents = (
      this.database
        .prepare(
          `SELECT id, kind, old_x, old_y, old_heading, new_x, new_y,
                  new_heading, confidence, reason, created_at
             FROM robot_localization_events WHERE household_id = ?
            ORDER BY created_at DESC LIMIT 20`,
        )
        .all(this.householdId) as Array<{
        confidence: number;
        created_at: string;
        id: string;
        kind:
          | 'loop_closure'
          | 'manual_relocation'
          | 'lost'
          | 'recovered'
          | 'rejected';
        new_heading: number;
        new_x: number;
        new_y: number;
        old_heading: number;
        old_x: number;
        old_y: number;
        reason: string;
      }>
    ).map((event) => ({
      id: event.id,
      kind: event.kind,
      oldPose: {
        x: event.old_x,
        y: event.old_y,
        heading: event.old_heading,
      },
      newPose: {
        x: event.new_x,
        y: event.new_y,
        heading: event.new_heading,
      },
      confidence: event.confidence,
      reason: event.reason,
      createdAt: event.created_at,
    }));
    const storageBytes = sessions.reduce(
      (total, session) => total + session.storage_bytes,
      0,
    );
    return RobotMapSnapshotSchema.parse({
      version: 3,
      operatingMode: runtime.operating_mode,
      mapping: {
        status: active ? mapActiveStatus(active.status) : 'inactive',
        sessionId: active?.id ?? null,
        startedAt: active?.started_at ?? null,
        pointCount: active?.point_count ?? 0,
        storageBytes,
        quotaBytes: MAP_QUOTA_BYTES,
      },
      localization: {
        status: localizationStatus(runtime, paths.length > 0),
        confidence: runtime.localization_confidence,
        source: runtime.pose_source,
        correctionRevision: runtime.correction_revision,
        lastRelocalizedAt: runtime.last_relocalized_at,
        visualRecognitionAvailable: Boolean(
          this.options.placeRecognition &&
          Date.now() >= this.localizationDegradedUntil,
        ),
        pose: {
          x: runtime.x,
          y: runtime.y,
          heading: runtime.heading,
          uncertainty: runtime.uncertainty,
          updatedAt: runtime.updated_at,
        },
      },
      paths,
      objects,
      viewpoints,
      visualMemory: {
        keyframeCount: visualMemory.keyframe_count,
        storageBytes: visualMemory.storage_bytes,
        quotaBytes: VISUAL_MEMORY_QUOTA_BYTES,
        signatureCount: signatureMemory.signature_count,
        signatureStorageBytes: signatureMemory.storage_bytes,
        signatureQuotaBytes: SIGNATURE_QUOTA_BYTES,
      },
      localizationEvents,
      autonomy: {
        available: true,
        blockedReason: null,
      },
    });
  }

  start(state: RobotState): RobotMapSnapshot {
    if (state.operatingMode !== 'manual')
      throw new RobotMappingError(
        'robot_mapping_manual_required',
        'Carto est disponible uniquement en mode Manuel.',
      );
    if (!state.cameraAvailable || !state.vision)
      throw new RobotMappingError(
        'robot_mapping_vision_required',
        'La caméra et la reconnaissance doivent être disponibles.',
      );
    this.assertNavigationCameraPose(state);
    const active = this.activeSession();
    if (active) {
      if (active.status === 'paused') return this.resume(state);
      return this.snapshot();
    }
    this.purgeExpiredDrafts();
    const householdPoints = this.householdPointCount();
    if (householdPoints >= MAX_HOUSEHOLD_POINTS)
      throw new RobotMappingError(
        'robot_mapping_quota_reached',
        'Le quota de points Carto est atteint. Supprimez un ancien brouillon.',
      );
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO robot_mapping_sessions(
             id, household_id, name, status, point_count, storage_bytes,
             started_at, created_at, updated_at
           ) VALUES (?, ?, ?, 'recording', 0, 0, ?, ?, ?)`,
        )
        .run(
          id,
          this.householdId,
          `Exploration ${now.slice(0, 16)}`,
          now,
          now,
          now,
        );
      const runtime = this.runtime();
      this.insertPoint(
        id,
        0,
        runtime,
        null,
        state.vision?.frameId ?? null,
        now,
      );
      this.recordMapCell(runtime, Boolean(state.vision));
    })();
    return this.snapshot();
  }

  startAutonomous(state: RobotState): RobotMapSnapshot {
    if (!state.cameraAvailable)
      throw new RobotMappingError(
        'robot_mapping_camera_required',
        'La caméra doit être disponible pour explorer.',
      );
    this.assertNavigationCameraPose(state);
    const active = this.activeSession();
    if (active) {
      this.updateActiveStatus('recording');
      return this.snapshot();
    }
    this.purgeExpiredDrafts();
    if (this.householdPointCount() >= MAX_HOUSEHOLD_POINTS)
      throw new RobotMappingError(
        'robot_mapping_quota_reached',
        'Le quota de points Carto est atteint. Supprimez un ancien brouillon.',
      );
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO robot_mapping_sessions(
             id, household_id, name, status, point_count, storage_bytes,
             started_at, created_at, updated_at
           ) VALUES (?, ?, ?, 'recording', 0, 0, ?, ?, ?)`,
        )
        .run(
          id,
          this.householdId,
          `Exploration autonome ${now.slice(0, 16)}`,
          now,
          now,
          now,
        );
      this.insertPoint(
        id,
        0,
        this.runtime(),
        null,
        state.vision?.frameId ?? null,
        now,
      );
      this.recordMapCell(this.runtime(), Boolean(state.vision));
    })();
    return this.snapshot();
  }

  pause(): RobotMapSnapshot {
    this.updateActiveStatus('paused');
    return this.snapshot();
  }

  resume(state: RobotState): RobotMapSnapshot {
    if (state.operatingMode !== 'manual' || !state.cameraAvailable)
      throw new RobotMappingError(
        'robot_mapping_resume_blocked',
        'La caméra et le mode Manuel sont requis pour reprendre Carto.',
      );
    this.assertNavigationCameraPose(state);
    this.updateActiveStatus('recording');
    return this.snapshot();
  }

  stop(): RobotMapSnapshot {
    const active = this.activeSession();
    if (!active) return this.snapshot();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE robot_mapping_sessions
            SET status = CASE WHEN point_count >= 2 THEN 'explored' ELSE 'draft' END,
                ended_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(now, now, active.id);
    return this.snapshot();
  }

  setMode(mode: RobotOperatingMode): void {
    if (mode !== 'manual' && mode !== 'autonomous') return;
    if (mode === 'manual') this.stop();
    this.database
      .prepare(
        `UPDATE robot_map_runtime SET operating_mode = ?, updated_at = ?
          WHERE household_id = ?`,
      )
      .run(mode, new Date().toISOString(), this.householdId);
  }

  autonomyContext(): {
    mapSessionId: string | null;
    novelty: 'high' | 'known' | 'low';
    objectCount: number;
    pointCount: number;
    potential: number;
    uncertainty: number;
    localizationConfidence: number;
    localizationStatus: RuntimeRow['localization_status'];
    viewpointCount: number;
    currentViewpointVisits: number;
  } {
    const runtime = this.runtime();
    const cell = this.database
      .prepare(
        `SELECT visit_count, visual_observation_count FROM robot_map_cells
          WHERE household_id = ? AND cell_x = ? AND cell_y = ?`,
      )
      .get(
        this.householdId,
        Math.round(runtime.x / 0.2),
        Math.round(runtime.y / 0.2),
      ) as
      { visit_count: number; visual_observation_count: number } | undefined;
    const visits = cell?.visit_count ?? 0;
    const active = this.activeSession();
    const viewpoint = this.database
      .prepare(
        `SELECT observation_count FROM robot_map_viewpoints
          WHERE household_id = ? AND cell_x = ? AND cell_y = ?
          ORDER BY last_seen_at DESC LIMIT 1`,
      )
      .get(
        this.householdId,
        Math.round(runtime.x / 0.2),
        Math.round(runtime.y / 0.2),
      ) as { observation_count: number } | undefined;
    const viewpointCount = (
      this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM robot_map_viewpoints
            WHERE household_id = ? AND cell_x = ? AND cell_y = ?`,
        )
        .get(
          this.householdId,
          Math.round(runtime.x / 0.2),
          Math.round(runtime.y / 0.2),
        ) as { count: number }
    ).count;
    const objectCount = (
      this.database
        .prepare(
          `SELECT count(*) AS count FROM robot_memory_entities
            WHERE household_id = ? AND status = 'confirmed'
              AND map_x IS NOT NULL`,
        )
        .get(this.householdId) as { count: number }
    ).count;
    return {
      mapSessionId: active?.id ?? null,
      novelty: visits <= 1 ? 'high' : visits <= 4 ? 'known' : 'low',
      objectCount,
      pointCount: active?.point_count ?? 0,
      potential:
        1 / (1 + visits) + 0.1 / (1 + (cell?.visual_observation_count ?? 0)),
      uncertainty: runtime.uncertainty,
      localizationConfidence: runtime.localization_confidence,
      localizationStatus: runtime.localization_status,
      viewpointCount,
      currentViewpointVisits: viewpoint?.observation_count ?? 0,
    };
  }

  observe(
    state: RobotState,
    keyframe: RobotVisionKeyframe | null = null,
  ): void {
    const frame = state.vision;
    if (!frame || Date.parse(frame.expiresAt) <= Date.now()) return;
    const runtime = this.runtime();
    if (runtime.last_frame_id === frame.frameId) return;
    this.database
      .prepare(
        `UPDATE robot_map_runtime SET last_frame_id = ?, updated_at = ?
          WHERE household_id = ?`,
      )
      .run(frame.frameId, frame.observedAt, this.householdId);
    this.recordMapCell(runtime, true);
    this.recordViewpoint(state, runtime);
    this.anchorConfirmedObjects(state, runtime);
    if (
      keyframe &&
      this.options.placeRecognition &&
      !this.localizationTask &&
      this.shouldAnalyzePlace(state, runtime)
    ) {
      this.lastLocalizationAtMs = Date.now();
      this.localizationTask = this.analyzePlace(state, keyframe, runtime)
        .catch((error: unknown) => {
          this.localizationDegradedUntil = Date.now() + 10_000;
          this.options.onLocalizationError?.(error);
        })
        .finally(() => {
          this.localizationTask = null;
        });
    }
  }

  requestRelocalization(): RobotMapSnapshot {
    if (!this.options.placeRecognition)
      throw new RobotMappingError(
        'robot_localization_unavailable',
        'La relocalisation visuelle n’est pas configurée sur le hub.',
      );
    const runtime = this.runtime();
    const now = new Date().toISOString();
    this.confirmation = null;
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE robot_map_runtime
              SET localization_status = 'relocalizing',
                  localization_confidence = 0,
                  localization_started_at = ?, updated_at = ?
            WHERE household_id = ?`,
        )
        .run(now, now, this.householdId);
      this.recordLocalizationEvent(
        'lost',
        runtime,
        runtime,
        0,
        'Position invalidée manuellement ; recherche visuelle demandée.',
        now,
      );
    })();
    return this.snapshot();
  }

  async close(): Promise<void> {
    await this.localizationTask?.catch(() => undefined);
    await this.options.placeRecognition?.close();
  }

  async waitForLocalization(): Promise<void> {
    await this.localizationTask;
  }

  recordDrive(command: RobotDriveRequest, state: RobotState): void {
    const runtime = this.runtime();
    const calibration = this.odometryCalibration();
    const nowMs = Date.now();
    const elapsedMs =
      this.lastDriveAtMs === null || nowMs - this.lastDriveAtMs > 600
        ? Math.min(command.maxDurationMs, 180)
        : Math.min(command.maxDurationMs, nowMs - this.lastDriveAtMs);
    this.lastDriveAtMs = nowMs;
    const durationSeconds = Math.max(elapsedMs, 50) / 1_000;
    const distance =
      command.direction === 'forward'
        ? command.intensity * durationSeconds * calibration.forward_mps
        : command.direction === 'backward'
          ? -command.intensity * durationSeconds * calibration.backward_mps
          : 0;
    const turn =
      command.direction === 'forward'
        ? command.steering *
          command.intensity *
          durationSeconds *
          calibration.steering_rps
        : command.direction === 'backward'
          ? -command.steering *
            command.intensity *
            durationSeconds *
            calibration.reverse_steering_rps
          : (command.direction === 'left' ? 1 : -1) *
            command.intensity *
            durationSeconds *
            calibration.turn_rps;
    const midHeading = runtime.heading + turn / 2;
    const next: RuntimeRow = {
      ...runtime,
      x: runtime.x + Math.cos(midHeading) * distance,
      y: runtime.y + Math.sin(midHeading) * distance,
      heading: normalizeHeading(runtime.heading + turn),
      uncertainty: Math.min(
        100,
        runtime.uncertainty +
          Math.abs(distance) * 0.35 +
          Math.abs(turn) * 0.25 +
          0.01,
      ),
      updated_at: new Date().toISOString(),
      localization_status:
        runtime.uncertainty > 2 ? 'uncertain' : runtime.localization_status,
      localization_confidence: Math.max(
        0.05,
        runtime.localization_confidence -
          Math.abs(distance) * 0.08 -
          Math.abs(turn) * 0.05,
      ),
      pose_source: 'odometry',
      drive_sequence: runtime.drive_sequence + 1,
    };
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE robot_map_runtime
              SET x = ?, y = ?, heading = ?, uncertainty = ?,
                  localization_status = ?, localization_confidence = ?,
                  pose_source = 'odometry', drive_sequence = ?, updated_at = ?
            WHERE household_id = ?`,
        )
        .run(
          next.x,
          next.y,
          next.heading,
          next.uncertainty,
          next.localization_status,
          next.localization_confidence,
          next.drive_sequence,
          next.updated_at,
          this.householdId,
        );
      const active = this.activeSession();
      if (!active || active.status !== 'recording') return;
      this.recordMapCell(next, Boolean(state.vision));
      const last = this.lastPoint(active.id);
      if (
        active.point_count >= MAX_SESSION_POINTS ||
        this.householdPointCount() >= MAX_HOUSEHOLD_POINTS
      ) {
        this.updateActiveStatus('paused');
        return;
      }
      if (
        last &&
        Math.hypot(next.x - last.x, next.y - last.y) < 0.04 &&
        Math.abs(normalizeHeading(next.heading - last.heading)) < 0.08
      )
        return;
      this.insertPoint(
        active.id,
        active.point_count,
        next,
        command,
        state.vision?.frameId ?? null,
        next.updated_at,
      );
    })();
  }

  previewMission(targetPointId: string): RobotMissionPreview {
    const point = this.database
      .prepare(
        `SELECT p.id, s.point_count, s.status FROM robot_map_points p
          JOIN robot_mapping_sessions s ON s.id = p.session_id
         WHERE p.id = ? AND p.household_id = ?`,
      )
      .get(targetPointId, this.householdId) as
      { id: string; point_count: number; status: string } | undefined;
    const now = Date.now();
    const runtime = this.runtime();
    const currentLocalization = localizationStatus(
      runtime,
      this.householdPointCount() > 0,
    );
    const localized =
      currentLocalization !== 'lost' &&
      currentLocalization !== 'relocalizing' &&
      currentLocalization !== 'unknown' &&
      runtime.localization_confidence >= 0.15;
    const allowed = Boolean(
      point &&
      localized &&
      point.point_count >= 20 &&
      (point.status === 'explored' || point.status === 'certified'),
    );
    const preview = {
      previewId: randomUUID(),
      targetPointId,
      expiresAt: new Date(now + 15_000).toISOString(),
      allowed,
      blockedReason: allowed
        ? null
        : !localized
          ? 'Friday doit d’abord retrouver une position fiable.'
          : point
            ? 'Il faut au moins 20 points sur un trajet terminé avant d’y retourner.'
            : 'Cette destination n’appartient pas à la carte.',
    };
    const targetExists = this.database
      .prepare(
        'SELECT 1 FROM robot_map_points WHERE id = ? AND household_id = ?',
      )
      .get(targetPointId, this.householdId);
    if (targetExists)
      this.database
        .prepare(
          `INSERT INTO robot_mission_previews(
             id, household_id, target_point_id, allowed, blocked_reason,
             created_at, expires_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          preview.previewId,
          this.householdId,
          preview.targetPointId,
          preview.allowed ? 1 : 0,
          preview.blockedReason,
          new Date(now).toISOString(),
          preview.expiresAt,
        );
    return RobotMissionPreviewSchema.parse(preview);
  }

  navigationTarget(targetPointId: string): {
    id: string;
    x: number;
    y: number;
  } {
    const preview = this.previewMission(targetPointId);
    if (!preview.allowed)
      throw new RobotMappingError(
        'robot_navigation_target_unavailable',
        preview.blockedReason ?? 'Destination indisponible.',
      );
    return this.database
      .prepare(
        `SELECT id, x, y FROM robot_map_points
          WHERE id = ? AND household_id = ?`,
      )
      .get(targetPointId, this.householdId) as {
      id: string;
      x: number;
      y: number;
    };
  }

  private shouldAnalyzePlace(state: RobotState, runtime: RuntimeRow): boolean {
    const now = Date.now();
    const cooldown =
      runtime.localization_status === 'relocalizing' || this.confirmation
        ? RELOCALIZATION_COOLDOWN_MS
        : SIGNATURE_COOLDOWN_MS;
    if (now - this.lastLocalizationAtMs < cooldown) return false;
    const latest = this.latestSignature();
    if (
      !latest ||
      runtime.localization_status === 'relocalizing' ||
      runtime.localization_status === 'lost' ||
      this.confirmation
    )
      return true;
    return (
      Math.hypot(runtime.x - latest.map_x, runtime.y - latest.map_y) >=
        SIGNATURE_MIN_DISTANCE ||
      Math.abs(normalizeHeading(runtime.heading - latest.map_heading)) >=
        SIGNATURE_MIN_HEADING ||
      Math.abs(state.cameraPose.pan - latest.pan) +
        Math.abs(state.cameraPose.tilt - latest.tilt) >=
        SIGNATURE_MIN_CAMERA_DELTA ||
      now - Date.parse(latest.observed_at) >= SIGNATURE_COOLDOWN_MS
    );
  }

  private async analyzePlace(
    state: RobotState,
    keyframe: RobotVisionKeyframe,
    initialRuntime: RuntimeRow,
  ): Promise<void> {
    const engine = this.options.placeRecognition;
    const frame = state.vision;
    if (!engine || !frame || frame.frameId !== keyframe.frameId) return;
    const previous = this.latestSignature();
    const features = await engine.extract(
      keyframe.image,
      frame.detections
        .filter((detection) => detection.kind === 'person')
        .map((detection) => ({
          x: detection.x,
          y: detection.y,
          width: detection.width,
          height: detection.height,
        })),
      AbortSignal.timeout(3_200),
    );
    this.localizationDegradedUntil = 0;
    const runtime = this.runtime();
    if (
      runtime.drive_sequence !== initialRuntime.drive_sequence ||
      features.featureCount < 40 ||
      features.quality < MIN_SIGNATURE_QUALITY
    ) {
      this.expireRelocalization(runtime);
      return;
    }
    const objectLabels = [
      ...new Set(
        frame.detections
          .filter(
            (detection) =>
              detection.kind === 'object' && (detection.confidence ?? 0) >= 0.8,
          )
          .map((detection) =>
            detection.label.trim().toLocaleLowerCase('fr-FR'),
          ),
      ),
    ];
    const candidates = this.placeCandidates(
      features.perceptualHash,
      objectLabels,
      runtime,
    );
    const matches =
      candidates.length === 0
        ? []
        : await engine.match(
            features,
            candidates.map((candidate) => this.toPlaceCandidate(candidate)),
            AbortSignal.timeout(3_200),
          );
    const accepted = this.acceptedMatch(matches, candidates);
    const stationarySameView = Boolean(
      previous &&
      previous.drive_sequence === runtime.drive_sequence &&
      Math.abs(previous.pan - state.cameraPose.pan) +
        Math.abs(previous.tilt - state.cameraPose.tilt) <
        SIGNATURE_MIN_CAMERA_DELTA,
    );
    const sceneMismatch = Boolean(
      stationarySameView &&
      previous &&
      hammingHex(features.perceptualHash, previous.perceptual_hash) > 20,
    );
    if (!accepted && sceneMismatch) {
      this.stationaryMismatchCount += 1;
      if (this.stationaryMismatchCount >= 2)
        this.markRelocalizing(
          runtime,
          'La scène a changé sans commande de roues ; déplacement physique probable.',
        );
      this.confirmation = null;
      this.expireRelocalization(this.runtime());
      return;
    }
    this.stationaryMismatchCount = 0;
    const shouldPersist = Boolean(
      !previous ||
      previous.drive_sequence !== runtime.drive_sequence ||
      Math.abs(previous.pan - state.cameraPose.pan) +
        Math.abs(previous.tilt - state.cameraPose.tilt) >=
        SIGNATURE_MIN_CAMERA_DELTA,
    );
    const signatureId = shouldPersist
      ? this.persistSignature(state, runtime, features, objectLabels)
      : null;
    if (accepted)
      this.confirmVisualMatch(
        accepted.match,
        accepted.candidate,
        runtime,
        state.cameraPose.pan,
        previous,
        signatureId,
      );
    else {
      this.confirmation = null;
      this.expireRelocalization(runtime);
    }
  }

  private placeCandidates(
    perceptualHash: string,
    objectLabels: string[],
    runtime: RuntimeRow,
  ): PlaceSignatureRow[] {
    const rows = this.database
      .prepare(
        `SELECT id, map_point_id, session_id, segment_id, frame_id,
                drive_sequence, perceptual_hash, keypoints_json, descriptors,
                feature_count, quality, pan, tilt, map_x, map_y, map_heading,
                object_labels_json, observed_at
           FROM robot_place_signatures WHERE household_id = ?
          ORDER BY protected DESC, observed_at DESC LIMIT ?`,
      )
      .all(this.householdId, MAX_PLACE_SIGNATURES) as PlaceSignatureRow[];
    const labels = new Set(objectLabels);
    return rows
      .filter(
        (row) =>
          (!this.confirmation ||
            Date.parse(row.observed_at) < this.confirmation.firstObservedAt) &&
          (Date.now() - Date.parse(row.observed_at) > 1_500 ||
            row.segment_id !== runtime.segment_id),
      )
      .map((row) => {
        const overlap = (JSON.parse(row.object_labels_json) as string[]).filter(
          (label) => labels.has(label),
        ).length;
        return {
          row,
          rank:
            hammingHex(perceptualHash, row.perceptual_hash) -
            overlap * 5 +
            Math.abs(runtime.heading - row.map_heading) * 0.5,
        };
      })
      .sort((left, right) => left.rank - right.rank)
      .slice(0, 8)
      .map(({ row }) => row);
  }

  private acceptedMatch(
    matches: RobotPlaceMatch[],
    candidates: PlaceSignatureRow[],
  ): { candidate: PlaceSignatureRow; match: RobotPlaceMatch } | null {
    const eligible = matches.filter(
      (match) =>
        match.rawMatches >= MIN_RAW_MATCHES &&
        match.inliers >= MIN_INLIERS &&
        match.inlierRatio >= MIN_INLIER_RATIO &&
        match.coverage >= MIN_COVERAGE &&
        match.score >= MIN_MATCH_SCORE,
    );
    const best = eligible[0];
    if (!best) return null;
    const candidate = candidates.find((item) => item.id === best.candidateId);
    if (!candidate) return null;
    const competing = eligible.find((match) => {
      const other = candidates.find((item) => item.id === match.candidateId);
      return (
        other &&
        other.id !== candidate.id &&
        Math.hypot(
          other.map_x - candidate.map_x,
          other.map_y - candidate.map_y,
        ) > 0.4
      );
    });
    if (competing && best.score - competing.score < MIN_MATCH_MARGIN)
      return null;
    return { candidate, match: best };
  }

  private confirmVisualMatch(
    match: RobotPlaceMatch,
    candidate: PlaceSignatureRow,
    runtime: RuntimeRow,
    pan: number,
    previous: PlaceSignatureRow | null,
    currentSignatureId: string | null,
  ): void {
    const heading = normalizeHeading(
      candidate.map_heading +
        (candidate.pan - pan) * (Math.PI / 2) -
        match.rotationRad,
    );
    const manualCandidate =
      runtime.localization_status === 'relocalizing' ||
      Boolean(
        previous &&
        previous.drive_sequence === runtime.drive_sequence &&
        (Math.hypot(candidate.map_x - runtime.x, candidate.map_y - runtime.y) >
          0.75 ||
          Math.abs(normalizeHeading(heading - runtime.heading)) > Math.PI / 5),
      );
    const current = this.confirmation;
    if (
      !current ||
      Date.now() - current.firstObservedAt > 5_000 ||
      Math.hypot(current.x - candidate.map_x, current.y - candidate.map_y) >
        0.4 ||
      Math.abs(normalizeHeading(current.heading - heading)) > Math.PI / 12
    ) {
      this.confirmation = {
        candidate,
        currentDriveSequence: runtime.drive_sequence,
        firstObservedAt: Date.now(),
        heading,
        match,
        observations: 1,
        pan,
        x: candidate.map_x,
        y: candidate.map_y,
        manualCandidate,
        currentSignatureId,
      };
      return;
    }
    current.observations += 1;
    current.match = match.score > current.match.score ? match : current.match;
    current.manualCandidate ||= manualCandidate;
    current.currentSignatureId =
      currentSignatureId ?? current.currentSignatureId;
    if (current.observations < 2) return;
    this.applyVisualCorrection(current, runtime);
    this.confirmation = null;
  }

  private applyVisualCorrection(
    confirmation: LocalizationConfirmation,
    runtime: RuntimeRow,
  ): void {
    if (confirmation.manualCandidate) {
      this.applyManualRelocation(confirmation, runtime);
      return;
    }
    if (!confirmation.candidate.map_point_id) return;
    const currentPoint = this.currentMapPoint(runtime.segment_id);
    if (
      !currentPoint ||
      currentPoint.id === confirmation.candidate.map_point_id
    )
      return;
    const now = new Date().toISOString();
    const constraintId = randomUUID();
    let corrected: { heading: number; x: number; y: number } | null = null;
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO robot_pose_constraints(
             id, household_id, source_point_id, target_point_id, kind,
             dx, dy, dheading, confidence, inlier_count, inlier_ratio,
             created_at
           ) VALUES (?, ?, ?, ?, 'visual_loop', 0, 0, 0, ?, ?, ?, ?)`,
        )
        .run(
          constraintId,
          this.householdId,
          confirmation.candidate.map_point_id,
          currentPoint.id,
          confirmation.match.score,
          confirmation.match.inliers,
          confirmation.match.inlierRatio,
          now,
        );
      corrected = this.optimizePoseGraph(currentPoint.id);
      if (!corrected) throw new Error('Correction du graphe de poses vide.');
      const revision = runtime.correction_revision + 1;
      this.database
        .prepare(
          `UPDATE robot_map_runtime
              SET x = ?, y = ?, heading = ?, uncertainty = ?,
                  localization_status = 'estimated',
                  localization_confidence = ?, pose_source = 'visual_loop',
                  correction_revision = ?, last_relocalized_at = ?,
                  localization_started_at = NULL, updated_at = ?
            WHERE household_id = ?`,
        )
        .run(
          corrected.x,
          corrected.y,
          corrected.heading,
          Math.min(runtime.uncertainty, 0.6),
          confirmation.match.score,
          revision,
          now,
          now,
          this.householdId,
        );
      this.protectSignatures(
        confirmation.candidate.id,
        confirmation.currentSignatureId,
      );
      this.recordLocalizationEvent(
        'loop_closure',
        runtime,
        { ...runtime, ...corrected },
        confirmation.match.score,
        `Boucle visuelle confirmée (${confirmation.match.inliers.toString()} inliers).`,
        now,
      );
    })();
  }

  private applyManualRelocation(
    confirmation: LocalizationConfirmation,
    runtime: RuntimeRow,
  ): void {
    const active = this.activeSession();
    const now = new Date().toISOString();
    const segmentId = randomUUID();
    const revision = runtime.correction_revision + 1;
    const relocated: RuntimeRow = {
      ...runtime,
      x: confirmation.x,
      y: confirmation.y,
      heading: confirmation.heading,
      uncertainty: 0.6,
      localization_status: 'estimated',
      localization_confidence: confirmation.match.score,
      localization_started_at: null,
      pose_source: 'visual_relocalization',
      segment_id: segmentId,
      correction_revision: revision,
      last_relocalized_at: now,
      updated_at: now,
    };
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE robot_map_runtime
              SET x = ?, y = ?, heading = ?, uncertainty = ?,
                  localization_status = 'estimated',
                  localization_confidence = ?,
                  pose_source = 'visual_relocalization', segment_id = ?,
                  correction_revision = ?, last_relocalized_at = ?,
                  localization_started_at = NULL, updated_at = ?
            WHERE household_id = ?`,
        )
        .run(
          relocated.x,
          relocated.y,
          relocated.heading,
          relocated.uncertainty,
          relocated.localization_confidence,
          segmentId,
          revision,
          now,
          now,
          this.householdId,
        );
      let newPointId: string | null = null;
      if (active?.status === 'recording')
        newPointId = this.insertPoint(
          active.id,
          active.point_count,
          relocated,
          null,
          null,
          now,
        );
      if (newPointId && confirmation.candidate.map_point_id)
        this.database
          .prepare(
            `INSERT INTO robot_pose_constraints(
               id, household_id, source_point_id, target_point_id, kind,
               dx, dy, dheading, confidence, inlier_count, inlier_ratio,
               created_at
             ) VALUES (?, ?, ?, ?, 'manual_relocation', 0, 0, 0, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            this.householdId,
            confirmation.candidate.map_point_id,
            newPointId,
            confirmation.match.score,
            confirmation.match.inliers,
            confirmation.match.inlierRatio,
            now,
          );
      this.protectSignatures(
        confirmation.candidate.id,
        confirmation.currentSignatureId,
      );
      this.recordLocalizationEvent(
        'manual_relocation',
        runtime,
        relocated,
        confirmation.match.score,
        'Déplacement sans commande de roues : nouveau segment créé.',
        now,
      );
    })();
  }

  private persistSignature(
    state: RobotState,
    runtime: RuntimeRow,
    features: RobotPlaceSignatureFeatures,
    objectLabels: string[],
  ): string | null {
    const frame = state.vision;
    if (!frame) return null;
    const descriptors = Buffer.from(features.descriptors, 'base64');
    const keypointsJson = JSON.stringify(features.keypoints);
    const storageBytes =
      descriptors.byteLength + Buffer.byteLength(keypointsJson);
    if (storageBytes > 128 * 1024) return null;
    const id = randomUUID();
    const point = this.currentMapPoint(runtime.segment_id);
    const active = this.activeSession();
    this.database
      .prepare(
        `INSERT OR IGNORE INTO robot_place_signatures(
           id, household_id, map_point_id, keyframe_id, session_id, segment_id,
           frame_id,
           drive_sequence, perceptual_hash, keypoints_json, descriptors,
           feature_count, quality, pan, tilt, map_x, map_y, map_heading,
           object_labels_json, protected, storage_bytes, observed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        id,
        this.householdId,
        point?.id ?? null,
        this.keyframeIdForFrame(frame.frameId),
        active?.id ?? null,
        runtime.segment_id,
        frame.frameId,
        runtime.drive_sequence,
        features.perceptualHash,
        keypointsJson,
        descriptors,
        features.featureCount,
        features.quality,
        state.cameraPose.pan,
        state.cameraPose.tilt,
        runtime.x,
        runtime.y,
        runtime.heading,
        JSON.stringify(objectLabels),
        storageBytes,
        frame.observedAt,
        new Date().toISOString(),
      );
    this.pruneSignatures();
    return id;
  }

  private optimizePoseGraph(
    currentPointId: string,
  ): { heading: number; x: number; y: number } | null {
    const rows = this.database
      .prepare(
        `SELECT id, session_id, sequence, x, y, heading,
                COALESCE(raw_x, x) AS raw_x,
                COALESCE(raw_y, y) AS raw_y,
                COALESCE(raw_heading, heading) AS raw_heading,
                segment_id, direction
           FROM robot_map_points WHERE household_id = ?
          ORDER BY recorded_at`,
      )
      .all(this.householdId) as PoseGraphRow[];
    if (rows.length < 2) return null;
    const before = new Map(rows.map((row) => [row.id, { ...row }]));
    const constraints = buildOdometryConstraints(rows);
    const visual = this.database
      .prepare(
        `SELECT source_point_id, target_point_id, dx, dy, dheading,
                confidence, kind
           FROM robot_pose_constraints WHERE household_id = ?`,
      )
      .all(this.householdId) as Array<{
      confidence: number;
      dheading: number;
      dx: number;
      dy: number;
      kind: 'manual_relocation' | 'visual_loop';
      source_point_id: string;
      target_point_id: string;
    }>;
    constraints.push(
      ...visual.map((item) => ({
        sourceId: item.source_point_id,
        targetId: item.target_point_id,
        dx: item.dx,
        dy: item.dy,
        dheading: item.dheading,
        weight: item.kind === 'manual_relocation' ? 2.5 : 1.5 * item.confidence,
      })),
    );
    const optimized = relaxPoseGraph(rows, constraints, 30);
    const revision = this.runtime().correction_revision + 1;
    const update = this.database.prepare(
      `UPDATE robot_map_points
          SET x = ?, y = ?, heading = ?, correction_revision = ?,
              pose_source = 'visual_loop'
        WHERE id = ?`,
    );
    for (const node of optimized.values())
      update.run(node.x, node.y, node.heading, revision, node.id);
    this.correctAnchoredMemories(before, optimized);
    this.rebuildMapCells();
    this.updateOdometryCalibration(rows, optimized);
    const current = optimized.get(currentPointId);
    return current
      ? { x: current.x, y: current.y, heading: current.heading }
      : null;
  }

  private correctAnchoredMemories(
    before: Map<string, PoseGraphRow>,
    after: Map<string, PoseGraphNode>,
  ): void {
    const corrections = [...before.values()].map((point) => {
      const corrected = after.get(point.id)!;
      return {
        segmentId: point.segment_id,
        x: point.x,
        y: point.y,
        dx: corrected.x - point.x,
        dy: corrected.y - point.y,
        dheading: normalizeHeading(corrected.heading - point.heading),
      };
    });
    const nearest = (segmentId: string | null, x: number, y: number) =>
      corrections
        .filter((item) => !segmentId || item.segmentId === segmentId)
        .reduce<(typeof corrections)[number] | null>((best, item) => {
          if (!best) return item;
          return Math.hypot(item.x - x, item.y - y) <
            Math.hypot(best.x - x, best.y - y)
            ? item
            : best;
        }, null);
    const viewpoints = this.database
      .prepare(
        `SELECT id, x, y, heading, segment_id FROM robot_map_viewpoints
          WHERE household_id = ?`,
      )
      .all(this.householdId) as Array<{
      heading: number;
      id: string;
      segment_id: string | null;
      x: number;
      y: number;
    }>;
    const updateViewpoint = this.database.prepare(
      `UPDATE robot_map_viewpoints SET x = ?, y = ?, heading = ? WHERE id = ?`,
    );
    for (const item of viewpoints) {
      const correction = nearest(item.segment_id, item.x, item.y);
      if (!correction) continue;
      const x = item.x + correction.dx;
      const y = item.y + correction.dy;
      updateViewpoint.run(
        x,
        y,
        normalizeHeading(item.heading + correction.dheading),
        item.id,
      );
    }
    for (const table of [
      {
        name: 'robot_memory_keyframes',
        id: 'id',
        x: 'map_x',
        y: 'map_y',
        heading: 'map_heading',
        segment: 'segment_id',
      },
      {
        name: 'robot_memory_entities',
        id: 'id',
        x: 'map_x',
        y: 'map_y',
        heading: null,
        segment: 'map_segment_id',
      },
      {
        name: 'robot_place_signatures',
        id: 'id',
        x: 'map_x',
        y: 'map_y',
        heading: 'map_heading',
        segment: 'segment_id',
      },
    ] as const) {
      const records = this.database
        .prepare(
          `SELECT ${table.id} AS id, ${table.x} AS x, ${table.y} AS y,
                  ${table.heading ? `${table.heading} AS heading` : 'NULL AS heading'},
                  ${table.segment} AS segment_id
             FROM ${table.name}
            WHERE household_id = ? AND ${table.x} IS NOT NULL AND ${table.y} IS NOT NULL`,
        )
        .all(this.householdId) as Array<{
        heading: number | null;
        id: string;
        segment_id: string | null;
        x: number;
        y: number;
      }>;
      const update = this.database.prepare(
        `UPDATE ${table.name} SET ${table.x} = ?, ${table.y} = ?${
          table.heading ? `, ${table.heading} = ?` : ''
        } WHERE ${table.id} = ?`,
      );
      for (const record of records) {
        const correction = nearest(record.segment_id, record.x, record.y);
        if (!correction) continue;
        const values: Array<number | string> = [
          record.x + correction.dx,
          record.y + correction.dy,
        ];
        if (table.heading)
          values.push(
            normalizeHeading((record.heading ?? 0) + correction.dheading),
          );
        values.push(record.id);
        update.run(...values);
      }
    }
  }

  private rebuildMapCells(): void {
    this.database
      .prepare('DELETE FROM robot_map_cells WHERE household_id = ?')
      .run(this.householdId);
    const points = this.database
      .prepare(
        `SELECT x, y, uncertainty, recorded_at FROM robot_map_points
          WHERE household_id = ? ORDER BY recorded_at`,
      )
      .all(this.householdId) as Array<{
      recorded_at: string;
      uncertainty: number;
      x: number;
      y: number;
    }>;
    const runtime = this.runtime();
    for (const point of points)
      this.recordMapCell(
        {
          ...runtime,
          x: point.x,
          y: point.y,
          uncertainty: point.uncertainty,
          updated_at: point.recorded_at,
        },
        false,
      );
  }

  private updateOdometryCalibration(
    before: PoseGraphRow[],
    after: Map<string, PoseGraphNode>,
  ): void {
    const calibration = this.odometryCalibration();
    const ratios = {
      forward: [] as number[],
      backward: [] as number[],
      turn: [] as number[],
    };
    for (let index = 1; index < before.length; index += 1) {
      const previous = before[index - 1]!;
      const current = before[index]!;
      if (previous.segment_id !== current.segment_id) continue;
      const rawDistance = Math.hypot(
        current.raw_x - previous.raw_x,
        current.raw_y - previous.raw_y,
      );
      const correctedPrevious = after.get(previous.id)!;
      const correctedCurrent = after.get(current.id)!;
      const correctedDistance = Math.hypot(
        correctedCurrent.x - correctedPrevious.x,
        correctedCurrent.y - correctedPrevious.y,
      );
      if (rawDistance > 0.005 && current.direction === 'forward')
        ratios.forward.push(correctedDistance / rawDistance);
      if (rawDistance > 0.005 && current.direction === 'backward')
        ratios.backward.push(correctedDistance / rawDistance);
      const rawTurn = Math.abs(
        normalizeHeading(current.raw_heading - previous.raw_heading),
      );
      const correctedTurn = Math.abs(
        normalizeHeading(correctedCurrent.heading - correctedPrevious.heading),
      );
      if (rawTurn > 0.01) ratios.turn.push(correctedTurn / rawTurn);
    }
    const count = calibration.accepted_closure_count + 1;
    const learned = count > 10;
    const adjust = (
      value: number,
      samples: number[],
      min: number,
      max: number,
    ) => {
      if (!learned || samples.length === 0) return value;
      const ratio = clamp(median(samples), 0.85, 1.15);
      return clamp(value * clamp(ratio, 0.98, 1.02), min, max);
    };
    this.database
      .prepare(
        `UPDATE robot_odometry_calibration
            SET forward_mps = ?, backward_mps = ?, steering_rps = ?,
                reverse_steering_rps = ?, turn_rps = ?,
                accepted_closure_count = ?, updated_at = ?
          WHERE household_id = ?`,
      )
      .run(
        adjust(calibration.forward_mps, ratios.forward, 0.4675, 0.6325),
        adjust(calibration.backward_mps, ratios.backward, 0.3825, 0.5175),
        adjust(calibration.steering_rps, ratios.turn, 1.7, 2.3),
        adjust(calibration.reverse_steering_rps, ratios.turn, 1.36, 1.84),
        adjust(calibration.turn_rps, ratios.turn, 3.4, 4.6),
        count,
        new Date().toISOString(),
        this.householdId,
      );
  }

  private expireRelocalization(runtime: RuntimeRow): void {
    if (
      runtime.localization_status !== 'relocalizing' ||
      !runtime.localization_started_at ||
      Date.now() - Date.parse(runtime.localization_started_at) < 5_000
    )
      return;
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE robot_map_runtime SET localization_status = 'lost',
                  localization_confidence = 0.05, updated_at = ?
            WHERE household_id = ?`,
        )
        .run(now, this.householdId);
      this.recordLocalizationEvent(
        'lost',
        runtime,
        runtime,
        0.05,
        'Aucun lieu connu confirmé après cinq secondes.',
        now,
      );
    })();
  }

  private markRelocalizing(runtime: RuntimeRow, reason: string): void {
    if (runtime.localization_status === 'relocalizing') return;
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE robot_map_runtime
              SET localization_status = 'relocalizing',
                  localization_confidence = 0.1,
                  localization_started_at = ?, updated_at = ?
            WHERE household_id = ?`,
        )
        .run(now, now, this.householdId);
      this.recordLocalizationEvent('lost', runtime, runtime, 0.1, reason, now);
    })();
  }

  private latestSignature(): PlaceSignatureRow | null {
    return (
      (this.database
        .prepare(
          `SELECT id, map_point_id, session_id, segment_id, frame_id,
                  drive_sequence, perceptual_hash, keypoints_json, descriptors,
                  feature_count, quality, pan, tilt, map_x, map_y, map_heading,
                  object_labels_json, observed_at
             FROM robot_place_signatures WHERE household_id = ?
            ORDER BY observed_at DESC LIMIT 1`,
        )
        .get(this.householdId) as PlaceSignatureRow | undefined) ?? null
    );
  }

  private currentMapPoint(
    segmentId: string,
  ): { id: string; sequence: number; session_id: string } | null {
    return (
      (this.database
        .prepare(
          `SELECT id, sequence, session_id FROM robot_map_points
            WHERE household_id = ? AND segment_id = ?
           ORDER BY recorded_at DESC LIMIT 1`,
        )
        .get(this.householdId, segmentId) as
        { id: string; sequence: number; session_id: string } | undefined) ??
      null
    );
  }

  private toPlaceCandidate(row: PlaceSignatureRow): RobotPlaceCandidate {
    return {
      id: row.id,
      perceptualHash: row.perceptual_hash,
      keypoints: JSON.parse(row.keypoints_json) as Array<
        [number, number, number]
      >,
      descriptors: row.descriptors.toString('base64'),
      featureCount: row.feature_count,
      quality: row.quality,
    };
  }

  private pruneSignatures(): void {
    const usage = this.database
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(storage_bytes), 0) AS bytes
           FROM robot_place_signatures WHERE household_id = ?`,
      )
      .get(this.householdId) as { bytes: number; count: number };
    let count = usage.count;
    let bytes = usage.bytes;
    const removable = this.database
      .prepare(
        `SELECT id, storage_bytes FROM robot_place_signatures
          WHERE household_id = ?
          ORDER BY protected ASC, observed_at`,
      )
      .all(this.householdId) as Array<{ id: string; storage_bytes: number }>;
    const remove = this.database.prepare(
      'DELETE FROM robot_place_signatures WHERE id = ?',
    );
    for (const item of removable) {
      if (count <= MAX_PLACE_SIGNATURES && bytes <= SIGNATURE_QUOTA_BYTES)
        break;
      remove.run(item.id);
      count -= 1;
      bytes -= item.storage_bytes;
    }
  }

  private protectSignatures(
    candidateId: string,
    currentId: string | null,
  ): void {
    this.database
      .prepare(
        `UPDATE robot_place_signatures SET protected = 1
          WHERE id IN (?, ?)`,
      )
      .run(candidateId, currentId ?? candidateId);
  }

  private keyframeIdForFrame(frameId: number): string | null {
    return (
      (
        this.database
          .prepare(
            `SELECT id FROM robot_memory_keyframes
              WHERE household_id = ? AND frame_id = ?`,
          )
          .get(this.householdId, frameId) as { id: string } | undefined
      )?.id ?? null
    );
  }

  private recordLocalizationEvent(
    kind:
      'loop_closure' | 'manual_relocation' | 'lost' | 'recovered' | 'rejected',
    oldPose: Pick<RuntimeRow, 'heading' | 'x' | 'y'>,
    newPose: Pick<RuntimeRow, 'heading' | 'x' | 'y'>,
    confidence: number,
    reason: string,
    createdAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO robot_localization_events(
           id, household_id, kind, old_x, old_y, old_heading,
           new_x, new_y, new_heading, confidence, reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        this.householdId,
        kind,
        oldPose.x,
        oldPose.y,
        oldPose.heading,
        newPose.x,
        newPose.y,
        newPose.heading,
        clamp(confidence, 0, 1),
        reason.slice(0, 500),
        createdAt,
      );
  }

  private odometryCalibration(): {
    accepted_closure_count: number;
    backward_mps: number;
    forward_mps: number;
    reverse_steering_rps: number;
    steering_rps: number;
    turn_rps: number;
  } {
    return this.database
      .prepare(
        `SELECT accepted_closure_count, backward_mps, forward_mps,
                reverse_steering_rps, steering_rps, turn_rps
           FROM robot_odometry_calibration WHERE household_id = ?`,
      )
      .get(this.householdId) as {
      accepted_closure_count: number;
      backward_mps: number;
      forward_mps: number;
      reverse_steering_rps: number;
      steering_rps: number;
      turn_rps: number;
    };
  }

  private assertNavigationCameraPose(state: RobotState): void {
    if (
      Math.abs(state.cameraPose.pan) > 0.02 ||
      Math.abs(state.cameraPose.tilt - 0.2) > 0.02
    )
      throw new RobotMappingError(
        'robot_mapping_camera_pose_required',
        'Recentrez la caméra avec le preset central avant de lancer Carto.',
      );
  }

  private runtime(): RuntimeRow {
    return this.database
      .prepare(
        `SELECT operating_mode, x, y, heading, uncertainty, last_frame_id,
                localization_status, localization_confidence, pose_source,
                segment_id, correction_revision, last_relocalized_at,
                localization_started_at,
                drive_sequence, updated_at
           FROM robot_map_runtime WHERE household_id = ?`,
      )
      .get(this.householdId) as RuntimeRow;
  }

  private activeSession(): SessionRow | undefined {
    return this.database
      .prepare(
        `SELECT id, name, status, point_count, storage_bytes, started_at,
                created_at, updated_at
           FROM robot_mapping_sessions
          WHERE household_id = ? AND status IN ('recording', 'paused', 'processing')
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(this.householdId) as SessionRow | undefined;
  }

  private updateActiveStatus(status: 'paused' | 'recording'): void {
    const active = this.activeSession();
    if (!active) return;
    this.database
      .prepare(
        'UPDATE robot_mapping_sessions SET status = ?, updated_at = ? WHERE id = ?',
      )
      .run(status, new Date().toISOString(), active.id);
  }

  private householdPointCount(): number {
    return (
      this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM robot_map_points WHERE household_id = ?',
        )
        .get(this.householdId) as { count: number }
    ).count;
  }

  private lastPoint(
    sessionId: string,
  ): { heading: number; x: number; y: number } | undefined {
    return this.database
      .prepare(
        `SELECT x, y, heading FROM robot_map_points
          WHERE session_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(sessionId) as { heading: number; x: number; y: number } | undefined;
  }

  private insertPoint(
    sessionId: string,
    sequence: number,
    pose: RuntimeRow,
    command: RobotDriveRequest | null,
    frameId: number | null,
    recordedAt: string,
  ): string {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO robot_map_points(
           id, household_id, session_id, sequence, x, y, heading, uncertainty,
           direction, intensity, steering, duration_ms, frame_id, recorded_at,
           raw_x, raw_y, raw_heading, segment_id, correction_revision,
           pose_source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.householdId,
        sessionId,
        sequence,
        pose.x,
        pose.y,
        pose.heading,
        pose.uncertainty,
        command?.direction ?? null,
        command?.intensity ?? null,
        command?.steering ?? null,
        command?.maxDurationMs ?? null,
        frameId,
        recordedAt,
        pose.x,
        pose.y,
        pose.heading,
        pose.segment_id,
        pose.correction_revision,
        pose.pose_source,
      );
    this.database
      .prepare(
        `UPDATE robot_mapping_sessions
            SET point_count = point_count + 1,
                storage_bytes = storage_bytes + ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(BYTES_PER_POINT, recordedAt, sessionId);
    return id;
  }

  private anchorConfirmedObjects(state: RobotState, pose: RuntimeRow): void {
    const frame = state.vision;
    if (!frame) return;
    const cameraHeading = pose.heading + state.cameraPose.pan * (Math.PI / 2);
    for (const detection of frame.detections) {
      if (detection.kind !== 'object' || (detection.confidence ?? 0) < 0.8)
        continue;
      const centerX = detection.x + detection.width / 2;
      const centerY = detection.y + detection.height / 2;
      const angle = cameraHeading + (centerX - 0.5) * 1.05;
      const distance = 0.5 + (1 - centerY) * 1.2;
      this.database
        .prepare(
          `UPDATE robot_memory_entities
              SET map_x = ?, map_y = ?, map_uncertainty = ?,
                  map_session_id = COALESCE(map_session_id, ?),
                  map_segment_id = ?
            WHERE household_id = ? AND class_label = ?
              AND last_seen_at = ? AND status = 'confirmed'`,
        )
        .run(
          pose.x + Math.cos(angle) * distance,
          pose.y + Math.sin(angle) * distance,
          Math.min(100, pose.uncertainty + 1),
          this.activeSession()?.id ?? null,
          pose.segment_id,
          this.householdId,
          detection.label.trim().toLocaleLowerCase('fr-FR'),
          frame.observedAt,
        );
    }
  }

  private purgeExpiredDrafts(): void {
    const cutoff = new Date(Date.now() - DRAFT_RETENTION_MS).toISOString();
    this.database
      .prepare(
        `DELETE FROM robot_mapping_sessions
          WHERE household_id = ? AND status = 'draft' AND updated_at < ?`,
      )
      .run(this.householdId, cutoff);
  }

  private recordMapCell(pose: RuntimeRow, visual: boolean): void {
    this.database
      .prepare(
        `INSERT INTO robot_map_cells(
           household_id, cell_x, cell_y, visit_count,
           visual_observation_count, uncertainty, last_seen_at
         ) VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(household_id, cell_x, cell_y) DO UPDATE SET
           visit_count = visit_count + 1,
           visual_observation_count = visual_observation_count + excluded.visual_observation_count,
           uncertainty = excluded.uncertainty,
           last_seen_at = excluded.last_seen_at`,
      )
      .run(
        this.householdId,
        Math.round(pose.x / 0.2),
        Math.round(pose.y / 0.2),
        visual ? 1 : 0,
        pose.uncertainty,
        pose.updated_at,
      );
  }

  private recordViewpoint(state: RobotState, pose: RuntimeRow): void {
    const frame = state.vision;
    if (!frame) return;
    this.database
      .prepare(
        `INSERT INTO robot_map_viewpoints(
           id, household_id, cell_x, cell_y, pan_bucket, tilt_bucket,
           x, y, heading, pan, tilt, observation_count, last_frame_id,
           last_seen_at, segment_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(household_id, cell_x, cell_y, pan_bucket, tilt_bucket)
         DO UPDATE SET
           x = excluded.x,
           y = excluded.y,
           heading = excluded.heading,
           pan = excluded.pan,
           tilt = excluded.tilt,
           observation_count = observation_count + 1,
           last_frame_id = excluded.last_frame_id,
           last_seen_at = excluded.last_seen_at,
           segment_id = excluded.segment_id`,
      )
      .run(
        randomUUID(),
        this.householdId,
        Math.round(pose.x / 0.2),
        Math.round(pose.y / 0.2),
        cameraBucket(state.cameraPose.pan, 9),
        cameraBucket(state.cameraPose.tilt, 7),
        pose.x,
        pose.y,
        pose.heading,
        state.cameraPose.pan,
        state.cameraPose.tilt,
        frame.frameId,
        frame.observedAt,
        pose.segment_id,
      );
  }
}

function mapPathStatus(
  status: SessionRow['status'],
): 'certified' | 'draft' | 'explored' {
  if (status === 'certified') return 'certified';
  if (status === 'explored') return 'explored';
  return 'draft';
}

function mapActiveStatus(
  status: SessionRow['status'],
): 'paused' | 'processing' | 'recording' {
  if (status === 'recording') return 'recording';
  if (status === 'processing') return 'processing';
  return 'paused';
}

function localizationStatus(
  runtime: RuntimeRow,
  hasMap: boolean,
): 'estimated' | 'lost' | 'relocalizing' | 'uncertain' | 'unknown' {
  if (!hasMap) return 'unknown';
  if (Date.now() - Date.parse(runtime.updated_at) > 10_000) return 'lost';
  if (runtime.localization_status === 'relocalizing') return 'relocalizing';
  if (runtime.localization_status === 'lost') return 'lost';
  return runtime.uncertainty <= 2 && runtime.localization_confidence >= 0.25
    ? 'estimated'
    : 'uncertain';
}

function normalizeHeading(value: number): number {
  let normalized = value;
  while (normalized > Math.PI) normalized -= 2 * Math.PI;
  while (normalized < -Math.PI) normalized += 2 * Math.PI;
  return normalized;
}

function cameraBucket(value: number, bucketCount: number): number {
  return Math.max(
    0,
    Math.min(bucketCount - 1, Math.floor(((value + 1) / 2) * bucketCount)),
  );
}

function isUuid(value: string | null | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    ),
  );
}

function buildOdometryConstraints(rows: PoseGraphRow[]): PoseGraphConstraint[] {
  const constraints: PoseGraphConstraint[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const source = rows[index - 1]!;
    const target = rows[index]!;
    if (
      source.session_id !== target.session_id ||
      source.segment_id !== target.segment_id ||
      target.sequence !== source.sequence + 1
    )
      continue;
    const worldX = target.raw_x - source.raw_x;
    const worldY = target.raw_y - source.raw_y;
    const cosine = Math.cos(source.raw_heading);
    const sine = Math.sin(source.raw_heading);
    constraints.push({
      sourceId: source.id,
      targetId: target.id,
      dx: cosine * worldX + sine * worldY,
      dy: -sine * worldX + cosine * worldY,
      dheading: normalizeHeading(target.raw_heading - source.raw_heading),
      weight: 0.8,
    });
  }
  return constraints;
}

export function relaxPoseGraph(
  rows: PoseGraphRow[],
  constraints: PoseGraphConstraint[],
  iterations: number,
): Map<string, PoseGraphNode> {
  const nodes = new Map<string, PoseGraphNode>();
  const fixed = new Set<string>();
  const knownSegments = new Set<string>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      segmentId: row.segment_id,
      x: row.x,
      y: row.y,
      heading: row.heading,
    });
    if (!knownSegments.has(row.segment_id)) {
      knownSegments.add(row.segment_id);
      fixed.add(row.id);
    }
  }
  for (let pass = 0; pass < iterations; pass += 1) {
    for (const constraint of constraints) {
      const source = nodes.get(constraint.sourceId);
      const target = nodes.get(constraint.targetId);
      if (!source || !target) continue;
      const cosine = Math.cos(source.heading);
      const sine = Math.sin(source.heading);
      const expectedX =
        source.x + cosine * constraint.dx - sine * constraint.dy;
      const expectedY =
        source.y + sine * constraint.dx + cosine * constraint.dy;
      const residualX = target.x - expectedX;
      const residualY = target.y - expectedY;
      const residualHeading = normalizeHeading(
        target.heading - source.heading - constraint.dheading,
      );
      const sourceFixed = fixed.has(source.id);
      const targetFixed = fixed.has(target.id);
      if (sourceFixed && targetFixed) continue;
      const alpha = 0.18 * clamp(constraint.weight, 0.2, 2.5);
      const share = sourceFixed || targetFixed ? alpha : alpha / 2;
      const moveX = clamp(residualX * share, -0.15, 0.15);
      const moveY = clamp(residualY * share, -0.15, 0.15);
      const moveHeading = clamp(residualHeading * share, -0.08, 0.08);
      if (!targetFixed) {
        target.x -= moveX;
        target.y -= moveY;
        target.heading = normalizeHeading(target.heading - moveHeading);
      }
      if (!sourceFixed) {
        source.x += moveX;
        source.y += moveY;
        source.heading = normalizeHeading(source.heading + moveHeading);
      }
    }
  }
  return nodes;
}

function hammingHex(left: string, right: string): number {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (value > 0n) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const ordered = values.toSorted((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 1) + (ordered[middle] ?? 1)) / 2
    : (ordered[middle] ?? 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
