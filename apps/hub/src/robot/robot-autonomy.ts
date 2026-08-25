import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import {
  RobotAutonomyStatusSchema,
  RobotCognitionJournalSchema,
  type RobotAutonomyGoal,
  type RobotAutonomyStatus,
  type RobotCameraLookRequest,
  type RobotDriveRequest,
  type RobotState,
} from '@friday/contracts';

import type { RobotController } from './robot-controller.js';
import {
  RobotDynaAgent,
  availableRobotActions,
  potentialShapingReward,
  robotStateKey,
  type RobotCameraPreset,
  type RobotDynaSnapshot,
  type RobotLearningAction,
  type RobotLearningObservation,
} from './robot-dyna.js';
import { RobotMappingService } from './robot-mapping.js';
import { RobotMemoryService } from './robot-memory.js';

const LOOP_DELAY_MS = 260;
const DRIVE_DURATION_MS = 140;
const POLICY_VERSION = 2;

interface RunRow {
  goal: string | null;
  id: string;
  initial_power_percent: number;
  map_session_id: string | null;
  reward_total: number;
  started_at: string;
  status: string;
  steering_trim_percent: number;
  step_count: number;
  updated_at: string;
}

interface PolicyRow {
  id: string;
  parameters_json: string;
}

export interface RobotExplorationAdvisor {
  planRobotExploration?(
    input: {
      currentGoal: RobotAutonomyGoal;
      mapNovelty: 'high' | 'known' | 'low';
      keyframeCount: number;
      objectCount: number;
      pointCount: number;
      uncertainty: number;
      viewpointCount: number;
    },
    signal: AbortSignal,
  ): Promise<{ goal: RobotAutonomyGoal; reason: string }>;
}

export class RobotAutonomyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class RobotAutonomyService {
  private active = false;
  private analysisPending = false;
  private agent: RobotDynaAgent | null = null;
  private lastAction: RobotLearningAction | null = null;
  private lastReward: number | null = null;
  private lastTdError: number | null = null;
  private policyId: string | null = null;
  private run: RunRow | null = null;
  private timer: NodeJS.Timeout | null = null;
  private target: { id: string; x: number; y: number } | null = null;
  private unavailableCount = 0;

  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly robot: RobotController,
    private readonly mapping: RobotMappingService,
    private readonly memory?: RobotMemoryService,
    private readonly advisor?: RobotExplorationAdvisor,
  ) {
    const now = new Date().toISOString();
    // A hub restart is deliberately a stop boundary. Persisted learning is
    // retained, but motion can only restart after a new explicit request.
    this.database
      .prepare(
        `UPDATE robot_autonomy_runs
            SET status = 'completed', ended_at = ?, updated_at = ?,
                stop_reason = 'hub_restart'
          WHERE household_id = ?
            AND status IN ('exploring', 'navigating', 'analyzing', 'recovering')`,
      )
      .run(now, now, this.householdId);
  }

  status(): RobotAutonomyStatus {
    const now = new Date().toISOString();
    const mapContext = this.mapping.autonomyContext();
    const observation = this.run ? this.lastObservation : null;
    const availableActions = observation
      ? this.actionsForGoal(
          observation,
          this.mapping.snapshot().localization.pose,
        )
      : [];
    const stateKey = observation ? robotStateKey(observation) : '';
    return RobotAutonomyStatusSchema.parse({
      status: this.run?.status ?? 'inactive',
      runId: this.run?.id ?? null,
      mapSessionId: this.run?.map_session_id ?? mapContext.mapSessionId,
      startedAt: this.run?.started_at ?? null,
      updatedAt: this.run?.updated_at ?? now,
      goal: (this.run?.goal as RobotAutonomyGoal | null | undefined) ?? null,
      action: this.lastAction,
      availableActions,
      confidence:
        this.agent && this.lastAction && stateKey
          ? this.agent.confidence(stateKey, this.lastAction)
          : 0,
      speedPercent: actionSpeed(this.lastAction),
      reward: this.lastReward,
      tdError: this.lastTdError,
      reason:
        this.run?.status === 'recovering'
          ? 'Liaison robot momentanément indisponible, nouvelle tentative en cours.'
          : null,
      episodeCount: this.run?.step_count ?? 0,
    });
  }

  journal() {
    const rows = this.database
      .prepare(
        `SELECT id, kind, message, goal, created_at
           FROM robot_cognition_journal
          WHERE household_id = ? ORDER BY created_at DESC LIMIT 100`,
      )
      .all(this.householdId) as Array<{
      created_at: string;
      goal: string | null;
      id: string;
      kind: string;
      message: string;
    }>;
    return RobotCognitionJournalSchema.parse({
      entries: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        message: row.message,
        goal: row.goal,
        createdAt: row.created_at,
      })),
    });
  }

  async start(input: {
    powerPercent: number;
    steeringTrimPercent: number;
    targetPointId?: string;
  }): Promise<RobotState> {
    const target = input.targetPointId
      ? this.mapping.navigationTarget(input.targetPointId)
      : null;
    if (this.active) {
      if (target && this.run) {
        this.target = target;
        this.run.goal = 'navigate_to_target';
        this.updateGoalAndStatus('navigate_to_target', 'navigating');
        this.writeJournal(
          'goal_accepted',
          'Destination cartographique acceptée ; navigation locale en cours.',
          'navigate_to_target',
        );
      }
      return this.robot.state();
    }
    const state = await this.robot.state();
    if (!state.available || !state.connected)
      throw new RobotAutonomyError(
        'robot_autonomy_unavailable',
        'Le robot doit être connecté pour démarrer.',
      );
    if (!state.capabilities.includes('autonomous_exploration'))
      throw new RobotAutonomyError(
        'robot_autonomy_unsupported',
        'Le runtime AlphaBot2 ne déclare pas encore l’exploration autonome.',
      );
    if (!state.cameraAvailable)
      throw new RobotAutonomyError(
        'robot_autonomy_camera_required',
        'La caméra doit être disponible.',
      );
    if (!state.actuators.wheelsEnabled && !state.actuators.cameraServosEnabled)
      throw new RobotAutonomyError(
        'robot_autonomy_actuator_required',
        'Activez les roues ou les servos caméra pour explorer.',
      );

    let readyState = state;
    if (
      state.actuators.cameraServosEnabled &&
      (Math.abs(state.cameraPose.pan) > 0.02 ||
        Math.abs(state.cameraPose.tilt - 0.2) > 0.02)
    )
      readyState = await this.robot.look(cameraCommand(0, 0.2));
    const map = this.mapping.startAutonomous(readyState);
    readyState = await this.robot.setMode('autonomous');
    this.mapping.setMode('autonomous');
    if (readyState.actuators.wheelsEnabled)
      readyState = await this.robot.arm(5_000);

    const policy = this.loadPolicy(
      input.powerPercent,
      input.steeringTrimPercent,
    );
    this.agent = policy.agent;
    this.policyId = policy.id;
    const now = new Date().toISOString();
    this.run = {
      id: randomUUID(),
      goal: target ? 'navigate_to_target' : 'explore_frontier',
      initial_power_percent: input.powerPercent,
      steering_trim_percent: input.steeringTrimPercent,
      map_session_id: map.mapping.sessionId,
      reward_total: 0,
      started_at: now,
      status: target ? 'navigating' : 'exploring',
      step_count: 0,
      updated_at: now,
    };
    this.database
      .prepare(
        `INSERT INTO robot_autonomy_runs(
           id, household_id, map_session_id, status, goal,
           initial_power_percent, steering_trim_percent, reward_total,
           step_count, started_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      )
      .run(
        this.run.id,
        this.householdId,
        this.run.map_session_id,
        this.run.status,
        this.run.goal,
        input.powerPercent,
        input.steeringTrimPercent,
        now,
        now,
      );
    this.active = true;
    this.target = target;
    this.lastObservation = this.observe(readyState);
    this.writeJournal(
      'status',
      `Exploration autonome démarrée à ${Math.min(20, input.powerPercent).toString()} % ; Carto enregistre automatiquement.`,
      this.run.goal,
    );
    this.schedule(0);
    return readyState;
  }

  async stop(reason = 'explicit_stop'): Promise<RobotState> {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    let state = await this.robot.stop();
    if (state.operatingMode !== 'manual')
      state = await this.robot.setMode('manual');
    this.mapping.setMode('manual');
    if (this.run) {
      const now = new Date().toISOString();
      this.persistPolicy();
      this.database
        .prepare(
          `UPDATE robot_autonomy_runs SET status = 'completed', ended_at = ?,
                  updated_at = ?, stop_reason = ? WHERE id = ?`,
        )
        .run(now, now, reason, this.run.id);
      this.writeJournal(
        'status',
        'Exploration autonome arrêtée.',
        this.run.goal,
      );
    }
    this.run = null;
    this.target = null;
    this.lastAction = null;
    return state;
  }

  async close(): Promise<void> {
    if (!this.active) return;
    await this.stop('hub_shutdown').catch(() => undefined);
  }

  private lastObservation: RobotLearningObservation | null = null;

  private schedule(delay: number): void {
    if (!this.active) return;
    this.timer = setTimeout(() => void this.step(), delay);
    this.timer.unref();
  }

  private async step(): Promise<void> {
    if (!this.active || !this.run || !this.agent) return;
    try {
      let state = await this.robot.state();
      this.memory?.observe(
        state,
        state.vision
          ? (this.robot.visionKeyframe?.(state.vision.frameId) ?? null)
          : null,
      );
      this.mapping.observe(state);
      // vcgencmd exposes a threshold bit, not a voltage magnitude. Servo and
      // motor current peaks can set it during otherwise usable operation, so
      // it remains diagnostic telemetry and never gates autonomous actions.
      if (state.operatingMode !== 'autonomous')
        state = await this.robot.setMode('autonomous');
      if (
        state.actuators.wheelsEnabled &&
        (!state.armed ||
          !state.controlExpiresAt ||
          Date.parse(state.controlExpiresAt) < Date.now() + 1_500)
      )
        state = await this.robot.arm(5_000);

      const previousContext = this.mapping.autonomyContext();
      const previousDistance = this.distanceToTarget();
      const observation = this.observe(state);
      const actions = this.actionsForGoal(
        observation,
        this.mapping.snapshot().localization.pose,
      );
      const action = this.agent.choose(observation, actions);
      this.lastAction = action;
      const previousVisionFrameId = state.vision?.frameId ?? -1;
      state = await this.execute(action, state);
      this.memory?.observe(
        state,
        state.vision
          ? (this.robot.visionKeyframe?.(state.vision.frameId) ?? null)
          : null,
      );
      this.mapping.observe(state);
      const nextContext = this.mapping.autonomyContext();
      const nextDistance = this.distanceToTarget();
      const nextObservation = this.observe(state);
      const reward =
        -0.01 +
        potentialShapingReward(
          previousContext.potential,
          nextContext.potential,
        ) +
        (nextContext.objectCount > previousContext.objectCount ? 1 : 0) +
        cameraQualityReward(
          action,
          state,
          previousContext.viewpointCount,
          nextContext.viewpointCount,
          nextContext.currentViewpointVisits,
          (state.vision?.frameId ?? -1) > previousVisionFrameId,
        ) +
        goalReward(
          this.run.goal as RobotAutonomyGoal,
          action,
          nextContext.novelty,
        ) +
        (previousDistance !== null && nextDistance !== null
          ? Math.max(-1, Math.min(1, (previousDistance - nextDistance) * 5))
          : 0) +
        (action === 'reverse_escape' &&
        state.telemetry.irLeftClear !== false &&
        state.telemetry.irRightClear !== false
          ? 0.4
          : 0);
      const tdError = this.agent.learn({
        state: robotStateKey(observation),
        action,
        reward,
        nextState: robotStateKey(nextObservation),
        nextActions: this.actionsForGoal(
          nextObservation,
          this.mapping.snapshot().localization.pose,
        ),
      });
      this.lastObservation = nextObservation;
      this.lastReward = reward;
      this.lastTdError = tdError;
      this.unavailableCount = 0;
      const reached = nextDistance !== null && nextDistance <= 0.15;
      if (reached) {
        this.target = null;
        this.updateGoalAndStatus('explore_frontier', 'exploring');
        this.writeJournal(
          'status',
          'Destination atteinte ; reprise de l’exploration cartographique.',
          'explore_frontier',
        );
      }
      this.updateRun(reward, this.target ? 'navigating' : 'exploring');
      if (this.run.step_count % 10 === 0) this.persistPolicy();
      if (this.run.step_count % 25 === 0)
        this.writeJournal(
          'learning',
          `Dyna-Q : ${this.run.step_count.toString()} expériences, confiance ${Math.round(this.agent.confidence(robotStateKey(observation), action) * 100).toString()} %, nouveauté ${nextContext.novelty}.`,
          this.run.goal,
        );
      if (
        (!this.target && this.run.step_count % 50 === 0) ||
        (!this.target &&
          nextContext.novelty === 'low' &&
          this.run.step_count % 20 === 0)
      )
        void this.requestAdvice(nextContext);
      this.schedule(LOOP_DELAY_MS);
    } catch (error) {
      await this.recover(error);
    }
  }

  private async execute(
    action: RobotLearningAction,
    state: RobotState,
  ): Promise<RobotState> {
    if (action === 'wait_observe') {
      if (state.moving) return this.robot.halt();
      return state;
    }
    if (action.startsWith('look_')) {
      const preset = action.slice(5) as RobotCameraPreset;
      const pose = CAMERA_PRESETS[preset];
      const previousFrameId = state.vision?.frameId ?? -1;
      const moved = await this.robot.look(cameraCommand(pose.pan, pose.tilt));
      return this.awaitFreshVision(previousFrameId, moved);
    }
    const command = driveCommand(action, this.run?.steering_trim_percent ?? 0);
    const next = await this.robot.drive(command);
    this.mapping.recordDrive(command, next);
    return next;
  }

  private async awaitFreshVision(
    previousFrameId: number,
    fallback: RobotState,
  ): Promise<RobotState> {
    const deadline = Date.now() + 1_800;
    let latest = fallback;
    while (this.active && Date.now() < deadline) {
      latest = await this.robot.state();
      if ((latest.vision?.frameId ?? -1) > previousFrameId) return latest;
      await new Promise<void>((resolve) => setTimeout(resolve, 120));
    }
    return latest;
  }

  private async recover(error: unknown): Promise<void> {
    if (!this.active || !this.run) return;
    this.unavailableCount += 1;
    this.updateRun(0, 'recovering');
    if (this.unavailableCount === 1)
      this.writeJournal(
        'recovery',
        error instanceof Error
          ? `Pause de récupération : ${error.message.slice(0, 430)}`
          : 'Pause de récupération du robot.',
        this.run.goal,
      );
    await this.robot.halt().catch(() => undefined);
    this.schedule(
      Math.min(5_000, 500 * 2 ** Math.min(3, this.unavailableCount)),
    );
  }

  private actionsForGoal(
    observation: RobotLearningObservation,
    pose: { heading: number; x: number; y: number },
  ): RobotLearningAction[] {
    const available = availableRobotActions(observation);
    if (!this.target) return available;
    const error = normalizeAngle(
      Math.atan2(this.target.y - pose.y, this.target.x - pose.x) - pose.heading,
    );
    const passive = available.filter(
      (action) => action === 'wait_observe' || action.startsWith('look_'),
    );
    if (Math.abs(error) > 0.3) {
      const turn = error > 0 ? 'turn_left' : 'turn_right';
      return available.includes(turn) ? [...passive, turn] : passive;
    }
    const forward = available.filter((action) => action.startsWith('forward_'));
    return forward.length > 0 ? [...passive, ...forward] : available;
  }

  private distanceToTarget(): number | null {
    if (!this.target) return null;
    const pose = this.mapping.snapshot().localization.pose;
    return Math.hypot(this.target.x - pose.x, this.target.y - pose.y);
  }

  private updateGoalAndStatus(
    goal: RobotAutonomyGoal,
    status: 'exploring' | 'navigating',
  ): void {
    if (!this.run) return;
    this.run.goal = goal;
    this.run.status = status;
    this.run.updated_at = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE robot_autonomy_runs SET goal = ?, status = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(goal, status, this.run.updated_at, this.run.id);
  }

  private async requestAdvice(
    context: ReturnType<RobotMappingService['autonomyContext']>,
  ): Promise<void> {
    if (
      this.analysisPending ||
      !this.advisor?.planRobotExploration ||
      !this.run ||
      !this.active
    )
      return;
    this.analysisPending = true;
    const runId = this.run.id;
    const currentGoal = this.run.goal as RobotAutonomyGoal;
    this.writeJournal(
      'analysis_requested',
      'Friday analyse la progression de la carte en arrière-plan.',
      currentGoal,
    );
    try {
      const advice = await this.advisor.planRobotExploration(
        {
          currentGoal,
          keyframeCount: this.mapping.snapshot().visualMemory.keyframeCount,
          mapNovelty: context.novelty,
          objectCount: context.objectCount,
          pointCount: context.pointCount,
          uncertainty: context.uncertainty,
          viewpointCount: context.viewpointCount,
        },
        AbortSignal.timeout(90_000),
      );
      if (!this.active || this.run?.id !== runId) return;
      if (
        advice.goal === 'navigate_to_target' ||
        advice.goal === 'revisit_object'
      ) {
        this.writeJournal(
          'goal_rejected',
          `Suggestion écartée : ${advice.reason}`,
          advice.goal,
        );
        return;
      }
      this.run.goal =
        advice.goal === 'continue_current_goal' ? currentGoal : advice.goal;
      this.database
        .prepare(
          `UPDATE robot_autonomy_runs SET goal = ?, updated_at = ? WHERE id = ?`,
        )
        .run(this.run.goal, new Date().toISOString(), this.run.id);
      this.writeJournal('goal_accepted', advice.reason, this.run.goal);
    } catch (error) {
      if (this.active && this.run?.id === runId)
        this.writeJournal(
          'goal_rejected',
          error instanceof Error
            ? `Analyse Friday différée : ${error.message.slice(0, 430)}`
            : 'Analyse Friday différée.',
          currentGoal,
        );
    } finally {
      this.analysisPending = false;
    }
  }

  private observe(state: RobotState): RobotLearningObservation {
    const pose = this.mapping.snapshot().localization.pose;
    const person = state.vision?.detections
      .filter(
        (item) =>
          item.kind === 'person' &&
          (item.confidence ?? 0) >= 0.7 &&
          item.height >= 0.35,
      )
      .sort((left, right) => right.height - left.height)[0];
    const personCenter = person ? person.x + person.width / 2 : null;
    return {
      wheelsEnabled: state.actuators.wheelsEnabled,
      cameraServosEnabled: state.actuators.cameraServosEnabled,
      moving: state.moving,
      cameraMoving: false,
      cameraPreset: nearestPreset(state.cameraPose.pan, state.cameraPose.tilt),
      irLeftClear: state.telemetry.irLeftClear,
      irRightClear: state.telemetry.irRightClear,
      personDirection:
        personCenter === null
          ? 'none'
          : personCenter < 0.4
            ? 'left'
            : personCenter > 0.6
              ? 'right'
              : 'center',
      headingBucket: Math.max(
        -2,
        Math.min(2, Math.round(pose.heading / (Math.PI / 2))),
      ) as -2 | -1 | 0 | 1 | 2,
      mapNovelty: this.mapping.autonomyContext().novelty,
      lastAction: this.lastAction,
    };
  }

  private loadPolicy(
    power: number,
    trim: number,
  ): {
    agent: RobotDynaAgent;
    id: string;
  } {
    const row = this.database
      .prepare(
        `SELECT id, parameters_json FROM robot_navigation_policies
          WHERE household_id = ? AND version = ?`,
      )
      .get(this.householdId, POLICY_VERSION) as PolicyRow | undefined;
    let snapshot: RobotDynaSnapshot | undefined;
    if (row) {
      try {
        const parsed = JSON.parse(row.parameters_json) as RobotDynaSnapshot;
        if (parsed.version === 1) snapshot = parsed;
      } catch {
        snapshot = undefined;
      }
    }
    const id = row?.id ?? randomUUID();
    const agent = new RobotDynaAgent(power, trim, snapshot ? { snapshot } : {});
    if (!row) {
      const now = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO robot_navigation_policies(
             id, household_id, version, mode, parameters_json,
             episode_count, created_at, updated_at
           ) VALUES (?, ?, ?, 'candidate', ?, 0, ?, ?)`,
        )
        .run(
          id,
          this.householdId,
          POLICY_VERSION,
          JSON.stringify(agent.export()),
          now,
          now,
        );
    }
    return { agent, id };
  }

  private persistPolicy(): void {
    if (!this.agent || !this.policyId || !this.run) return;
    this.database
      .prepare(
        `UPDATE robot_navigation_policies
            SET parameters_json = ?, episode_count = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        JSON.stringify(this.agent.export()),
        this.run.step_count,
        new Date().toISOString(),
        this.policyId,
      );
  }

  private updateRun(reward: number, status: RunRow['status']): void {
    if (!this.run) return;
    this.run.step_count += status === 'exploring' ? 1 : 0;
    this.run.reward_total += reward;
    this.run.status = status;
    this.run.updated_at = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE robot_autonomy_runs SET status = ?, reward_total = ?,
                step_count = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        status,
        this.run.reward_total,
        this.run.step_count,
        this.run.updated_at,
        this.run.id,
      );
  }

  private writeJournal(
    kind:
      | 'analysis_requested'
      | 'goal_accepted'
      | 'goal_rejected'
      | 'learning'
      | 'recovery'
      | 'status',
    message: string,
    goal: string | null,
  ): void {
    this.database
      .prepare(
        `INSERT INTO robot_cognition_journal(
           id, household_id, autonomy_run_id, kind, message, goal, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        this.householdId,
        this.run?.id ?? null,
        kind,
        message.slice(0, 500),
        goal,
        new Date().toISOString(),
      );
  }
}

const CAMERA_PRESETS: Record<RobotCameraPreset, { pan: number; tilt: number }> =
  {
    center: { pan: 0, tilt: 0.2 },
    left: { pan: 0.45, tilt: 0.2 },
    left_wide: { pan: 0.85, tilt: 0.2 },
    right: { pan: -0.45, tilt: 0.2 },
    right_wide: { pan: -0.85, tilt: 0.2 },
    up: { pan: 0, tilt: 0 },
    up_high: { pan: 0, tilt: -0.25 },
    down: { pan: 0, tilt: 0.4 },
    down_low: { pan: 0, tilt: 0.65 },
    up_left: { pan: 0.65, tilt: -0.1 },
    up_right: { pan: -0.65, tilt: -0.1 },
    down_left: { pan: 0.65, tilt: 0.5 },
    down_right: { pan: -0.65, tilt: 0.5 },
  };

function nearestPreset(pan: number, tilt: number): RobotCameraPreset {
  return (
    Object.entries(CAMERA_PRESETS) as Array<
      [RobotCameraPreset, { pan: number; tilt: number }]
    >
  ).reduce((best, candidate) =>
    Math.hypot(candidate[1].pan - pan, candidate[1].tilt - tilt) <
    Math.hypot(best[1].pan - pan, best[1].tilt - tilt)
      ? candidate
      : best,
  )[0];
}

function timing(lifetimeMs: number) {
  const now = Date.now();
  return {
    commandId: randomUUID(),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + lifetimeMs).toISOString(),
  };
}

function cameraCommand(pan: number, tilt: number): RobotCameraLookRequest {
  return { ...timing(1_800), pan, tilt };
}

function driveCommand(
  action: RobotLearningAction,
  steeringTrimPercent: number,
): RobotDriveRequest {
  const base = { ...timing(1_000), maxDurationMs: DRIVE_DURATION_MS };
  if (action === 'reverse_escape')
    return { ...base, direction: 'backward', intensity: 0.1, steering: 0 };
  if (action === 'turn_left')
    return { ...base, direction: 'left', intensity: 0.12, steering: 0 };
  if (action === 'turn_right')
    return { ...base, direction: 'right', intensity: 0.12, steering: 0 };
  const [, speed, heading] = action.split('_');
  const learnedSteering =
    heading === 'left' ? -0.12 : heading === 'right' ? 0.12 : 0;
  return {
    ...base,
    direction: 'forward',
    intensity: Math.min(0.2, Math.max(0.1, Number(speed) / 100)),
    steering: Math.min(
      1,
      Math.max(-1, learnedSteering + steeringTrimPercent / 100),
    ),
  };
}

function actionSpeed(action: RobotLearningAction | null): number {
  if (!action) return 0;
  if (action.startsWith('forward_')) return Number(action.split('_')[1]);
  if (action === 'turn_left' || action === 'turn_right') return 12;
  if (action === 'reverse_escape') return 10;
  return 0;
}

function goalReward(
  goal: RobotAutonomyGoal,
  action: RobotLearningAction,
  novelty: 'high' | 'known' | 'low',
): number {
  if (goal === 'improve_observation' && action.startsWith('look_')) return 0.08;
  if (
    goal === 'calibrate_motion' &&
    (action.startsWith('forward_') || action.startsWith('turn_'))
  )
    return 0.04;
  if (goal === 'explore_frontier' && novelty === 'high') return 0.06;
  if (
    (goal === 'consolidate_route' || goal === 'verify_area') &&
    novelty !== 'high'
  )
    return 0.04;
  return 0;
}

export function cameraQualityReward(
  action: RobotLearningAction,
  state: RobotState,
  previousViewpointCount: number,
  nextViewpointCount: number,
  viewpointVisits: number,
  freshVision: boolean,
): number {
  if (!action.startsWith('look_')) return 0;
  if (!freshVision) return -0.04;
  const objects =
    state.vision?.detections.filter(
      (detection) =>
        detection.kind === 'object' && detection.confidence !== null,
    ) ?? [];
  const confidence =
    objects.length === 0
      ? 0
      : objects.reduce(
          (total, detection) => total + (detection.confidence ?? 0),
          0,
        ) / objects.length;
  return (
    (nextViewpointCount > previousViewpointCount ? 0.16 : 0) +
    Math.min(0.08, confidence * 0.08) -
    (viewpointVisits > 4 ? 0.05 : 0)
  );
}

function normalizeAngle(value: number): number {
  let normalized = value;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}
