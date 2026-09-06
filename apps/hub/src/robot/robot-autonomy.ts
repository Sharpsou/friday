import {
  RobotAutonomyStatusSchema,
  type RobotAutonomyAction,
  type RobotAutonomyStatus,
  type RobotDriveRequest,
  type RobotState,
} from '@friday/contracts';
import type Database from 'better-sqlite3';
import { AutonomyCommands } from './autonomy/commands.js';
import { AutonomyDecisions } from './autonomy/decisions.js';
import { AutonomyMotionCycle } from './autonomy/motion.js';
import {
  actionForDirection,
  autonomousActionIntensity,
  DARK_LIMIT_MS,
  directionForAction,
  graphEvidence,
  LOOP_MS,
  MOTION_REFRESH_MS,
  MOTION_STABLE_FRAMES,
  motionBurstDurationMs,
  recoverySituationKey,
  RobotAutonomyError,
  stabilizationFrameCount,
  UNLOCALIZED_ANCHOR_SETTLE_MS,
  UNLOCALIZED_INITIAL_SETTLE_MS,
  UNLOCALIZED_SETTLE_MS,
  unlocalizedSearchDirection,
} from './autonomy/policy.js';
import { AutonomyRecovery } from './autonomy/recovery.js';
import { AutonomyRoutes } from './autonomy/routes.js';
import { AutonomyState } from './autonomy/state.js';
import type { RobotController } from './robot-controller.js';
import { RobotHabitLearningService } from './robot-habit-learning.js';
import { RobotPanoramaSurveyController } from './robot-panorama-survey.js';
import type { RobotVisualTopologyService } from './robot-visual-topology.js';
import { type RobotVisualObservation } from './robot-visual-topology.js';
export {
  actionForDirection,
  autonomousActionIntensity,
  motionBurstDurationMs,
  RobotAutonomyError,
  stabilizationFrameCount,
  unlocalizedSearchDirection,
} from './autonomy/policy.js';
export class RobotAutonomyService {
  private timer: NodeJS.Timeout | null = null;
  private motionTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private refreshingMotion = false;
  private readonly habits: RobotHabitLearningService;
  private readonly panorama: RobotPanoramaSurveyController;
  private readonly state: AutonomyState;
  private readonly commands: AutonomyCommands;
  private readonly motion: AutonomyMotionCycle;
  private readonly routes: AutonomyRoutes;
  private readonly recovery: AutonomyRecovery;
  private readonly decisions: AutonomyDecisions;
  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly robot: RobotController,
    private readonly topology: RobotVisualTopologyService,
    random: () => number = Math.random,
  ) {
    this.state = new AutonomyState();
    this.commands = new AutonomyCommands(this.state);
    this.motion = new AutonomyMotionCycle(this.state);
    this.routes = new AutonomyRoutes(
      this.state,
      this.topology,
      this.database,
      this.householdId,
    );
    this.recovery = new AutonomyRecovery(
      this.database,
      this.householdId,
      this.state,
      this.commands,
      this.topology,
      this.robot,
    );
    this.decisions = new AutonomyDecisions(
      this.state,
      this.topology,
      this.recovery,
      this.routes,
    );

    this.habits = new RobotHabitLearningService(database, householdId, random);
    this.panorama = new RobotPanoramaSurveyController(
      robot,
      topology,
      (direction, intensity, durationMs) =>
        this.commands.driveCommand(direction, intensity, durationMs),
      (pan, tilt) => this.commands.lookCommand(pan, tilt),
    );
  }
  status(): RobotAutonomyStatus {
    return RobotAutonomyStatusSchema.parse({
      status: this.state.mode,
      runId: this.state.runId,
      startedAt: this.state.startedAt,
      updatedAt: this.state.updatedAt,
      currentPlaceId: this.topology.snapshot().currentPlaceId,
      targetPlaceId: this.state.targetPlaceId,
      action: this.state.action,
      availableActions: this.state.action ? [this.state.action] : [],
      confidence: this.state.confidence,
      speedPercent:
        this.state.mode === 'inactive' ? 0 : this.state.powerPercent,
      reward: this.state.reward,
      reason: this.state.reason,
      learningStepCount: this.state.learningStepCount,
      imageUsable: this.state.imageUsable,
      motionState: this.state.motionState,
      blockReason: this.state.blockReason,
      informationGain: this.state.informationGain,
      localizationConfidence: this.state.confidence,
      habitConfidence: this.state.habitConfidence,
      humanRecovery: this.state.recovery
        ? {
            commandCount: this.state.recovery.commands.length,
            startedAt: this.state.recovery.startedAt,
          }
        : null,
    });
  }
  setPanoramaPulseDuration(durationMs: number): void {
    this.state.panoramaPulseMs = Math.max(
      120,
      Math.min(1_000, Math.round(durationMs)),
    );
    this.panorama.setPulseDuration(this.state.panoramaPulseMs);
  }
  setPowerPercent(powerPercent: number): RobotAutonomyStatus {
    this.state.powerPercent = Math.max(
      10,
      Math.min(35, Math.round(powerPercent)),
    );
    this.panorama.setDriveIntensity(this.state.powerPercent / 100);
    if (this.state.action && this.state.desiredDirection)
      this.state.desiredIntensity = autonomousActionIntensity(
        this.state.action,
        this.state.powerPercent,
      );
    this.state.updatedAt = new Date().toISOString();
    return this.status();
  }
  async start(options: {
    allowCandidatePath?: boolean;
    panoramaPulseMs: number;
    powerPercent: number;
    steeringTrimPercent: number;
    targetPlaceId?: string;
  }): Promise<RobotState> {
    if (
      this.state.mode !== 'inactive' ||
      this.state.startingEpoch !== null ||
      this.state.stopping
    )
      throw new RobotAutonomyError(
        'robot_autonomy_active',
        'Le mode autonome est déjà actif.',
      );
    const epoch = ++this.state.controlEpoch;
    this.state.startingEpoch = epoch;
    try {
      const state = await this.robot.state();
      if (epoch !== this.state.controlEpoch) return this.robot.state();
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
      this.state.allowCandidatePath = options.allowCandidatePath === true;
      if (options.targetPlaceId) {
        if (!this.topology.hasConfirmedPlace(options.targetPlaceId))
          throw new RobotAutonomyError(
            'robot_target_unconfirmed',
            'La destination doit être un repère visuel confirmé.',
          );
        const path = graph.currentPlaceId
          ? this.state.allowCandidatePath
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
            this.state.allowCandidatePath
              ? 'Le test exige deux ou trois passages candidats et des panoramas complets.'
              : 'Aucun enchaînement confirmé ne mène à ce lieu.',
          );
        this.state.routePlacePath = path;
      } else {
        this.state.routePlacePath = [];
      }
      this.state.runId = crypto.randomUUID();
      this.state.startedAt = new Date().toISOString();
      this.state.updatedAt = this.state.startedAt;
      this.state.mode = options.targetPlaceId ? 'navigating' : 'exploring';
      this.state.targetPlaceId = options.targetPlaceId ?? null;
      this.setPowerPercent(options.powerPercent);
      this.state.steeringTrimPercent = options.steeringTrimPercent;
      this.setPanoramaPulseDuration(options.panoramaPulseMs);
      this.state.reason = 'Localisation et stabilisation avant exploration.';
      this.state.blockReason = 'stabilizing';
      this.state.lastUsableImageAt = Date.now();
      this.state.lastEvidence = graphEvidence(graph);
      this.state.previousChoice = null;
      this.state.lastOutcome = 'none';
      this.state.recentActions.length = 0;
      this.habits.resetEpisode();
      this.state.routeSegmentPlaceId = graph.currentPlaceId;
      this.state.routeSegmentStartedAt = Date.now();
      this.state.unlocalizedNextPulseAt =
        Date.now() + UNLOCALIZED_INITIAL_SETTLE_MS;
      this.state.unlocalizedPulseCount = 0;
      this.state.unlocalizedStableFrameCount = 0;
      this.motion.resetMotionCycle();
      if (this.state.allowCandidatePath && this.state.targetPlaceId)
        this.routes.startRouteTrial(this.state.targetPlaceId);
      const autonomous = await this.robot.setMode('autonomous');
      if (epoch !== this.state.controlEpoch) return this.robot.state();
      this.startTimers();
      return autonomous;
    } finally {
      if (this.state.startingEpoch === epoch) this.state.startingEpoch = null;
    }
  }
  async stop(reason = 'user_stop'): Promise<RobotState> {
    const epoch = ++this.state.controlEpoch;
    this.state.startingEpoch = null;
    this.state.stopping = true;
    try {
      this.clearTimers();
      this.state.desiredDirection = null;
      await this.panorama.cancel();
      if (epoch !== this.state.controlEpoch) return this.robot.state();
      const state = await this.robot.stop();
      if (epoch !== this.state.controlEpoch) return this.robot.state();
      if (state.operatingMode !== 'manual') await this.robot.setMode('manual');
      if (epoch !== this.state.controlEpoch) return this.robot.state();
      if (this.state.routeTrialId)
        this.routes.finishRouteTrial(
          reason === 'destination_visuelle_atteinte'
            ? 'succeeded'
            : 'cancelled',
          reason === 'destination_visuelle_atteinte' ? null : reason,
        );
      this.state.mode = 'inactive';
      this.state.runId = null;
      this.state.startedAt = null;
      this.state.targetPlaceId = null;
      this.state.action = null;
      this.state.reason = reason === 'user_stop' ? 'Arrêt demandé.' : reason;
      this.state.blockReason = null;
      this.state.recovery = null;
      this.state.replay = null;
      this.state.previousChoice = null;
      this.state.routePlacePath = [];
      this.state.unlocalizedNextPulseAt = 0;
      this.state.unlocalizedPulseCount = 0;
      this.state.unlocalizedStableFrameCount = 0;
      this.motion.resetMotionCycle();
      this.habits.resetEpisode();
      this.state.updatedAt = new Date().toISOString();
      return this.robot.state();
    } finally {
      if (epoch === this.state.controlEpoch) this.state.stopping = false;
    }
  }
  async beginHumanRecovery(): Promise<RobotState> {
    if (
      this.state.stopping ||
      !['blocked', 'exploring', 'navigating'].includes(this.state.mode)
    )
      throw new RobotAutonomyError(
        'robot_recovery_unavailable',
        'Récup exige une autonomie active ou bloquée.',
      );
    const epoch = ++this.state.controlEpoch;

    this.clearTimers();
    this.state.desiredDirection = null;
    this.motion.resetMotionCycle();
    this.state.unlocalizedStableFrameCount = 0;
    await this.panorama.cancel();
    if (epoch !== this.state.controlEpoch) return this.robot.state();
    await this.robot.stop();
    if (epoch !== this.state.controlEpoch) return this.robot.state();
    const state = await this.robot.setMode('manual');
    if (epoch !== this.state.controlEpoch) return this.robot.state();
    this.state.mode = 'recovering';
    this.state.action = null;
    this.state.recovery = {
      commands: [],
      situationKey: recoverySituationKey(state, this.state.motionState),
      sourcePlaceId: this.topology.snapshot().currentPlaceId,
      startedAt: new Date().toISOString(),
    };
    this.state.reason = 'Montrez une manœuvre courte, puis rendez la main.';
    this.state.updatedAt = new Date().toISOString();
    return state;
  }
  observeManualDrive(command: RobotDriveRequest, state: RobotState): void {
    this.topology.recordDriveCommand(command.direction);
    if (!this.state.recovery || state.operatingMode !== 'manual') return;
    if (this.state.recovery.commands.length >= 100) return;
    this.state.recovery.commands.push({ ...command });
    this.state.updatedAt = new Date().toISOString();
  }
  async finishHumanRecovery(): Promise<RobotState> {
    const epoch = this.state.controlEpoch;

    const capture = this.state.recovery;
    if (!capture)
      throw new RobotAutonomyError(
        'robot_recovery_unavailable',
        'Aucune démonstration Récup en cours.',
      );
    const state = await this.robot.state();
    if (epoch !== this.state.controlEpoch) return this.robot.state();
    const graph = this.topology.snapshot();
    const improved =
      capture.commands.length > 0 &&
      ((state.telemetry.irLeftClear !== false &&
        state.telemetry.irRightClear !== false) ||
        graph.currentPlaceId !== capture.sourcePlaceId);
    if (improved) this.recovery.persistRecovery(capture);
    this.state.recovery = null;
    this.state.mode = this.state.targetPlaceId ? 'navigating' : 'exploring';
    this.motion.resetMotionCycle();
    this.state.unlocalizedNextPulseAt =
      Date.now() + UNLOCALIZED_INITIAL_SETTLE_MS;
    this.state.unlocalizedStableFrameCount = 0;
    this.state.reason = improved
      ? 'Manœuvre Récup validée dans ce contexte sensoriel.'
      : 'Démonstration ignorée : aucun progrès mesurable.';
    const autonomous = await this.robot.setMode('autonomous');
    if (epoch !== this.state.controlEpoch) return this.robot.state();
    this.startTimers();
    this.state.updatedAt = new Date().toISOString();
    return autonomous;
  }
  async close(): Promise<void> {
    if (this.state.mode !== 'inactive' || this.state.startingEpoch !== null)
      await this.stop('hub_shutdown');
    await this.topology.close();
  }
  private async tick(): Promise<void> {
    const epoch = this.state.controlEpoch;

    if (this.ticking || !['exploring', 'navigating'].includes(this.state.mode))
      return;
    this.ticking = true;
    try {
      const state = await this.robot.state();
      if (epoch !== this.state.controlEpoch) return;
      const keyframe = state.vision
        ? (this.robot.visionKeyframe?.(state.vision.frameId) ?? null)
        : null;
      const observation = await this.topology.observe(state, keyframe);
      if (epoch !== this.state.controlEpoch) return;
      this.decisions.applyObservation(observation);
      if (this.state.targetPlaceId && observation.placeId) {
        if (this.state.routeSegmentPlaceId !== observation.placeId) {
          this.state.routeSegmentPlaceId = observation.placeId;
          this.state.routeSegmentStartedAt = Date.now();
        } else {
          const transition = this.routes.nextRouteTransition();
          const expected = transition?.expectedDurationMs;
          if (
            expected &&
            Date.now() - this.state.routeSegmentStartedAt > expected * 2 + 5_000
          ) {
            await this.block(
              'Le passage dépasse sa durée visuelle attendue.',
              'route_mismatch',
            );
            if (epoch !== this.state.controlEpoch) return;
            return;
          }
        }
      }
      if (this.panorama.status().active) {
        this.state.action = 'inspect_anchor';
        this.state.blockReason = 'panorama';
        this.state.reason =
          'Panorama : rotation courte, arrêt puis trois images stables.';
        await this.panorama.tick(state, observation);
        if (epoch !== this.state.controlEpoch) return;
        return;
      }
      if (
        this.state.targetPlaceId &&
        observation.stable &&
        observation.placeId === this.state.targetPlaceId
      ) {
        await this.stop('destination_visuelle_atteinte');
        if (epoch !== this.state.controlEpoch) return;
        return;
      }
      if (Date.now() - this.state.lastUsableImageAt > DARK_LIMIT_MS) {
        await this.block(
          'Image inutilisable depuis 15 s : intervention manuelle demandée.',
          'image_unusable',
        );
        if (epoch !== this.state.controlEpoch) return;
        return;
      }
      if (!observation.imageUsable) {
        this.state.desiredDirection = null;
        if (
          this.state.pendingMotionBurstDurationMs > 0 ||
          this.state.motionBurstEndsAt > 0
        )
          this.motion.beginStabilization(
            'Image inexploitable : arrêt puis nouvelle stabilisation.',
          );
        await this.robot.stop();
        if (epoch !== this.state.controlEpoch) return;
        this.state.blockReason = 'stabilizing';
        this.state.reason = 'Attente déterministe d’une image exploitable.';
        return;
      }
      if (!this.motion.motionCycleReady(observation)) return;
      if (!observation.placeId) {
        await this.exploreWithoutLocalization(state, observation);
        if (epoch !== this.state.controlEpoch) return;
        return;
      }
      this.state.unlocalizedNextPulseAt = 0;
      this.state.unlocalizedPulseCount = 0;
      this.state.unlocalizedStableFrameCount = 0;
      const actions = this.decisions.availableActions(state);
      if (actions.length === 0) {
        await this.block('Aucune action locale admissible.', 'ambiguous');
        if (epoch !== this.state.controlEpoch) return;
        return;
      }
      const choice = this.habits.choose(
        this.decisions.habitContext(state),
        actions,
        this.state.learningStepCount,
      );
      if (this.state.previousChoice) {
        this.habits.learn(
          this.state.previousChoice,
          this.state.reward ?? 0,
          choice,
          {
            durationMs: Math.max(0, Date.now() - this.state.previousChoiceAt),
            informationGain: this.state.informationGain,
            success: (this.state.reward ?? 0) > 0,
          },
        );
      }
      this.state.previousChoice = choice;
      this.state.previousChoiceAt = Date.now();
      this.state.habitConfidence = choice.confidence;
      this.state.action = choice.action;
      await this.applyAction(choice.action, state, observation);
      if (epoch !== this.state.controlEpoch) return;
      this.state.recentActions.push({ action: choice.action, at: Date.now() });
      while (
        this.state.recentActions[0] &&
        this.state.recentActions[0].at < Date.now() - 8_000
      )
        this.state.recentActions.shift();
      this.state.learningStepCount += 1;
      this.state.updatedAt = new Date().toISOString();
    } catch (error) {
      if (epoch !== this.state.controlEpoch) return;
      await this.block(
        error instanceof Error ? error.message : 'Erreur autonome inconnue.',
        'route_mismatch',
      );
      if (epoch !== this.state.controlEpoch) return;
    } finally {
      this.ticking = false;
    }
  }
  private async applyAction(
    action: RobotAutonomyAction,
    state: RobotState,
    observation: RobotVisualObservation,
  ): Promise<void> {
    const epoch = this.state.controlEpoch;

    if (action === 'inspect_anchor') {
      this.state.desiredDirection = null;
      const started =
        observation.motionState === 'stationary' &&
        (await this.panorama.start(state));
      if (epoch !== this.state.controlEpoch) return;
      this.state.blockReason = 'panorama';
      this.state.reason = started
        ? 'Panorama corporel démarré après stabilisation.'
        : 'Stabilisation avant le panorama corporel.';
      return;
    }
    if (action === 'apply_recovery') {
      await this.recovery.applyRecovery(state);
      if (epoch !== this.state.controlEpoch) return;
      return;
    }
    const direction = directionForAction(action, state);
    const intensity = autonomousActionIntensity(
      action,
      this.state.powerPercent,
    );
    this.topology.recordDriveCommand(direction);
    this.state.desiredDirection = direction;
    this.state.desiredIntensity = intensity;
    this.state.pendingMotionBurstDurationMs = motionBurstDurationMs(
      action,
      this.state.powerPercent,
    );
    this.state.motionBurstEndsAt = 0;
    this.state.stabilizationNotBefore = 0;
    this.state.stabilizationFrameCount = 0;
    this.state.reason = `Habitude locale : ${action}.`;
    this.state.blockReason = null;
  }
  private async exploreWithoutLocalization(
    state: RobotState,
    observation: RobotVisualObservation,
  ): Promise<void> {
    const epoch = this.state.controlEpoch;

    this.state.desiredDirection = null;
    const now = Date.now();
    if (this.state.unlocalizedNextPulseAt === 0)
      this.state.unlocalizedNextPulseAt = now + UNLOCALIZED_INITIAL_SETTLE_MS;
    if (now < this.state.unlocalizedNextPulseAt) {
      this.state.unlocalizedStableFrameCount = 0;
      this.state.action = null;
      this.state.blockReason = 'stabilizing';
      this.state.reason =
        'Observation stable avant un balayage de relocalisation.';
      return;
    }
    this.state.unlocalizedStableFrameCount = stabilizationFrameCount(
      this.state.unlocalizedStableFrameCount,
      observation,
    );
    if (this.state.unlocalizedStableFrameCount < MOTION_STABLE_FRAMES) {
      this.state.action = null;
      this.state.blockReason = 'stabilizing';
      this.state.reason = `Relocalisation stable ${this.state.unlocalizedStableFrameCount.toString()}/${MOTION_STABLE_FRAMES.toString()}.`;
      return;
    }
    this.state.unlocalizedStableFrameCount = 0;
    const direction = unlocalizedSearchDirection(
      state,
      this.state.unlocalizedPulseCount,
    );
    if (!direction) {
      await this.block('Les deux capteurs IR avant sont bloqués.', 'infrared');
      if (epoch !== this.state.controlEpoch) return;
      return;
    }
    const translating = direction === 'forward';
    // The unlocalized search is a single watchdog-bounded probe.  Longer
    // configured pulses are renewed only by the established panorama survey,
    // where visual closure can supervise the whole rotation.
    const durationMs = translating
      ? 300
      : Math.min(500, this.state.panoramaPulseMs);
    this.topology.recordDriveCommand(direction);
    await this.robot.drive(
      this.commands.driveCommand(
        direction,
        this.state.powerPercent / 100,
        durationMs,
      ),
    );
    if (epoch !== this.state.controlEpoch) return;
    this.state.action = actionForDirection(direction);
    this.state.blockReason = 'stabilizing';
    this.state.reason = translating
      ? 'Petit déplacement pour créer une preuve visuelle de translation.'
      : 'Balayage corporel pour retrouver un repère visuel.';
    this.state.unlocalizedPulseCount = translating
      ? 0
      : this.state.unlocalizedPulseCount + 1;
    this.state.unlocalizedNextPulseAt =
      now +
      durationMs +
      (translating ? UNLOCALIZED_ANCHOR_SETTLE_MS : UNLOCALIZED_SETTLE_MS);
    this.state.updatedAt = new Date().toISOString();
  }
  private async block(
    reason: string,
    blockReason: NonNullable<RobotAutonomyStatus['blockReason']>,
  ): Promise<void> {
    const epoch = ++this.state.controlEpoch;

    this.clearTimers();
    this.state.desiredDirection = null;
    this.motion.resetMotionCycle();
    await this.panorama.cancel();
    if (epoch !== this.state.controlEpoch) return;
    await this.robot.stop();
    if (epoch !== this.state.controlEpoch) return;
    this.state.mode = 'blocked';
    this.state.action = null;
    this.state.reward = blockReason === 'infrared' ? -4 : -2;
    this.state.reason = reason;
    this.state.blockReason = blockReason;
    this.state.lastOutcome = 'failure';
    if (this.state.routeTrialId) this.routes.finishRouteTrial('failed', reason);
    this.state.updatedAt = new Date().toISOString();
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
    const epoch = this.state.controlEpoch;

    if (
      this.refreshingMotion ||
      !this.state.desiredDirection ||
      !['exploring', 'navigating'].includes(this.state.mode) ||
      this.panorama.status().active
    )
      return;
    this.refreshingMotion = true;
    try {
      if (
        this.state.motionBurstEndsAt > 0 &&
        Date.now() >= this.state.motionBurstEndsAt
      ) {
        this.state.desiredDirection = null;
        this.motion.beginStabilization(
          'Arrêt pour stabiliser et analyser trois images.',
        );
        await this.robot.stop();
        if (epoch !== this.state.controlEpoch) return;
        this.state.updatedAt = new Date().toISOString();
        return;
      }
      const state = await this.robot.state();
      if (epoch !== this.state.controlEpoch) return;
      const visionFresh =
        state.vision !== null &&
        Date.now() - Date.parse(state.vision.observedAt) <= 700;
      const blockedAhead =
        this.state.desiredDirection === 'forward' &&
        (state.telemetry.irLeftClear === false ||
          state.telemetry.irRightClear === false);
      if (!visionFresh || !this.state.imageUsable || blockedAhead) {
        this.state.desiredDirection = null;
        this.motion.beginStabilization(
          blockedAhead
            ? 'Obstacle détecté : arrêt puis nouvelle observation stable.'
            : 'Vision indisponible : arrêt puis nouvelle observation stable.',
        );
        await this.robot.stop();
        if (epoch !== this.state.controlEpoch) return;
        if (blockedAhead) {
          this.state.reward = -4;
          this.state.blockReason = 'infrared';
          this.topology.markCurrentPortBlocked();
        }
        return;
      }
      this.topology.recordDriveCommand(this.state.desiredDirection);
      await this.robot.drive(
        this.commands.driveCommand(this.state.desiredDirection),
      );
      if (epoch !== this.state.controlEpoch) return;
      if (this.state.pendingMotionBurstDurationMs > 0) {
        this.state.motionBurstEndsAt =
          Date.now() + this.state.pendingMotionBurstDurationMs;
        this.state.pendingMotionBurstDurationMs = 0;
      }
    } catch (error) {
      if (epoch !== this.state.controlEpoch) return;
      await this.block(
        error instanceof Error
          ? `Navigation temps réel interrompue : ${error.message}`
          : 'Navigation temps réel interrompue.',
        'route_mismatch',
      );
      if (epoch !== this.state.controlEpoch) return;
    } finally {
      this.refreshingMotion = false;
    }
  }
}
