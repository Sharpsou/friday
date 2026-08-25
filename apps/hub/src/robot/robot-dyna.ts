export const ROBOT_SPEEDS = [0.1, 0.12, 0.15, 0.18, 0.2] as const;
export type RobotLearningAction =
  | 'look_center'
  | 'look_down'
  | 'look_down_left'
  | 'look_down_low'
  | 'look_down_right'
  | 'look_left'
  | 'look_left_wide'
  | 'look_right'
  | 'look_right_wide'
  | 'look_up'
  | 'look_up_high'
  | 'look_up_left'
  | 'look_up_right'
  | 'reverse_escape'
  | 'turn_left'
  | 'turn_right'
  | 'wait_observe'
  | `forward_${10 | 12 | 15 | 18 | 20}_${'left' | 'right' | 'straight'}`;

export type RobotCameraPreset =
  | 'center'
  | 'down'
  | 'down_left'
  | 'down_low'
  | 'down_right'
  | 'left'
  | 'left_wide'
  | 'right'
  | 'right_wide'
  | 'up'
  | 'up_high'
  | 'up_left'
  | 'up_right';

export interface RobotLearningObservation {
  cameraMoving: boolean;
  cameraPreset: RobotCameraPreset;
  cameraServosEnabled: boolean;
  headingBucket: -2 | -1 | 0 | 1 | 2;
  irLeftClear: boolean | null;
  irRightClear: boolean | null;
  lastAction: RobotLearningAction | null;
  mapNovelty: 'high' | 'known' | 'low';
  moving: boolean;
  personDirection: 'center' | 'left' | 'none' | 'right';
  wheelsEnabled: boolean;
}

interface ModelTransition {
  count: number;
  nextActions: RobotLearningAction[];
  nextState: string;
  reward: number;
  terminal: boolean;
}

export interface RobotDynaSnapshot {
  epsilon: number;
  model: Record<string, Record<string, ModelTransition>>;
  q: Record<string, Record<string, number>>;
  step: number;
  tdError: Record<string, number>;
  triedAt: Record<string, number>;
  version: 1;
  visits: Record<string, number>;
}

export interface RobotDynaOptions {
  alpha?: number;
  epsilonFloor?: number;
  epsilonStart?: number;
  gamma?: number;
  kappa?: number;
  planningSteps?: number;
  random?: () => number;
  snapshot?: RobotDynaSnapshot;
}

const HEAD_ACTIONS: RobotLearningAction[] = [
  'look_left',
  'look_left_wide',
  'look_center',
  'look_right',
  'look_right_wide',
  'look_up',
  'look_up_high',
  'look_down',
  'look_down_low',
  'look_up_left',
  'look_up_right',
  'look_down_left',
  'look_down_right',
];
const SPEED_LABELS = [10, 12, 15, 18, 20] as const;
const FORWARD_ACTIONS = SPEED_LABELS.flatMap((speed) =>
  (['left', 'straight', 'right'] as const).map(
    (steering) => `forward_${speed}_${steering}` as const,
  ),
);

export function availableRobotActions(
  observation: RobotLearningObservation,
): RobotLearningAction[] {
  const actions: RobotLearningAction[] = ['wait_observe'];
  if (observation.cameraServosEnabled && !observation.moving) {
    for (const action of HEAD_ACTIONS)
      if (action !== `look_${observation.cameraPreset}`) actions.push(action);
  }
  if (!observation.wheelsEnabled || observation.cameraMoving) return actions;
  if (observation.irLeftClear === false && observation.irRightClear !== false)
    actions.push('turn_right');
  else if (
    observation.irRightClear === false &&
    observation.irLeftClear !== false
  )
    actions.push('turn_left');
  else if (observation.personDirection === 'left') actions.push('turn_right');
  else if (observation.personDirection === 'right') actions.push('turn_left');
  else actions.push('turn_left', 'turn_right');
  if (observation.irLeftClear === false && observation.irRightClear === false)
    actions.push('reverse_escape');
  const personBlocksForward = observation.personDirection !== 'none';
  if (
    observation.irLeftClear !== false &&
    observation.irRightClear !== false &&
    !personBlocksForward
  )
    actions.push(...FORWARD_ACTIONS);
  return actions;
}

export function robotStateKey(observation: RobotLearningObservation): string {
  return [
    observation.wheelsEnabled ? 'w1' : 'w0',
    observation.cameraServosEnabled ? 'c1' : 'c0',
    observation.moving ? 'm1' : 'm0',
    observation.cameraMoving ? 'cm1' : 'cm0',
    `il${flag(observation.irLeftClear)}`,
    `ir${flag(observation.irRightClear)}`,
    `p${observation.personDirection}`,
    `h${observation.headingBucket.toString()}`,
    `n${observation.mapNovelty}`,
    `cam${observation.cameraPreset}`,
    `a${observation.lastAction ?? 'none'}`,
  ].join('|');
}

export function potentialShapingReward(
  previousPotential: number,
  nextPotential: number,
  gamma = 0.85,
): number {
  if (!Number.isFinite(previousPotential) || !Number.isFinite(nextPotential))
    return 0;
  return gamma * nextPotential - previousPotential;
}

export class RobotDynaAgent {
  private readonly alpha: number;
  private readonly epsilonFloor: number;
  private readonly epsilonStart: number;
  private readonly gamma: number;
  private readonly kappa: number;
  private readonly planningSteps: number;
  private readonly random: () => number;
  private snapshot: RobotDynaSnapshot;

  constructor(
    private readonly initialPowerPercent: number,
    private readonly steeringTrimPercent: number,
    options: RobotDynaOptions = {},
  ) {
    this.alpha = options.alpha ?? 0.2;
    this.epsilonFloor = options.epsilonFloor ?? 0.08;
    this.epsilonStart = options.epsilonStart ?? 0.3;
    this.gamma = options.gamma ?? 0.85;
    this.kappa = options.kappa ?? 0.001;
    this.planningSteps = options.planningSteps ?? 10;
    this.random = options.random ?? Math.random;
    this.snapshot = options.snapshot
      ? structuredClone(options.snapshot)
      : {
          version: 1,
          epsilon: this.epsilonStart,
          model: {},
          q: {},
          step: 0,
          tdError: {},
          triedAt: {},
          visits: {},
        };
  }

  choose(
    observation: RobotLearningObservation,
    actions = availableRobotActions(observation),
  ): RobotLearningAction {
    if (actions.length === 0) return 'wait_observe';
    const state = robotStateKey(observation);
    this.ensureState(state, actions);
    const epsilon = Math.max(
      this.epsilonFloor,
      this.epsilonStart / Math.sqrt(1 + this.snapshot.step / 100),
    );
    this.snapshot.epsilon = epsilon;
    if (this.random() < epsilon)
      return actions[Math.floor(this.random() * actions.length)] ?? actions[0]!;
    return this.bestAction(state, actions);
  }

  learn(input: {
    action: RobotLearningAction;
    nextActions: RobotLearningAction[];
    nextState: string;
    reward: number;
    state: string;
    terminal?: boolean;
  }): number {
    const reward = Number.isFinite(input.reward) ? input.reward : 0;
    this.snapshot.step += 1;
    this.ensureState(input.state, [input.action]);
    this.ensureState(input.nextState, input.nextActions);
    const tdError = this.updateQ(
      input.state,
      input.action,
      reward,
      input.nextState,
      input.nextActions,
      input.terminal ?? false,
    );
    const key = pairKey(input.state, input.action);
    this.snapshot.visits[key] = (this.snapshot.visits[key] ?? 0) + 1;
    this.snapshot.triedAt[key] = this.snapshot.step;
    this.snapshot.tdError[key] =
      (this.snapshot.tdError[key] ?? Math.abs(tdError)) * 0.8 +
      Math.abs(tdError) * 0.2;
    const stateModel = (this.snapshot.model[input.state] ??= {});
    const prior = stateModel[input.action];
    stateModel[input.action] = {
      count: (prior?.count ?? 0) + 1,
      nextActions: [...input.nextActions],
      nextState: input.nextState,
      reward:
        prior === undefined
          ? reward
          : prior.reward + (reward - prior.reward) / (prior.count + 1),
      terminal: input.terminal ?? false,
    };
    this.plan();
    return tdError;
  }

  confidence(state: string, action: RobotLearningAction): number {
    const key = pairKey(state, action);
    const visits = this.snapshot.visits[key] ?? 0;
    const error = this.snapshot.tdError[key] ?? 1;
    return clamp01((visits / (visits + 20)) * (1 / (1 + error)));
  }

  export(): RobotDynaSnapshot {
    return structuredClone(this.snapshot);
  }

  private plan(): void {
    const states = Object.keys(this.snapshot.model);
    if (states.length === 0) return;
    for (let index = 0; index < this.planningSteps; index += 1) {
      const state = states[Math.floor(this.random() * states.length)];
      if (!state) continue;
      const actions = Object.keys(
        this.snapshot.model[state] ?? {},
      ) as RobotLearningAction[];
      const action = actions[Math.floor(this.random() * actions.length)];
      if (!action) continue;
      const transition = this.snapshot.model[state]?.[action];
      if (!transition) continue;
      this.updateQ(
        state,
        action,
        transition.reward,
        transition.nextState,
        transition.nextActions,
        transition.terminal,
      );
    }
  }

  private updateQ(
    state: string,
    action: RobotLearningAction,
    reward: number,
    nextState: string,
    nextActions: RobotLearningAction[],
    terminal: boolean,
  ): number {
    const current = this.value(state, action);
    const future = terminal ? 0 : this.maximum(nextState, nextActions);
    const tdError = reward + this.gamma * future - current;
    (this.snapshot.q[state] ??= {})[action] = current + this.alpha * tdError;
    return tdError;
  }

  private maximum(state: string, actions: RobotLearningAction[]): number {
    if (actions.length === 0) return 0;
    return Math.max(...actions.map((action) => this.value(state, action)));
  }

  private bestAction(
    state: string,
    actions: RobotLearningAction[],
  ): RobotLearningAction {
    let selected = actions[0]!;
    let selectedValue = Number.NEGATIVE_INFINITY;
    for (const action of actions) {
      const key = pairKey(state, action);
      const recency = Math.max(
        0,
        this.snapshot.step - (this.snapshot.triedAt[key] ?? 0),
      );
      const value = this.value(state, action) + this.kappa * Math.sqrt(recency);
      if (value > selectedValue) {
        selected = action;
        selectedValue = value;
      }
    }
    return selected;
  }

  private ensureState(state: string, actions: RobotLearningAction[]): void {
    const values = (this.snapshot.q[state] ??= {});
    for (const action of actions)
      if (values[action] === undefined) values[action] = this.prior(action);
  }

  private value(state: string, action: RobotLearningAction): number {
    this.ensureState(state, [action]);
    return this.snapshot.q[state]?.[action] ?? 0;
  }

  private prior(action: RobotLearningAction): number {
    if (action.startsWith('look_')) return 0.05;
    if (!action.startsWith('forward_')) return 0;
    const [, rawSpeed, direction] = action.split('_');
    const speed = Number(rawSpeed);
    const preferredSpeed = Math.max(10, Math.min(20, this.initialPowerPercent));
    const preferredDirection =
      this.steeringTrimPercent < 0
        ? 'left'
        : this.steeringTrimPercent > 0
          ? 'right'
          : 'straight';
    return (
      0.2 -
      Math.abs(speed - preferredSpeed) * 0.01 +
      (direction === preferredDirection ? 0.04 : 0)
    );
  }
}

function flag(value: boolean | null): string {
  return value === null ? 'u' : value ? '1' : '0';
}

function pairKey(state: string, action: RobotLearningAction): string {
  return `${state}::${action}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
