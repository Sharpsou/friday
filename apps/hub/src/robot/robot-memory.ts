import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import {
  RobotMemorySummarySchema,
  type RobotMemorySummary,
  type RobotState,
} from '@friday/contracts';

import type { RobotVisionKeyframe } from './robot-controller.js';

interface EntityRow {
  class_label: string;
  confidence: number;
  display_name: string;
  first_seen_at: string;
  id: string;
  kind: 'light' | 'object';
  last_seen_at: string;
  last_x: number;
  last_y: number;
  room_name: string;
  sighting_count: number;
  status: 'candidate' | 'confirmed' | 'uncertain';
  viewpoint_keys_json: string;
}

const PRESENCE_RETENTION_MS = 24 * 60 * 60_000;
const OBSERVATION_RETENTION_MS = 24 * 60 * 60_000;
const KEYFRAME_QUOTA_BYTES = 16 * 1024 * 1024;
const MAX_KEYFRAMES = 48;
const MAX_KEYFRAMES_PER_ENTITY = 3;
const KEYFRAME_COOLDOWN_MS = 10_000;
const MAX_KEYFRAME_BYTES = 256 * 1024;

interface RecordedObject {
  becameConfirmed: boolean;
  entityId: string;
  isConfirmed: boolean;
  newViewpoint: boolean;
}

interface MapEstimate {
  uncertainty: number;
  x: number;
  y: number;
}

export class RobotMemoryService {
  #lastFrameId = -1;

  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly defaultRoomName = 'Salon',
  ) {}

  observe(
    state: RobotState,
    keyframe: RobotVisionKeyframe | null = null,
  ): void {
    const frame = state.vision;
    if (!frame || frame.frameId === this.#lastFrameId) return;
    if (Date.parse(frame.expiresAt) <= Date.now()) return;
    this.#lastFrameId = frame.frameId;
    const roomId = this.ensureRoom(this.defaultRoomName);
    const viewpointKey = `${quantizeSigned(state.cameraPose.pan, 4)}:${quantizeSigned(state.cameraPose.tilt, 4)}`;
    const mapPose = this.mappingPose();

    const recordedObjects: RecordedObject[] = [];
    this.database.transaction(() => {
      for (const detection of frame.detections) {
        if (detection.kind === 'person') {
          this.recordPresence(
            frame.observedAt,
            detection.confidence ?? 0,
            detection.x + detection.width / 2,
            detection.y + detection.height / 2,
            frame.frameId,
          );
          continue;
        }
        if (detection.kind !== 'object' || detection.confidence === null)
          continue;
        recordedObjects.push(
          this.recordObject(
            roomId,
            frame.frameId,
            frame.observedAt,
            detection.label,
            detection.confidence,
            detection.x + detection.width / 2,
            detection.y + detection.height / 2,
            viewpointKey,
            mapPose
              ? estimateObjectPosition(
                  mapPose,
                  state.cameraPose.pan,
                  detection.x + detection.width / 2,
                  detection.y + detection.height / 2,
                )
              : null,
          ),
        );
      }
      this.persistRelevantKeyframe(state, keyframe, recordedObjects);
      const observationCutoff = new Date(
        Date.now() - OBSERVATION_RETENTION_MS,
      ).toISOString();
      const presenceCutoff = new Date(
        Date.now() - PRESENCE_RETENTION_MS,
      ).toISOString();
      this.database
        .prepare(
          'DELETE FROM robot_memory_observations WHERE household_id = ? AND observed_at < ?',
        )
        .run(this.householdId, observationCutoff);
      this.database
        .prepare(
          'DELETE FROM robot_presence_events WHERE household_id = ? AND last_seen_at < ?',
        )
        .run(this.householdId, presenceCutoff);
    })();
  }

  keyframe(id: string): { image: Buffer; observedAt: string } | null {
    const row = this.database
      .prepare(
        `SELECT image_jpeg, observed_at FROM robot_memory_keyframes
          WHERE id = ? AND household_id = ?`,
      )
      .get(id, this.householdId) as
      { image_jpeg: Buffer; observed_at: string } | undefined;
    return row ? { image: row.image_jpeg, observedAt: row.observed_at } : null;
  }

  summary(): RobotMemorySummary {
    const entities = this.database
      .prepare(
        `SELECT e.id, e.kind, e.class_label, e.display_name, r.name AS room_name,
                e.confidence, e.status, e.sighting_count, e.first_seen_at,
                e.last_seen_at, e.last_x, e.last_y, e.viewpoint_keys_json
           FROM robot_memory_entities e
           JOIN robot_rooms r ON r.id = e.room_id
          WHERE e.household_id = ?
          ORDER BY e.status = 'confirmed' DESC, e.last_seen_at DESC
          LIMIT 100`,
      )
      .all(this.householdId) as EntityRow[];
    const presence = this.database
      .prepare(
        `SELECT last_seen_at FROM robot_presence_events
          WHERE household_id = ? AND last_seen_at >= ?
          ORDER BY last_seen_at DESC LIMIT 1`,
      )
      .get(
        this.householdId,
        new Date(Date.now() - PRESENCE_RETENTION_MS).toISOString(),
      ) as { last_seen_at: string } | undefined;
    const learning = this.database
      .prepare(
        `SELECT mode, episode_count FROM robot_navigation_policies
          WHERE household_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(this.householdId) as
      | {
          episode_count: number;
          mode:
            'candidate' | 'forbidden' | 'regressed' | 'shadow' | 'validated';
        }
      | undefined;

    return RobotMemorySummarySchema.parse({
      roomName: this.defaultRoomName,
      entities: entities.map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        classLabel: entity.class_label,
        displayName: entity.display_name,
        roomName: entity.room_name,
        confidence: entity.confidence,
        status: entity.status,
        sightingCount: entity.sighting_count,
        firstSeenAt: entity.first_seen_at,
        lastSeenAt: entity.last_seen_at,
        lastPosition: { x: entity.last_x, y: entity.last_y },
      })),
      anonymousPresence: {
        active: Boolean(
          presence && Date.now() - Date.parse(presence.last_seen_at) <= 15_000,
        ),
        lastSeenAt: presence?.last_seen_at ?? null,
      },
      mapping: { enabled: true, status: 'observer' },
      learning: {
        mode: learning
          ? learning.mode === 'shadow'
            ? 'shadow'
            : 'online'
          : 'disabled',
        policyStatus: learningModeStatus(learning?.mode),
        episodeCount: learning?.episode_count ?? 0,
      },
    });
  }

  rename(entityId: string, displayName: string): RobotMemorySummary {
    const result = this.database
      .prepare(
        `UPDATE robot_memory_entities SET display_name = ?, updated_at = ?
          WHERE id = ? AND household_id = ?`,
      )
      .run(
        displayName.trim(),
        new Date().toISOString(),
        entityId,
        this.householdId,
      );
    if (result.changes === 0) throw new Error('Objet mémorisé introuvable.');
    return this.summary();
  }

  private ensureRoom(name: string): string {
    const existing = this.database
      .prepare('SELECT id FROM robot_rooms WHERE household_id = ? AND name = ?')
      .get(this.householdId, name) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO robot_rooms(id, household_id, name, status, created_at, updated_at)
         VALUES (?, ?, ?, 'confirmed', ?, ?)`,
      )
      .run(id, this.householdId, name, now, now);
    return id;
  }

  private recordObject(
    roomId: string,
    frameId: number,
    observedAt: string,
    label: string,
    confidence: number,
    x: number,
    y: number,
    viewpointKey: string,
    mapEstimate: MapEstimate | null,
  ): RecordedObject {
    const normalizedLabel = label.trim().toLocaleLowerCase('fr-FR');
    const spatialKey = mapEstimate
      ? `map:${Math.round(mapEstimate.x / 0.5).toString()}:${Math.round(mapEstimate.y / 0.5).toString()}`
      : `${quantizeNormalized(x, 3)}:${quantizeNormalized(y, 3)}`;
    const existing = (
      mapEstimate
        ? this.database
            .prepare(
              `SELECT id, confidence, sighting_count, status,
                    viewpoint_keys_json, map_x, map_y
               FROM robot_memory_entities
              WHERE household_id = ? AND room_id = ? AND kind = 'object'
                AND class_label = ? AND map_x IS NOT NULL AND map_y IS NOT NULL
                AND ((map_x - ?) * (map_x - ?) + (map_y - ?) * (map_y - ?)) <= 0.64
              ORDER BY ((map_x - ?) * (map_x - ?) + (map_y - ?) * (map_y - ?))
              LIMIT 1`,
            )
            .get(
              this.householdId,
              roomId,
              normalizedLabel,
              mapEstimate.x,
              mapEstimate.x,
              mapEstimate.y,
              mapEstimate.y,
              mapEstimate.x,
              mapEstimate.x,
              mapEstimate.y,
              mapEstimate.y,
            )
        : this.database
            .prepare(
              `SELECT id, confidence, sighting_count, status,
                    viewpoint_keys_json, map_x, map_y
               FROM robot_memory_entities
              WHERE household_id = ? AND room_id = ? AND kind = 'object'
                AND class_label = ? AND spatial_key = ?`,
            )
            .get(this.householdId, roomId, normalizedLabel, spatialKey)
    ) as
      | {
          confidence: number;
          id: string;
          map_x: number | null;
          map_y: number | null;
          sighting_count: number;
          status: 'candidate' | 'confirmed' | 'uncertain';
          viewpoint_keys_json: string;
        }
      | undefined;
    const id = existing?.id ?? randomUUID();
    const count = (existing?.sighting_count ?? 0) + 1;
    const previousConfidence = existing?.confidence ?? confidence;
    const averageConfidence =
      (previousConfidence * (count - 1) + confidence) / count;
    const viewpoints = new Set<string>(
      existing ? (JSON.parse(existing.viewpoint_keys_json) as string[]) : [],
    );
    const newViewpoint = !viewpoints.has(viewpointKey);
    viewpoints.add(viewpointKey);
    const status =
      count >= 3 && viewpoints.size >= 2 && averageConfidence >= 0.8
        ? 'confirmed'
        : 'candidate';
    const now = new Date().toISOString();
    if (existing) {
      const mapX = mapEstimate
        ? ((existing.map_x ?? mapEstimate.x) * (count - 1) + mapEstimate.x) /
          count
        : existing.map_x;
      const mapY = mapEstimate
        ? ((existing.map_y ?? mapEstimate.y) * (count - 1) + mapEstimate.y) /
          count
        : existing.map_y;
      this.database
        .prepare(
          `UPDATE robot_memory_entities
              SET confidence = ?, status = ?, sighting_count = ?,
                  viewpoint_keys_json = ?, last_seen_at = ?, last_x = ?,
                  last_y = ?, map_x = ?, map_y = ?, map_uncertainty = ?,
                  updated_at = ? WHERE id = ?`,
        )
        .run(
          averageConfidence,
          status,
          count,
          JSON.stringify([...viewpoints]),
          observedAt,
          x,
          y,
          mapX,
          mapY,
          mapEstimate?.uncertainty ?? null,
          now,
          id,
        );
    } else {
      this.database
        .prepare(
          `INSERT INTO robot_memory_entities(
             id, household_id, room_id, kind, class_label, display_name,
             spatial_key, confidence, status, sighting_count,
             viewpoint_keys_json, first_seen_at, last_seen_at, last_x, last_y,
             map_x, map_y, map_uncertainty, updated_at
           ) VALUES (?, ?, ?, 'object', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.householdId,
          roomId,
          normalizedLabel,
          label.trim(),
          spatialKey,
          averageConfidence,
          status,
          count,
          JSON.stringify([...viewpoints]),
          observedAt,
          observedAt,
          x,
          y,
          mapEstimate?.x ?? null,
          mapEstimate?.y ?? null,
          mapEstimate?.uncertainty ?? null,
          now,
        );
    }
    this.database
      .prepare(
        `INSERT OR IGNORE INTO robot_memory_observations(
           id, household_id, entity_id, frame_id, kind, class_label,
           confidence, room_name, x, y, observed_at
         ) VALUES (?, ?, ?, ?, 'object', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        this.householdId,
        id,
        frameId,
        normalizedLabel,
        confidence,
        this.defaultRoomName,
        x,
        y,
        observedAt,
      );
    return {
      becameConfirmed:
        status === 'confirmed' && existing?.status !== 'confirmed',
      entityId: id,
      isConfirmed: status === 'confirmed',
      newViewpoint,
    };
  }

  private mappingPose(): {
    heading: number;
    uncertainty: number;
    x: number;
    y: number;
  } | null {
    const active = this.database
      .prepare(
        `SELECT r.x, r.y, r.heading, r.uncertainty
           FROM robot_map_runtime r
          WHERE r.household_id = ? AND EXISTS(
            SELECT 1 FROM robot_mapping_sessions s
             WHERE s.household_id = r.household_id AND s.status = 'recording'
          )`,
      )
      .get(this.householdId) as
      | { heading: number; uncertainty: number; x: number; y: number }
      | undefined;
    return active ?? null;
  }

  private persistRelevantKeyframe(
    state: RobotState,
    keyframe: RobotVisionKeyframe | null,
    objects: RecordedObject[],
  ): void {
    const frame = state.vision;
    if (
      !frame ||
      !keyframe ||
      keyframe.frameId !== frame.frameId ||
      keyframe.image.byteLength > MAX_KEYFRAME_BYTES ||
      keyframe.image[0] !== 0xff ||
      keyframe.image[1] !== 0xd8 ||
      frame.detections.some((detection) => detection.kind === 'person')
    )
      return;
    const useful = objects.filter(
      (object) =>
        object.becameConfirmed || (object.isConfirmed && object.newViewpoint),
    );
    if (useful.length === 0) return;
    const active = this.database
      .prepare(
        `SELECT id FROM robot_mapping_sessions
          WHERE household_id = ? AND status = 'recording'
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(this.householdId) as { id: string } | undefined;
    if (!active) return;
    const usage = this.database
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(length(image_jpeg)), 0) AS bytes,
                MAX(observed_at) AS latest
           FROM robot_memory_keyframes WHERE household_id = ?`,
      )
      .get(this.householdId) as {
      bytes: number;
      count: number;
      latest: string | null;
    };
    if (
      usage.count >= MAX_KEYFRAMES ||
      usage.bytes + keyframe.image.byteLength > KEYFRAME_QUOTA_BYTES ||
      (usage.latest !== null &&
        Date.parse(frame.observedAt) - Date.parse(usage.latest) <
          KEYFRAME_COOLDOWN_MS)
    )
      return;
    const eligibleObjects = useful.filter((object) => {
      const count = (
        this.database
          .prepare(
            `SELECT COUNT(*) AS count
               FROM robot_memory_keyframe_entities ke
               JOIN robot_memory_keyframes k ON k.id = ke.keyframe_id
              WHERE k.household_id = ? AND ke.entity_id = ?`,
          )
          .get(this.householdId, object.entityId) as { count: number }
      ).count;
      return count < MAX_KEYFRAMES_PER_ENTITY;
    });
    if (eligibleObjects.length === 0) return;
    const runtime = this.database
      .prepare(
        `SELECT x, y, heading FROM robot_map_runtime WHERE household_id = ?`,
      )
      .get(this.householdId) as { heading: number; x: number; y: number };
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO robot_memory_keyframes(
           id, household_id, frame_id, image_jpeg, image_width, image_height,
           pan, tilt, map_x, map_y, map_heading, reason, observed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.householdId,
        frame.frameId,
        keyframe.image,
        frame.imageWidth,
        frame.imageHeight,
        state.cameraPose.pan,
        state.cameraPose.tilt,
        runtime.x,
        runtime.y,
        runtime.heading,
        eligibleObjects.some((object) => object.becameConfirmed)
          ? 'confirmed_object'
          : 'new_viewpoint',
        frame.observedAt,
        new Date().toISOString(),
      );
    const link = this.database.prepare(
      `INSERT OR IGNORE INTO robot_memory_keyframe_entities(keyframe_id, entity_id)
       VALUES (?, ?)`,
    );
    for (const object of eligibleObjects) link.run(id, object.entityId);
    this.database
      .prepare(
        `UPDATE robot_memory_observations SET keyframe_id = ?
          WHERE household_id = ? AND frame_id = ? AND kind = 'object'`,
      )
      .run(id, this.householdId, frame.frameId);
  }

  private recordPresence(
    observedAt: string,
    confidence: number,
    x: number,
    y: number,
    frameId: number,
  ): void {
    const latest = this.database
      .prepare(
        `SELECT id, last_seen_at, confidence FROM robot_presence_events
          WHERE household_id = ? AND room_name = ?
          ORDER BY last_seen_at DESC LIMIT 1`,
      )
      .get(this.householdId, this.defaultRoomName) as
      { confidence: number; id: string; last_seen_at: string } | undefined;
    if (
      latest &&
      Date.parse(observedAt) - Date.parse(latest.last_seen_at) <= 30_000
    ) {
      this.database
        .prepare(
          'UPDATE robot_presence_events SET last_seen_at = ?, confidence = ? WHERE id = ?',
        )
        .run(observedAt, Math.max(latest.confidence, confidence), latest.id);
    } else {
      this.database
        .prepare(
          `INSERT INTO robot_presence_events(
             id, household_id, room_name, confidence, first_seen_at, last_seen_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          this.householdId,
          this.defaultRoomName,
          confidence,
          observedAt,
          observedAt,
        );
    }
    this.database
      .prepare(
        `INSERT OR IGNORE INTO robot_memory_observations(
           id, household_id, frame_id, kind, class_label, confidence,
           room_name, x, y, observed_at
         ) VALUES (?, ?, ?, 'person', 'personne', ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        this.householdId,
        frameId,
        confidence,
        this.defaultRoomName,
        x,
        y,
        observedAt,
      );
  }
}

function quantizeSigned(value: number, buckets: number): number {
  return quantizeNormalized((value + 1) / 2, buckets);
}

function estimateObjectPosition(
  pose: { heading: number; uncertainty: number; x: number; y: number },
  pan: number,
  imageX: number,
  imageY: number,
): MapEstimate {
  const cameraHeading = pose.heading + pan * (Math.PI / 2);
  const angle = cameraHeading + (imageX - 0.5) * 1.05;
  const distance = 0.5 + (1 - imageY) * 1.2;
  return {
    x: pose.x + Math.cos(angle) * distance,
    y: pose.y + Math.sin(angle) * distance,
    uncertainty: Math.min(100, pose.uncertainty + 1),
  };
}

function quantizeNormalized(value: number, buckets: number): number {
  return Math.max(0, Math.min(buckets - 1, Math.floor(value * buckets)));
}

function learningModeStatus(
  mode:
    | 'candidate'
    | 'forbidden'
    | 'regressed'
    | 'shadow'
    | 'validated'
    | undefined,
): RobotMemorySummary['learning']['policyStatus'] {
  if (!mode || mode === 'shadow') return 'insufficient_data';
  return mode;
}
