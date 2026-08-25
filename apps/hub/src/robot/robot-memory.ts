import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import {
  RobotMemorySummarySchema,
  type RobotMemorySummary,
  type RobotState,
} from '@friday/contracts';

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

export class RobotMemoryService {
  #lastFrameId = -1;

  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly defaultRoomName = 'Salon',
  ) {}

  observe(state: RobotState): void {
    const frame = state.vision;
    if (!frame || frame.frameId === this.#lastFrameId) return;
    if (Date.parse(frame.expiresAt) <= Date.now()) return;
    this.#lastFrameId = frame.frameId;
    const roomId = this.ensureRoom(this.defaultRoomName);
    const viewpointKey = `${quantizeSigned(state.cameraPose.pan, 4)}:${quantizeSigned(state.cameraPose.tilt, 4)}`;

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
        this.recordObject(
          roomId,
          frame.frameId,
          frame.observedAt,
          detection.label,
          detection.confidence,
          detection.x + detection.width / 2,
          detection.y + detection.height / 2,
          viewpointKey,
        );
      }
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
  ): void {
    const normalizedLabel = label.trim().toLocaleLowerCase('fr-FR');
    const spatialKey = `${quantizeNormalized(x, 3)}:${quantizeNormalized(y, 3)}`;
    const existing = this.database
      .prepare(
        `SELECT id, confidence, sighting_count, viewpoint_keys_json
           FROM robot_memory_entities
          WHERE household_id = ? AND room_id = ? AND kind = 'object'
            AND class_label = ? AND spatial_key = ?`,
      )
      .get(this.householdId, roomId, normalizedLabel, spatialKey) as
      | {
          confidence: number;
          id: string;
          sighting_count: number;
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
    viewpoints.add(viewpointKey);
    const status =
      count >= 3 && viewpoints.size >= 2 && averageConfidence >= 0.8
        ? 'confirmed'
        : 'candidate';
    const now = new Date().toISOString();
    if (existing) {
      this.database
        .prepare(
          `UPDATE robot_memory_entities
              SET confidence = ?, status = ?, sighting_count = ?,
                  viewpoint_keys_json = ?, last_seen_at = ?, last_x = ?,
                  last_y = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          averageConfidence,
          status,
          count,
          JSON.stringify([...viewpoints]),
          observedAt,
          x,
          y,
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
             updated_at
           ) VALUES (?, ?, ?, 'object', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.householdId,
          roomId,
          normalizedLabel,
          `${label.trim()} ${spatialKey.replace(':', '-')}`,
          spatialKey,
          averageConfidence,
          status,
          count,
          JSON.stringify([...viewpoints]),
          observedAt,
          observedAt,
          x,
          y,
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
