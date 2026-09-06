import { type RobotState } from '@friday/contracts';
import type Database from 'better-sqlite3';
import type { RobotVisionKeyframe } from '../robot-controller.js';
import type { RobotPlaceSignatureFeatures } from '../robot-place-recognition.js';
import type { VisualObjectTracker } from './objects.js';
import { dominantDirection, inverseDirection, MAX_PLACES } from './policy.js';
import type { VisualTopologyRepository } from './repository.js';
import type { VisualObservationState } from './state.js';
export class VisualTransitions {
  constructor(
    private readonly state: VisualObservationState,
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly repository: VisualTopologyRepository,
    private readonly objects: VisualObjectTracker,
  ) {}
  rankBySequence<T extends { placeId: string; score: number }>(matches: T[]) {
    const neighborIds = new Set<string>();
    if (this.state.currentPlaceId) {
      const rows = this.database
        .prepare(
          `SELECT to_place_id FROM robot_visual_transitions
            WHERE household_id = ? AND from_place_id = ?`,
        )
        .all(this.householdId, this.state.currentPlaceId) as Array<{
        to_place_id: string;
      }>;
      rows.forEach((row) => neighborIds.add(row.to_place_id));
    }
    return matches
      .map((match) => ({
        ...match,
        rank:
          match.score +
          (match.placeId === this.state.currentPlaceId ? 0.12 : 0) +
          (neighborIds.has(match.placeId) ? 0.08 : 0),
      }))
      .sort((a, b) => b.rank - a.rank);
  }
  createPlace(
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
        this.state.currentPlaceId ??
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
      this.state.currentPlaceId = fallback;
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
    this.repository.persistView(id, state, keyframe, features, containsPerson);
    this.objects.persistObjects(id, state);
    this.enterPlace(id, 0.45, keyframe.observedAt);
    return id;
  }
  enterPlace(placeId: string, confidence: number, observedAt: string): void {
    const previous = this.state.currentPlaceId;
    this.state.currentPlaceId = placeId;
    this.state.unlocalizedTranslationScore = 0;
    const traversal = this.state.traversal;
    if (
      previous === placeId &&
      traversal?.fromPlaceId === placeId &&
      traversal.translationScore >= 6
    ) {
      const sectorId = this.repository.canonicalSectorId(placeId);
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
      this.state.traversal = null;
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
    const fromSector = this.repository.canonicalSectorId(previous);
    const toSector = this.repository.canonicalSectorId(placeId);
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
    this.state.traversal = null;
  }
}
