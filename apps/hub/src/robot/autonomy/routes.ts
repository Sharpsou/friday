import type Database from 'better-sqlite3';
import type { RobotVisualTopologyService } from '../robot-visual-topology.js';
import type { AutonomyState } from './state.js';
export class AutonomyRoutes {
  constructor(
    private readonly state: AutonomyState,
    private readonly topology: RobotVisualTopologyService,
    private readonly database: Database.Database,
    private readonly householdId: string,
  ) {}
  nextRouteTransition() {
    if (!this.state.targetPlaceId) return null;
    const graph = this.topology.snapshot();
    if (!graph.currentPlaceId) return null;
    const path = this.remainingRoutePath(graph.currentPlaceId);
    const next = path?.[1];
    return next
      ? (graph.transitions.find(
          (item) =>
            item.fromPlaceId === graph.currentPlaceId &&
            item.toPlaceId === next,
        ) ?? null)
      : null;
  }
  remainingRoutePath(currentPlaceId: string): string[] | null {
    if (this.state.allowCandidatePath) {
      const index = this.state.routePlacePath.indexOf(currentPlaceId);
      return index >= 0 ? this.state.routePlacePath.slice(index) : null;
    }
    return this.state.targetPlaceId
      ? this.topology.confirmedPath(currentPlaceId, this.state.targetPlaceId)
      : null;
  }
  startRouteTrial(targetPlaceId: string): void {
    const id = crypto.randomUUID();
    this.state.routeTrialId = id;
    const current = this.topology.snapshot().currentPlaceId;
    const path = current
      ? this.topology.validationPath(current, targetPlaceId)
      : null;
    const graph = this.topology.snapshot();
    const transitionIds = (path ?? [])
      .slice(0, -1)
      .flatMap((placeId, index) => {
        const transition = graph.transitions.find(
          (item) =>
            item.fromPlaceId === placeId &&
            item.toPlaceId === path?.[index + 1],
        );
        return transition ? [transition.id] : [];
      });
    this.database
      .prepare(
        `INSERT INTO robot_route_trials(
           id, household_id, target_place_id, status, transition_ids_json,
           failure_reason, started_at, ended_at
         ) VALUES (?, ?, ?, 'running', ?, NULL, ?, NULL)`,
      )
      .run(
        id,
        this.householdId,
        targetPlaceId,
        JSON.stringify(transitionIds),
        new Date().toISOString(),
      );
    this.database
      .prepare(
        `DELETE FROM robot_route_trials
          WHERE household_id = ? AND id NOT IN (
            SELECT id FROM robot_route_trials WHERE household_id = ?
             ORDER BY started_at DESC LIMIT 500
          )`,
      )
      .run(this.householdId, this.householdId);
  }
  finishRouteTrial(
    status: 'succeeded' | 'failed' | 'cancelled',
    reason: string | null,
  ): void {
    if (!this.state.routeTrialId) return;
    this.database
      .prepare(
        `UPDATE robot_route_trials SET status = ?, failure_reason = ?, ended_at = ?
          WHERE household_id = ? AND id = ?`,
      )
      .run(
        status,
        reason,
        new Date().toISOString(),
        this.householdId,
        this.state.routeTrialId,
      );
    this.state.routeTrialId = null;
  }
}
