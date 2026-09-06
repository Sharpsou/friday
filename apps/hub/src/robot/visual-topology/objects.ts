import { type RobotState } from '@friday/contracts';
import type Database from 'better-sqlite3';
import {
  MAX_OBJECTS,
  OBJECT_HEARTBEAT_MS,
  OBJECT_REAPPEAR_GAP_MS,
} from './policy.js';
import type { VisualObservationState } from './state.js';
export class VisualObjectTracker {
  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly state: VisualObservationState,
  ) {}
  persistObjects(
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
        this.state.objectPresence.set(key, {
          lastPersistedAt: nowMs,
          lastSeenAt: nowMs,
        });
        continue;
      }

      const storedAt = Date.parse(row.last_seen_at);
      const presence = this.state.objectPresence.get(key) ?? {
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
      this.state.objectPresence.set(key, {
        lastPersistedAt: shouldPersist ? nowMs : presence.lastPersistedAt,
        lastSeenAt: nowMs,
      });
    }
  }
}
