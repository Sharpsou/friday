import {
  type RobotVisualGraph,
  type RobotVisualMemoryPurgeScope,
} from '@friday/contracts';
import type Database from 'better-sqlite3';
import { RobotVisualTopologyError } from './errors.js';
import { selectMergedPlaceViews } from './policy.js';
import type {
  MergeViewRow,
  RobotVisualMemoryPurgeResult,
  RobotVisualObservation,
} from './records.js';
import type { VisualTopologyRepository } from './repository.js';
import type { VisualObservationState } from './state.js';
export class VisualGraphMutations {
  private snapshot(): RobotVisualGraph {
    return this.repository.snapshot(this.state.currentPlaceId);
  }
  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly state: VisualObservationState,
    private readonly pendingObservations: () => Promise<RobotVisualObservation>,
    private readonly repository: VisualTopologyRepository,
  ) {}
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
    this.state.pauseObservations();
    await this.pendingObservations().catch(() => undefined);
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

        this.repository.mergePlaceObjects(targetPlaceId, sourcePlaceId);
        this.repository.mergePlaceTransitions(targetPlaceId, sourcePlaceId);
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
        this.repository.deleteLearningForPlace(sourcePlaceId);
        this.database
          .prepare(
            'DELETE FROM robot_visual_places WHERE household_id = ? AND id = ?',
          )
          .run(this.householdId, sourcePlaceId);
      })();

      if (this.state.currentPlaceId === sourcePlaceId)
        this.state.currentPlaceId = targetPlaceId;
      this.state.resetRuntimeAfterGraphMutation(this.state.currentPlaceId);
      return this.snapshot();
    } finally {
      this.state.resumeObservationsAfter(700);
    }
  }
  async deletePlace(placeId: string): Promise<RobotVisualGraph> {
    this.state.pauseObservations();
    await this.pendingObservations().catch(() => undefined);
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
        this.repository.deleteLearningForPlace(placeId);
        this.database
          .prepare(
            'DELETE FROM robot_visual_places WHERE household_id = ? AND id = ?',
          )
          .run(this.householdId, placeId);
      })();
      if (this.state.currentPlaceId === placeId)
        this.state.currentPlaceId = null;
      this.state.resetRuntimeAfterGraphMutation(this.state.currentPlaceId);
      return this.snapshot();
    } finally {
      this.state.resumeObservationsAfter(700);
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
    this.state.objectPresence.delete(`${row.place_id}\u0000${row.class_label}`);
    return this.snapshot();
  }
  async purge(
    scope: RobotVisualMemoryPurgeScope,
  ): Promise<RobotVisualMemoryPurgeResult> {
    this.state.pauseObservations();
    await this.pendingObservations().catch(() => undefined);
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

      this.state.currentPlaceId = null;
      this.state.lastFrameId = null;
      this.state.novelPlace = null;
      this.state.matchBelief = null;
      this.state.traversal = null;
      this.state.lastImage = null;
      this.state.objectPresence.clear();
      this.state.lastVisibleObjectLabels.clear();
      this.state.panoramaSession = null;
      this.state.latestObservation = {
        confidence: 0,
        imageUsable: false,
        placeId: null,
        stable: false,
        motionState: 'uncertain',
        informationGain: 0,
      };
      return { ...counts, graph: this.snapshot() };
    } finally {
      this.state.resumeObservationsAfter(700);
    }
  }
}
