import { type RobotAutonomyAction, type RobotState } from '@friday/contracts';
import { type RobotHabitContext } from '../robot-habit-learning.js';
import type { RobotVisualTopologyService } from '../robot-visual-topology.js';
import { type RobotVisualObservation } from '../robot-visual-topology.js';
import {
  actionForDirection,
  graphEvidence,
  recoverySituationKey,
} from './policy.js';
import type { AutonomyRecovery } from './recovery.js';
import type { AutonomyRoutes } from './routes.js';
import type { AutonomyState } from './state.js';
export class AutonomyDecisions {
  constructor(
    private readonly state: AutonomyState,
    private readonly topology: RobotVisualTopologyService,
    private readonly recovery: AutonomyRecovery,
    private readonly routes: AutonomyRoutes,
  ) {}
  applyObservation(observation: RobotVisualObservation): void {
    this.state.imageUsable = observation.imageUsable;
    this.state.motionState = observation.motionState;
    this.state.confidence = observation.confidence;
    if (observation.imageUsable) this.state.lastUsableImageAt = Date.now();
    const evidence = graphEvidence(this.topology.snapshot());
    const placeGain =
      evidence.confirmedPlaces - this.state.lastEvidence.confirmedPlaces;
    const transitionGain =
      evidence.confirmedTransitions -
      this.state.lastEvidence.confirmedTransitions;
    const portGain =
      evidence.resolvedPorts - this.state.lastEvidence.resolvedPorts;
    this.state.informationGain = Math.max(
      -1,
      Math.min(
        1,
        placeGain + transitionGain + portGain + observation.informationGain,
      ),
    );
    this.state.reward =
      transitionGain > 0
        ? 3
        : placeGain > 0
          ? 4
          : portGain > 0
            ? 2
            : this.state.informationGain > 0
              ? 1
              : 0;
    if (this.isOscillating()) {
      this.state.reward = -2;
      this.state.blockReason = 'oscillation';
      this.state.lastOutcome = 'failure';
    } else if (this.state.reward > 0) {
      this.state.blockReason = null;
      this.state.lastOutcome = 'success';
    } else {
      this.state.lastOutcome = 'none';
    }
    this.state.lastEvidence = evidence;
  }
  availableActions(state: RobotState): RobotAutonomyAction[] {
    const graph = this.topology.snapshot();
    const current = graph.places.find(
      (place) => place.id === graph.currentPlaceId,
    );
    if (!this.state.imageUsable) return [];
    if (current && current.panoramaStatus !== 'complete')
      return ['inspect_anchor'];
    const leftBlocked = state.telemetry.irLeftClear === false;
    const rightBlocked = state.telemetry.irRightClear === false;
    const actions: RobotAutonomyAction[] = [];
    if (!leftBlocked && !rightBlocked)
      actions.push(
        'advance_slow',
        'advance_normal',
        'pivot_left',
        'pivot_right',
      );
    else if (leftBlocked && !rightBlocked)
      actions.push('pivot_right', 'try_alternate_port');
    else if (!leftBlocked && rightBlocked)
      actions.push('pivot_left', 'try_alternate_port');
    else actions.push('try_alternate_port');
    if (
      graph.currentPlaceId &&
      this.topology.hasConfirmedArrival(graph.currentPlaceId)
    )
      actions.push('return_to_last_anchor');
    if (
      this.recovery.findRecovery(
        recoverySituationKey(state, this.state.motionState),
      )
    )
      actions.push('apply_recovery');
    if (this.state.targetPlaceId && graph.currentPlaceId) {
      const path = this.routes.remainingRoutePath(graph.currentPlaceId);
      const next = path?.[1];
      if (next) {
        const transition = graph.transitions.find(
          (item) =>
            item.fromPlaceId === graph.currentPlaceId &&
            item.toPlaceId === next,
        );
        if (transition) return [actionForDirection(transition.direction)];
      }
    }
    return [...new Set(actions)];
  }
  habitContext(state: RobotState): RobotHabitContext {
    const graph = this.topology.snapshot();
    const current = graph.places.find(
      (place) => place.id === graph.currentPlaceId,
    );
    const portCount = graph.ports.filter(
      (port) =>
        port.placeId === graph.currentPlaceId &&
        !['dead_end_confirmed', 'temporarily_blocked'].includes(port.status),
    ).length;
    const leftBlocked = state.telemetry.irLeftClear === false;
    const rightBlocked = state.telemetry.irRightClear === false;
    return {
      arrival:
        graph.currentPlaceId &&
        this.topology.hasConfirmedArrival(graph.currentPlaceId)
          ? 'known'
          : 'unknown',
      informationTrend:
        this.state.informationGain > 0.1
          ? 'rising'
          : this.state.informationGain < 0
            ? 'falling'
            : 'stable',
      infrared:
        leftBlocked && rightBlocked
          ? 'both'
          : leftBlocked
            ? 'left'
            : rightBlocked
              ? 'right'
              : 'clear',
      localization:
        this.state.confidence >= 0.75
          ? 'high'
          : this.state.confidence >= 0.45
            ? 'medium'
            : 'low',
      motion: this.state.motionState,
      panorama:
        !current || current.panoramaStatus === 'absent'
          ? 'missing'
          : current.panoramaStatus,
      ports: portCount === 0 ? 'none' : portCount === 1 ? 'one' : 'multiple',
      progress: this.isOscillating()
        ? 'oscillating'
        : this.state.motionState === 'translation'
          ? 'moving'
          : 'stalled',
      previousOutcome: this.state.lastOutcome,
    };
  }
  isOscillating(): boolean {
    const recent = this.state.recentActions.filter(
      (entry) => entry.at >= Date.now() - 8_000,
    );
    if (recent.length < 4 || this.state.informationGain > 0) return false;
    return (
      recent.filter((entry) =>
        ['pivot_left', 'pivot_right', 'try_alternate_port'].includes(
          entry.action,
        ),
      ).length >= 4
    );
  }
}
