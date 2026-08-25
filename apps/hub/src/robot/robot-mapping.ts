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

const MAP_QUOTA_BYTES = 250 * 1024 * 1024;
const VISUAL_MEMORY_QUOTA_BYTES = 16 * 1024 * 1024;
const BYTES_PER_POINT = 96;
const MAX_SESSION_POINTS = 2_000;
const MAX_HOUSEHOLD_POINTS = 10_000;
const DRAFT_RETENTION_MS = 7 * 24 * 60 * 60_000;

interface RuntimeRow {
  heading: number;
  last_frame_id: number | null;
  operating_mode: 'autonomous' | 'manual';
  uncertainty: number;
  updated_at: string;
  x: number;
  y: number;
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

  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
  ) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT OR IGNORE INTO robot_map_runtime(
           household_id, operating_mode, x, y, heading, uncertainty, updated_at
         ) VALUES (?, 'manual', 0, 0, 0, 1, ?)`,
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
            `SELECT id, x, y, heading, uncertainty, recorded_at
               FROM robot_map_points WHERE session_id = ?
              ORDER BY sequence LIMIT ?`,
          )
          .all(session.id, MAX_SESSION_POINTS) as Array<{
          heading: number;
          id: string;
          recorded_at: string;
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
    const storageBytes = sessions.reduce(
      (total, session) => total + session.storage_bytes,
      0,
    );
    return RobotMapSnapshotSchema.parse({
      version: 2,
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
      },
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
      viewpointCount,
      currentViewpointVisits: viewpoint?.observation_count ?? 0,
    };
  }

  observe(state: RobotState): void {
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
  }

  recordDrive(command: RobotDriveRequest, state: RobotState): void {
    const runtime = this.runtime();
    const nowMs = Date.now();
    const elapsedMs =
      this.lastDriveAtMs === null || nowMs - this.lastDriveAtMs > 600
        ? Math.min(command.maxDurationMs, 180)
        : Math.min(command.maxDurationMs, nowMs - this.lastDriveAtMs);
    this.lastDriveAtMs = nowMs;
    const durationSeconds = Math.max(elapsedMs, 50) / 1_000;
    const distance =
      command.direction === 'forward'
        ? command.intensity * durationSeconds * 0.55
        : command.direction === 'backward'
          ? -command.intensity * durationSeconds * 0.45
          : 0;
    const turn =
      command.direction === 'forward'
        ? command.steering * command.intensity * durationSeconds * 2
        : command.direction === 'backward'
          ? -command.steering * command.intensity * durationSeconds * 1.6
          : (command.direction === 'left' ? 1 : -1) *
            command.intensity *
            durationSeconds *
            4;
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
    };
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE robot_map_runtime
              SET x = ?, y = ?, heading = ?, uncertainty = ?, updated_at = ?
            WHERE household_id = ?`,
        )
        .run(
          next.x,
          next.y,
          next.heading,
          next.uncertainty,
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
    const allowed = Boolean(
      point &&
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
                updated_at FROM robot_map_runtime WHERE household_id = ?`,
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
  ): void {
    this.database
      .prepare(
        `INSERT INTO robot_map_points(
           id, household_id, session_id, sequence, x, y, heading, uncertainty,
           direction, intensity, steering, duration_ms, frame_id, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
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
      );
    this.database
      .prepare(
        `UPDATE robot_mapping_sessions
            SET point_count = point_count + 1,
                storage_bytes = storage_bytes + ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(BYTES_PER_POINT, recordedAt, sessionId);
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
                  map_session_id = COALESCE(map_session_id, ?)
            WHERE household_id = ? AND class_label = ?
              AND last_seen_at = ? AND status = 'confirmed'`,
        )
        .run(
          pose.x + Math.cos(angle) * distance,
          pose.y + Math.sin(angle) * distance,
          Math.min(100, pose.uncertainty + 1),
          this.activeSession()?.id ?? null,
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
           last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(household_id, cell_x, cell_y, pan_bucket, tilt_bucket)
         DO UPDATE SET
           x = excluded.x,
           y = excluded.y,
           heading = excluded.heading,
           pan = excluded.pan,
           tilt = excluded.tilt,
           observation_count = observation_count + 1,
           last_frame_id = excluded.last_frame_id,
           last_seen_at = excluded.last_seen_at`,
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
): 'estimated' | 'lost' | 'uncertain' | 'unknown' {
  if (!hasMap) return 'unknown';
  if (Date.now() - Date.parse(runtime.updated_at) > 10_000) return 'lost';
  return runtime.uncertainty <= 2 ? 'estimated' : 'uncertain';
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
