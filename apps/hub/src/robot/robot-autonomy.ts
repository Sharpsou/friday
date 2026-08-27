import type Database from 'better-sqlite3';

import {
  RobotAutonomyStatusSchema,
  type RobotAutonomyAction,
  type RobotAutonomyStatus,
  type RobotCameraLookRequest,
  type RobotDirection,
  type RobotDriveRequest,
  type RobotState,
} from '@friday/contracts';

import type { RobotController } from './robot-controller.js';
import {
  RobotHabitLearningService,
  type RobotHabitChoice,
  type RobotHabitContext,
} from './robot-habit-learning.js';
import { RobotPanoramaSurveyController } from './robot-panorama-survey.js';
import {
  RobotVisualTopologyService,
  type RobotVisualObservation,
} from './robot-visual-topology.js';

const LOOP_MS = 250;
const MOTION_REFRESH_MS = 100;
const MOTION_WATCHDOG_MS = 300;
const MOTION_SETTLE_MS = 700;
const MOTION_STABLE_FRAMES = 3;
const DARK_LIMIT_MS = 15_000;
const UNLOCALIZED_INITIAL_SETTLE_MS = 1_200;
const UNLOCALIZED_SETTLE_MS = 700;
const UNLOCALIZED_ANCHOR_SETTLE_MS = 2_500;
const UNLOCALIZED_SCAN_PULSES = 8;

export class RobotAutonomyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RecoveryCapture {
  commands: RobotDriveRequest[];
  situationKey: string;
  sourcePlaceId: string | null;
  startedAt: string;
}

interface RecoveryReplay {
  commands: RobotDriveRequest[];
  index: number;
}

interface GraphEvidence {
  confirmedPlaces: number;
  confirmedTransitions: number;
  resolvedPorts: number;
}

export class RobotAutonomyService {
  private runId: string | null = null;
  private routeTrialId: string | null = null;
  private routeSegmentPlaceId: string | null = null;
  private routeSegmentStartedAt = 0;
  private routePlacePath: string[] = [];
  private startedAt: string | null = null;
  private updatedAt = new Date().toISOString();
  private mode: RobotAutonomyStatus['status'] = 'inactive';
  private action: RobotAutonomyAction | null = null;
  private targetPlaceId: string | null = null;
  private allowCandidatePath = false;
  private powerPercent = 20;
  private steeringTrimPercent = 0;
  private panoramaPulseMs = 220;
  private reward: number | null = null;
  private reason: string | null = null;
  private confidence = 0;
  private habitConfidence = 0;
  private informationGain = 0;
  private imageUsable = false;
  private motionState: RobotVisualObservation['motionState'] = 'uncertain';
  private blockReason: RobotAutonomyStatus['blockReason'] = 'stabilizing';
  private learningStepCount = 0;
  private lastUsableImageAt = Date.now();
  private lastOutcome: RobotHabitContext['previousOutcome'] = 'none';
  private lastEvidence: GraphEvidence = {
    confirmedPlaces: 0,
    confirmedTransitions: 0,
    resolvedPorts: 0,
  };
  private previousChoice: RobotHabitChoice | null = null;
  private previousChoiceAt = 0;
  private readonly recentActions: Array<{
    action: RobotAutonomyAction;
    at: number;
  }> = [];
  private timer: NodeJS.Timeout | null = null;
  private motionTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private refreshingMotion = false;
  private desiredDirection: RobotDirection | null = null;
  private desiredIntensity = 0.12;
  private pendingMotionBurstDurationMs = 0;
  private motionBurstEndsAt = 0;
  private stabilizationNotBefore = 0;
  private stabilizationFrameCount = 0;
  private unlocalizedNextPulseAt = 0;
  private unlocalizedPulseCount = 0;
  private unlocalizedStableFrameCount = 0;
  private recovery: RecoveryCapture | null = null;
  private replay: RecoveryReplay | null = null;
  private readonly habits: RobotHabitLearningService;
  private readonly panorama: RobotPanoramaSurveyController;

  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly robot: RobotController,
    private readonly topology: RobotVisualTopologyService,
    random: () => number = Math.random,
  ) {
    this.habits = new RobotHabitLearningService(database, householdId, random);
    this.panorama = new RobotPanoramaSurveyController(
      robot,
      topology,
      (direction, intensity, durationMs) =>
        this.driveCommand(direction, intensity, durationMs),
      (pan, tilt) => this.lookCommand(pan, tilt),
    );
  }

  status(): RobotAutonomyStatus {
    return RobotAutonomyStatusSchema.parse({
      status: this.mode,
      runId: this.runId,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      currentPlaceId: this.topology.snapshot().currentPlaceId,
      targetPlaceId: this.targetPlaceId,
      action: this.action,
      availableActions: this.action ? [this.action] : [],
      confidence: this.confidence,
      speedPercent: this.mode === 'inactive' ? 0 : this.powerPercent,
      reward: this.reward,
      reason: this.reason,
      learningStepCount: this.learningStepCount,
      imageUsable: this.imageUsable,
      motionState: this.motionState,
      blockReason: this.blockReason,
      informationGain: this.informationGain,
      localizationConfidence: this.confidence,
      habitConfidence: this.habitConfidence,
      humanRecovery: this.recovery
        ? {
            commandCount: this.recovery.commands.length,
            startedAt: this.recovery.startedAt,
          }
        : null,
    });
  }

  setPanoramaPulseDuration(durationMs: number): void {
    this.panoramaPulseMs = Math.max(
      120,
      Math.min(1_000, Math.round(durationMs)),
    );
    this.panorama.setPulseDuration(this.panoramaPulseMs);
  }

  setPowerPercent(powerPercent: number): RobotAutonomyStatus {
    this.powerPercent = Math.max(10, Math.min(35, Math.round(powerPercent)));
    this.panorama.setDriveIntensity(this.powerPercent / 100);
    if (this.action && this.desiredDirection)
      this.desiredIntensity = autonomousActionIntensity(
        this.action,
        this.powerPercent,
      );
    this.updatedAt = new Date().toISOString();
    return this.status();
  }

  async start(options: {
    allowCandidatePath?: boolean;
    panoramaPulseMs: number;
    powerPercent: number;
    steeringTrimPercent: number;
    targetPlaceId?: string;
  }): Promise<RobotState> {
    if (this.mode !== 'inactive')
      throw new RobotAutonomyError(
        'robot_autonomy_active',
        'Le mode autonome est déjà actif.',
      );
    const state = await this.robot.state();
    if (!state.available || !state.connected || !state.cameraAvailable)
      throw new RobotAutonomyError(
        'robot_autonomy_unavailable',
        'La caméra et le robot doivent être disponibles.',
      );
    if (!state.actuators.wheelsEnabled)
      throw new RobotAutonomyError(
        'robot_wheels_required',
        'Activez les roues avant le mode autonome.',
      );
    const graph = this.topology.snapshot();
    this.allowCandidatePath = options.allowCandidatePath === true;
    if (options.targetPlaceId) {
      if (!this.topology.hasConfirmedPlace(options.targetPlaceId))
        throw new RobotAutonomyError(
          'robot_target_unconfirmed',
          'La destination doit être un repère visuel confirmé.',
        );
      const path = graph.currentPlaceId
        ? this.allowCandidatePath
          ? this.topology.validationPath(
              graph.currentPlaceId,
              options.targetPlaceId,
            )
          : this.topology.confirmedPath(
              graph.currentPlaceId,
              options.targetPlaceId,
            )
        : null;
      if (!path)
        throw new RobotAutonomyError(
          'robot_target_unreachable',
          this.allowCandidatePath
            ? 'Le test exige deux ou trois passages candidats et des panoramas complets.'
            : 'Aucun enchaînement confirmé ne mène à ce lieu.',
        );
      this.routePlacePath = path;
    } else {
      this.routePlacePath = [];
    }
    this.runId = crypto.randomUUID();
    this.startedAt = new Date().toISOString();
    this.updatedAt = this.startedAt;
    this.mode = options.targetPlaceId ? 'navigating' : 'exploring';
    this.targetPlaceId = options.targetPlaceId ?? null;
    this.setPowerPercent(options.powerPercent);
    this.steeringTrimPercent = options.steeringTrimPercent;
    this.setPanoramaPulseDuration(options.panoramaPulseMs);
    this.reason = 'Localisation et stabilisation avant exploration.';
    this.blockReason = 'stabilizing';
    this.lastUsableImageAt = Date.now();
    this.lastEvidence = graphEvidence(graph);
    this.previousChoice = null;
    this.lastOutcome = 'none';
    this.recentActions.length = 0;
    this.habits.resetEpisode();
    this.routeSegmentPlaceId = graph.currentPlaceId;
    this.routeSegmentStartedAt = Date.now();
    this.unlocalizedNextPulseAt = Date.now() + UNLOCALIZED_INITIAL_SETTLE_MS;
    this.unlocalizedPulseCount = 0;
    this.unlocalizedStableFrameCount = 0;
    this.resetMotionCycle();
    if (this.allowCandidatePath && this.targetPlaceId)
      this.startRouteTrial(this.targetPlaceId);
    const autonomous = await this.robot.setMode('autonomous');
    this.startTimers();
    return autonomous;
  }

  async stop(reason = 'user_stop'): Promise<RobotState> {
    this.clearTimers();
    this.desiredDirection = null;
    await this.panorama.cancel();
    const state = await this.robot.stop();
    if (state.operatingMode !== 'manual') await this.robot.setMode('manual');
    if (this.routeTrialId)
      this.finishRouteTrial(
        reason === 'destination_visuelle_atteinte' ? 'succeeded' : 'cancelled',
        reason === 'destination_visuelle_atteinte' ? null : reason,
      );
    this.mode = 'inactive';
    this.runId = null;
    this.startedAt = null;
    this.targetPlaceId = null;
    this.action = null;
    this.reason = reason === 'user_stop' ? 'Arrêt demandé.' : reason;
    this.blockReason = null;
    this.recovery = null;
    this.replay = null;
    this.previousChoice = null;
    this.routePlacePath = [];
    this.unlocalizedNextPulseAt = 0;
    this.unlocalizedPulseCount = 0;
    this.unlocalizedStableFrameCount = 0;
    this.resetMotionCycle();
    this.habits.resetEpisode();
    this.updatedAt = new Date().toISOString();
    return this.robot.state();
  }

  async beginHumanRecovery(): Promise<RobotState> {
    if (!['blocked', 'exploring', 'navigating'].includes(this.mode))
      throw new RobotAutonomyError(
        'robot_recovery_unavailable',
        'Récup exige une autonomie active ou bloquée.',
      );
    this.clearTimers();
    this.desiredDirection = null;
    this.resetMotionCycle();
    this.unlocalizedStableFrameCount = 0;
    await this.panorama.cancel();
    await this.robot.stop();
    const state = await this.robot.setMode('manual');
    this.mode = 'recovering';
    this.action = null;
    this.recovery = {
      commands: [],
      situationKey: recoverySituationKey(state, this.motionState),
      sourcePlaceId: this.topology.snapshot().currentPlaceId,
      startedAt: new Date().toISOString(),
    };
    this.reason = 'Montrez une manœuvre courte, puis rendez la main.';
    this.updatedAt = new Date().toISOString();
    return state;
  }

  observeManualDrive(command: RobotDriveRequest, state: RobotState): void {
    this.topology.recordDriveCommand(command.direction);
    if (!this.recovery || state.operatingMode !== 'manual') return;
    if (this.recovery.commands.length >= 100) return;
    this.recovery.commands.push({ ...command });
    this.updatedAt = new Date().toISOString();
  }

  async finishHumanRecovery(): Promise<RobotState> {
    const capture = this.recovery;
    if (!capture)
      throw new RobotAutonomyError(
        'robot_recovery_unavailable',
        'Aucune démonstration Récup en cours.',
      );
    const state = await this.robot.state();
    const graph = this.topology.snapshot();
    const improved =
      capture.commands.length > 0 &&
      ((state.telemetry.irLeftClear !== false &&
        state.telemetry.irRightClear !== false) ||
        graph.currentPlaceId !== capture.sourcePlaceId);
    if (improved) this.persistRecovery(capture);
    this.recovery = null;
    this.mode = this.targetPlaceId ? 'navigating' : 'exploring';
    this.resetMotionCycle();
    this.unlocalizedNextPulseAt = Date.now() + UNLOCALIZED_INITIAL_SETTLE_MS;
    this.unlocalizedStableFrameCount = 0;
    this.reason = improved
      ? 'Manœuvre Récup validée dans ce contexte sensoriel.'
      : 'Démonstration ignorée : aucun progrès mesurable.';
    const autonomous = await this.robot.setMode('autonomous');
    this.startTimers();
    this.updatedAt = new Date().toISOString();
    return autonomous;
  }

  async close(): Promise<void> {
    if (this.mode !== 'inactive') await this.stop('hub_shutdown');
    await this.topology.close();
  }

  private async tick(): Promise<void> {
    if (this.ticking || !['exploring', 'navigating'].includes(this.mode))
      return;
    this.ticking = true;
    try {
      const state = await this.robot.state();
      const keyframe = state.vision
        ? (this.robot.visionKeyframe?.(state.vision.frameId) ?? null)
        : null;
      const observation = await this.topology.observe(state, keyframe);
      this.applyObservation(observation);
      if (this.targetPlaceId && observation.placeId) {
        if (this.routeSegmentPlaceId !== observation.placeId) {
          this.routeSegmentPlaceId = observation.placeId;
          this.routeSegmentStartedAt = Date.now();
        } else {
          const transition = this.nextRouteTransition();
          const expected = transition?.expectedDurationMs;
          if (
            expected &&
            Date.now() - this.routeSegmentStartedAt > expected * 2 + 5_000
          ) {
            await this.block(
              'Le passage dépasse sa durée visuelle attendue.',
              'route_mismatch',
            );
            return;
          }
        }
      }
      if (this.panorama.status().active) {
        this.action = 'inspect_anchor';
        this.blockReason = 'panorama';
        this.reason =
          'Panorama : rotation courte, arrêt puis trois images stables.';
        await this.panorama.tick(state, observation);
        return;
      }
      if (
        this.targetPlaceId &&
        observation.stable &&
        observation.placeId === this.targetPlaceId
      ) {
        await this.stop('destination_visuelle_atteinte');
        return;
      }
      if (Date.now() - this.lastUsableImageAt > DARK_LIMIT_MS) {
        await this.block(
          'Image inutilisable depuis 15 s : intervention manuelle demandée.',
          'image_unusable',
        );
        return;
      }
      if (!observation.imageUsable) {
        this.desiredDirection = null;
        if (this.pendingMotionBurstDurationMs > 0 || this.motionBurstEndsAt > 0)
          this.beginStabilization(
            'Image inexploitable : arrêt puis nouvelle stabilisation.',
          );
        await this.robot.stop();
        this.blockReason = 'stabilizing';
        this.reason = 'Attente déterministe d’une image exploitable.';
        return;
      }
      if (!this.motionCycleReady(observation)) return;
      if (!observation.placeId) {
        await this.exploreWithoutLocalization(state, observation);
        return;
      }
      this.unlocalizedNextPulseAt = 0;
      this.unlocalizedPulseCount = 0;
      this.unlocalizedStableFrameCount = 0;
      const actions = this.availableActions(state);
      if (actions.length === 0) {
        await this.block('Aucune action locale admissible.', 'ambiguous');
        return;
      }
      const choice = this.habits.choose(
        this.habitContext(state),
        actions,
        this.learningStepCount,
      );
      if (this.previousChoice) {
        this.habits.learn(this.previousChoice, this.reward ?? 0, choice, {
          durationMs: Math.max(0, Date.now() - this.previousChoiceAt),
          informationGain: this.informationGain,
          success: (this.reward ?? 0) > 0,
        });
      }
      this.previousChoice = choice;
      this.previousChoiceAt = Date.now();
      this.habitConfidence = choice.confidence;
      this.action = choice.action;
      await this.applyAction(choice.action, state, observation);
      this.recentActions.push({ action: choice.action, at: Date.now() });
      while (
        this.recentActions[0] &&
        this.recentActions[0].at < Date.now() - 8_000
      )
        this.recentActions.shift();
      this.learningStepCount += 1;
      this.updatedAt = new Date().toISOString();
    } catch (error) {
      await this.block(
        error instanceof Error ? error.message : 'Erreur autonome inconnue.',
        'route_mismatch',
      );
    } finally {
      this.ticking = false;
    }
  }

  private applyObservation(observation: RobotVisualObservation): void {
    this.imageUsable = observation.imageUsable;
    this.motionState = observation.motionState;
    this.confidence = observation.confidence;
    if (observation.imageUsable) this.lastUsableImageAt = Date.now();
    const evidence = graphEvidence(this.topology.snapshot());
    const placeGain =
      evidence.confirmedPlaces - this.lastEvidence.confirmedPlaces;
    const transitionGain =
      evidence.confirmedTransitions - this.lastEvidence.confirmedTransitions;
    const portGain = evidence.resolvedPorts - this.lastEvidence.resolvedPorts;
    this.informationGain = Math.max(
      -1,
      Math.min(
        1,
        placeGain + transitionGain + portGain + observation.informationGain,
      ),
    );
    this.reward =
      transitionGain > 0
        ? 3
        : placeGain > 0
          ? 4
          : portGain > 0
            ? 2
            : this.informationGain > 0
              ? 1
              : 0;
    if (this.isOscillating()) {
      this.reward = -2;
      this.blockReason = 'oscillation';
      this.lastOutcome = 'failure';
    } else if (this.reward > 0) {
      this.blockReason = null;
      this.lastOutcome = 'success';
    } else {
      this.lastOutcome = 'none';
    }
    this.lastEvidence = evidence;
  }

  private availableActions(state: RobotState): RobotAutonomyAction[] {
    const graph = this.topology.snapshot();
    const current = graph.places.find(
      (place) => place.id === graph.currentPlaceId,
    );
    if (!this.imageUsable) return [];
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
    if (this.findRecovery(recoverySituationKey(state, this.motionState)))
      actions.push('apply_recovery');
    if (this.targetPlaceId && graph.currentPlaceId) {
      const path = this.remainingRoutePath(graph.currentPlaceId);
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

  private nextRouteTransition() {
    if (!this.targetPlaceId) return null;
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

  private remainingRoutePath(currentPlaceId: string): string[] | null {
    if (this.allowCandidatePath) {
      const index = this.routePlacePath.indexOf(currentPlaceId);
      return index >= 0 ? this.routePlacePath.slice(index) : null;
    }
    return this.targetPlaceId
      ? this.topology.confirmedPath(currentPlaceId, this.targetPlaceId)
      : null;
  }

  private habitContext(state: RobotState): RobotHabitContext {
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
        this.informationGain > 0.1
          ? 'rising'
          : this.informationGain < 0
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
        this.confidence >= 0.75
          ? 'high'
          : this.confidence >= 0.45
            ? 'medium'
            : 'low',
      motion: this.motionState,
      panorama:
        !current || current.panoramaStatus === 'absent'
          ? 'missing'
          : current.panoramaStatus,
      ports: portCount === 0 ? 'none' : portCount === 1 ? 'one' : 'multiple',
      progress: this.isOscillating()
        ? 'oscillating'
        : this.motionState === 'translation'
          ? 'moving'
          : 'stalled',
      previousOutcome: this.lastOutcome,
    };
  }

  private async applyAction(
    action: RobotAutonomyAction,
    state: RobotState,
    observation: RobotVisualObservation,
  ): Promise<void> {
    if (action === 'inspect_anchor') {
      this.desiredDirection = null;
      const started =
        observation.motionState === 'stationary' &&
        (await this.panorama.start(state));
      this.blockReason = 'panorama';
      this.reason = started
        ? 'Panorama corporel démarré après stabilisation.'
        : 'Stabilisation avant le panorama corporel.';
      return;
    }
    if (action === 'apply_recovery') {
      await this.applyRecovery(state);
      return;
    }
    const direction = directionForAction(action, state);
    const intensity = autonomousActionIntensity(action, this.powerPercent);
    this.topology.recordDriveCommand(direction);
    this.desiredDirection = direction;
    this.desiredIntensity = intensity;
    this.pendingMotionBurstDurationMs = motionBurstDurationMs(
      action,
      this.powerPercent,
    );
    this.motionBurstEndsAt = 0;
    this.stabilizationNotBefore = 0;
    this.stabilizationFrameCount = 0;
    this.reason = `Habitude locale : ${action}.`;
    this.blockReason = null;
  }

  private async exploreWithoutLocalization(
    state: RobotState,
    observation: RobotVisualObservation,
  ): Promise<void> {
    this.desiredDirection = null;
    const now = Date.now();
    if (this.unlocalizedNextPulseAt === 0)
      this.unlocalizedNextPulseAt = now + UNLOCALIZED_INITIAL_SETTLE_MS;
    if (now < this.unlocalizedNextPulseAt) {
      this.unlocalizedStableFrameCount = 0;
      this.action = null;
      this.blockReason = 'stabilizing';
      this.reason = 'Observation stable avant un balayage de relocalisation.';
      return;
    }
    this.unlocalizedStableFrameCount = stabilizationFrameCount(
      this.unlocalizedStableFrameCount,
      observation,
    );
    if (this.unlocalizedStableFrameCount < MOTION_STABLE_FRAMES) {
      this.action = null;
      this.blockReason = 'stabilizing';
      this.reason = `Relocalisation stable ${this.unlocalizedStableFrameCount.toString()}/${MOTION_STABLE_FRAMES.toString()}.`;
      return;
    }
    this.unlocalizedStableFrameCount = 0;
    const direction = unlocalizedSearchDirection(
      state,
      this.unlocalizedPulseCount,
    );
    if (!direction) {
      await this.block('Les deux capteurs IR avant sont bloqués.', 'infrared');
      return;
    }
    const translating = direction === 'forward';
    // The unlocalized search is a single watchdog-bounded probe.  Longer
    // configured pulses are renewed only by the established panorama survey,
    // where visual closure can supervise the whole rotation.
    const durationMs = translating ? 300 : Math.min(500, this.panoramaPulseMs);
    this.topology.recordDriveCommand(direction);
    await this.robot.drive(
      this.driveCommand(direction, this.powerPercent / 100, durationMs),
    );
    this.action = actionForDirection(direction);
    this.blockReason = 'stabilizing';
    this.reason = translating
      ? 'Petit déplacement pour créer une preuve visuelle de translation.'
      : 'Balayage corporel pour retrouver un repère visuel.';
    this.unlocalizedPulseCount = translating
      ? 0
      : this.unlocalizedPulseCount + 1;
    this.unlocalizedNextPulseAt =
      now +
      durationMs +
      (translating ? UNLOCALIZED_ANCHOR_SETTLE_MS : UNLOCALIZED_SETTLE_MS);
    this.updatedAt = new Date().toISOString();
  }

  private persistRecovery(capture: RecoveryCapture): void {
    const now = new Date().toISOString();
    const commands = capture.commands.map((command) => ({
      direction: command.direction,
      intensity: Math.min(0.2, command.intensity),
      steering: command.steering,
      maxDurationMs: Math.min(140, command.maxDurationMs),
    }));
    this.database
      .prepare(
        `INSERT INTO robot_recovery_skills(
           id, household_id, situation_key, commands_json, command_count,
           success_count, failure_count, confidence, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, 0, 0.6, ?, ?)
         ON CONFLICT(household_id, situation_key)
         DO UPDATE SET commands_json = excluded.commands_json,
                       command_count = excluded.command_count,
                       success_count = success_count + 1,
                       confidence = MIN(1, confidence + 0.1),
                       updated_at = excluded.updated_at`,
      )
      .run(
        crypto.randomUUID(),
        this.householdId,
        capture.situationKey,
        JSON.stringify(commands),
        commands.length,
        now,
        now,
      );
  }

  private findRecovery(
    situationKey: string,
  ): { commands_json: string; id: string } | null {
    return (
      (this.database
        .prepare(
          `SELECT id, commands_json FROM robot_recovery_skills
            WHERE household_id = ? AND situation_key = ? AND confidence >= 0.6`,
        )
        .get(this.householdId, situationKey) as
        { commands_json: string; id: string } | undefined) ?? null
    );
  }

  private async applyRecovery(state: RobotState): Promise<void> {
    if (!this.replay) {
      const skill = this.findRecovery(
        recoverySituationKey(state, this.motionState),
      );
      if (!skill) return;
      const raw = JSON.parse(skill.commands_json) as Array<{
        direction: RobotDirection;
        intensity: number;
        maxDurationMs: number;
        steering: number;
      }>;
      this.replay = {
        commands: raw.map((command) => ({
          ...this.driveCommand(
            command.direction,
            Math.min(command.intensity, this.powerPercent / 100),
            command.maxDurationMs,
          ),
          steering: command.steering,
        })),
        index: 0,
      };
    }
    const command = this.replay.commands[this.replay.index];
    if (!command) {
      this.replay = null;
      return;
    }
    if (
      command.direction === 'forward' &&
      (state.telemetry.irLeftClear === false ||
        state.telemetry.irRightClear === false)
    ) {
      this.replay = null;
      return;
    }
    this.topology.recordDriveCommand(command.direction);
    await this.robot.drive(this.refreshCommand(command));
    this.replay.index += 1;
  }

  private driveCommand(
    direction: RobotDirection,
    intensity = this.desiredIntensity,
    maxDurationMs = MOTION_WATCHDOG_MS,
  ): RobotDriveRequest {
    return this.refreshCommand({
      commandId: crypto.randomUUID(),
      direction,
      expiresAt: new Date().toISOString(),
      intensity: Math.min(0.35, Math.max(0.1, intensity)),
      issuedAt: new Date().toISOString(),
      maxDurationMs,
      steering: direction === 'forward' ? this.steeringTrimPercent / 100 : 0,
    });
  }

  private refreshCommand(command: RobotDriveRequest): RobotDriveRequest {
    const now = Date.now();
    return {
      ...command,
      commandId: crypto.randomUUID(),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 1_800).toISOString(),
    };
  }

  private lookCommand(pan: number, tilt: number): RobotCameraLookRequest {
    const now = Date.now();
    return {
      commandId: crypto.randomUUID(),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 1_800).toISOString(),
      pan,
      tilt,
    };
  }

  private async block(
    reason: string,
    blockReason: NonNullable<RobotAutonomyStatus['blockReason']>,
  ): Promise<void> {
    this.clearTimers();
    this.desiredDirection = null;
    this.resetMotionCycle();
    await this.panorama.cancel();
    await this.robot.stop();
    this.mode = 'blocked';
    this.action = null;
    this.reward = blockReason === 'infrared' ? -4 : -2;
    this.reason = reason;
    this.blockReason = blockReason;
    this.lastOutcome = 'failure';
    if (this.routeTrialId) this.finishRouteTrial('failed', reason);
    this.updatedAt = new Date().toISOString();
  }

  private isOscillating(): boolean {
    const recent = this.recentActions.filter(
      (entry) => entry.at >= Date.now() - 8_000,
    );
    if (recent.length < 4 || this.informationGain > 0) return false;
    return (
      recent.filter((entry) =>
        ['pivot_left', 'pivot_right', 'try_alternate_port'].includes(
          entry.action,
        ),
      ).length >= 4
    );
  }

  private startRouteTrial(targetPlaceId: string): void {
    const id = crypto.randomUUID();
    this.routeTrialId = id;
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

  private finishRouteTrial(
    status: 'succeeded' | 'failed' | 'cancelled',
    reason: string | null,
  ): void {
    if (!this.routeTrialId) return;
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
        this.routeTrialId,
      );
    this.routeTrialId = null;
  }

  private startTimers(): void {
    this.clearTimers();
    this.timer = setInterval(() => void this.tick(), LOOP_MS);
    this.timer.unref();
    this.motionTimer = setInterval(
      () => void this.refreshMotion(),
      MOTION_REFRESH_MS,
    );
    this.motionTimer.unref();
  }

  private clearTimers(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.motionTimer) clearInterval(this.motionTimer);
    this.timer = null;
    this.motionTimer = null;
  }

  private async refreshMotion(): Promise<void> {
    if (
      this.refreshingMotion ||
      !this.desiredDirection ||
      !['exploring', 'navigating'].includes(this.mode) ||
      this.panorama.status().active
    )
      return;
    this.refreshingMotion = true;
    try {
      if (this.motionBurstEndsAt > 0 && Date.now() >= this.motionBurstEndsAt) {
        this.desiredDirection = null;
        this.beginStabilization(
          'Arrêt pour stabiliser et analyser trois images.',
        );
        await this.robot.stop();
        this.updatedAt = new Date().toISOString();
        return;
      }
      const state = await this.robot.state();
      const visionFresh =
        state.vision !== null &&
        Date.now() - Date.parse(state.vision.observedAt) <= 700;
      const blockedAhead =
        this.desiredDirection === 'forward' &&
        (state.telemetry.irLeftClear === false ||
          state.telemetry.irRightClear === false);
      if (!visionFresh || !this.imageUsable || blockedAhead) {
        this.desiredDirection = null;
        this.beginStabilization(
          blockedAhead
            ? 'Obstacle détecté : arrêt puis nouvelle observation stable.'
            : 'Vision indisponible : arrêt puis nouvelle observation stable.',
        );
        await this.robot.stop();
        if (blockedAhead) {
          this.reward = -4;
          this.blockReason = 'infrared';
          this.topology.markCurrentPortBlocked();
        }
        return;
      }
      this.topology.recordDriveCommand(this.desiredDirection);
      await this.robot.drive(this.driveCommand(this.desiredDirection));
      if (this.pendingMotionBurstDurationMs > 0) {
        this.motionBurstEndsAt = Date.now() + this.pendingMotionBurstDurationMs;
        this.pendingMotionBurstDurationMs = 0;
      }
    } catch (error) {
      await this.block(
        error instanceof Error
          ? `Navigation temps réel interrompue : ${error.message}`
          : 'Navigation temps réel interrompue.',
        'route_mismatch',
      );
    } finally {
      this.refreshingMotion = false;
    }
  }

  private motionCycleReady(observation: RobotVisualObservation): boolean {
    if (this.pendingMotionBurstDurationMs > 0 || this.motionBurstEndsAt > 0)
      return false;
    if (this.stabilizationNotBefore === 0) return true;
    const now = Date.now();
    if (now < this.stabilizationNotBefore) {
      this.stabilizationFrameCount = 0;
      this.action = null;
      this.blockReason = 'stabilizing';
      this.reason = 'Repos mécanique avant analyse visuelle.';
      return false;
    }
    this.stabilizationFrameCount = stabilizationFrameCount(
      this.stabilizationFrameCount,
      observation,
    );
    if (this.stabilizationFrameCount < MOTION_STABLE_FRAMES) {
      this.action = null;
      this.blockReason = 'stabilizing';
      this.reason = `Analyse stable ${this.stabilizationFrameCount.toString()}/${MOTION_STABLE_FRAMES.toString()}.`;
      return false;
    }
    this.stabilizationNotBefore = 0;
    this.stabilizationFrameCount = 0;
    this.blockReason = null;
    return true;
  }

  private resetMotionCycle(): void {
    this.pendingMotionBurstDurationMs = 0;
    this.motionBurstEndsAt = 0;
    this.stabilizationNotBefore = 0;
    this.stabilizationFrameCount = 0;
  }

  private beginStabilization(reason: string): void {
    this.pendingMotionBurstDurationMs = 0;
    this.motionBurstEndsAt = 0;
    this.stabilizationNotBefore = Date.now() + MOTION_SETTLE_MS;
    this.stabilizationFrameCount = 0;
    this.action = null;
    this.blockReason = 'stabilizing';
    this.reason = reason;
  }
}

function graphEvidence(
  graph: ReturnType<RobotVisualTopologyService['snapshot']>,
): GraphEvidence {
  return {
    confirmedPlaces: graph.places.filter(
      (place) => place.status === 'confirmed',
    ).length,
    confirmedTransitions: graph.transitions.filter(
      (transition) => transition.status === 'confirmed',
    ).length,
    resolvedPorts: graph.ports.filter((port) =>
      ['passage_confirmed', 'dead_end_confirmed'].includes(port.status),
    ).length,
  };
}

export function actionForDirection(
  direction: RobotDirection | 'unknown',
): RobotAutonomyAction {
  if (direction === 'left') return 'pivot_left';
  if (direction === 'right') return 'pivot_right';
  if (direction === 'backward') return 'return_to_last_anchor';
  return 'advance_slow';
}

export function autonomousActionIntensity(
  _action: RobotAutonomyAction,
  powerPercent: number,
): number {
  return Math.max(10, Math.min(35, Math.round(powerPercent))) / 100;
}

export function motionBurstDurationMs(
  action: RobotAutonomyAction,
  powerPercent: number,
): number {
  const power = Math.max(10, Math.min(35, Math.round(powerPercent)));
  const durationAtTwentyPercent = action === 'advance_normal' ? 320 : 220;
  const minimum = action === 'advance_normal' ? 180 : 140;
  const maximum = action === 'advance_normal' ? 500 : 400;
  return Math.max(
    minimum,
    Math.min(maximum, Math.round((durationAtTwentyPercent * 20) / power)),
  );
}

export function stabilizationFrameCount(
  currentCount: number,
  observation: Pick<
    RobotVisualObservation,
    'imageUsable' | 'motionState' | 'stable'
  >,
): number {
  return observation.imageUsable &&
    observation.stable &&
    observation.motionState === 'stationary'
    ? currentCount + 1
    : 0;
}

export function unlocalizedSearchDirection(
  state: RobotState,
  completedScanPulses: number,
): Extract<RobotDirection, 'forward' | 'left' | 'right'> | null {
  const leftClear = state.telemetry.irLeftClear !== false;
  const rightClear = state.telemetry.irRightClear !== false;
  if (!leftClear && !rightClear) return null;
  if (!leftClear) return 'right';
  if (!rightClear) return 'left';
  return completedScanPulses >= UNLOCALIZED_SCAN_PULSES ? 'forward' : 'right';
}

function directionForAction(
  action: RobotAutonomyAction,
  state: RobotState,
): RobotDirection {
  if (action === 'pivot_left') return 'left';
  if (action === 'pivot_right') return 'right';
  if (action === 'return_to_last_anchor') return 'backward';
  if (action === 'try_alternate_port')
    return state.telemetry.irLeftClear === false ? 'right' : 'left';
  return 'forward';
}

function recoverySituationKey(
  state: RobotState,
  motion: RobotVisualObservation['motionState'],
): string {
  return [
    state.telemetry.irLeftClear === false ? 'left-blocked' : 'left-clear',
    state.telemetry.irRightClear === false ? 'right-blocked' : 'right-clear',
    motion,
  ].join('|');
}
