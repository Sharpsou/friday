export interface DriveLearningContext {
  clearance: number;
  headingError: number;
  lateralError: number;
  localizationConfidence: number;
  progress: number;
  underVoltage: boolean;
}

export interface DriveLearningAction {
  durationDeltaMs: number;
  intensityDelta: number;
  steeringDelta: number;
}

interface ArmState {
  action: DriveLearningAction;
  diagonal: number[];
  reward: number[];
  samples: number;
}

const FEATURE_COUNT = 7;

export class ConservativeDriveLearner {
  readonly #arms: ArmState[];

  constructor(private readonly exploration = 0.15) {
    this.#arms = buildActions().map((action) => ({
      action,
      diagonal: Array<number>(FEATURE_COUNT).fill(1),
      reward: Array<number>(FEATURE_COUNT).fill(0),
      samples: 0,
    }));
  }

  recommend(context: DriveLearningContext): DriveLearningAction {
    if (!isSafeContext(context)) return zeroAction();
    const features = featureVector(context);
    const baseline = this.#arms.find((arm) => isZero(arm.action));
    if (!baseline) return zeroAction();
    const baselineLower = score(baseline, features, -this.exploration) - 0.05;
    let selected = baseline;
    let selectedScore = score(baseline, features, this.exploration);
    for (const arm of this.#arms) {
      const lower = score(arm, features, -this.exploration);
      const upper = score(arm, features, this.exploration);
      if (lower >= baselineLower && upper > selectedScore) {
        selected = arm;
        selectedScore = upper;
      }
    }
    return constrain(selected.action, context);
  }

  record(
    context: DriveLearningContext,
    action: DriveLearningAction,
    reward: number,
  ): void {
    if (!Number.isFinite(reward)) return;
    const arm = this.#arms.find((candidate) =>
      sameAction(candidate.action, action),
    );
    if (!arm) return;
    const features = featureVector(context);
    for (let index = 0; index < FEATURE_COUNT; index += 1) {
      const feature = features[index] ?? 0;
      arm.diagonal[index] = (arm.diagonal[index] ?? 1) + feature * feature;
      arm.reward[index] = (arm.reward[index] ?? 0) + feature * reward;
    }
    arm.samples += 1;
  }

  get sampleCount(): number {
    return this.#arms.reduce((total, arm) => total + arm.samples, 0);
  }
}

export function navigationReward(input: {
  blocked: boolean;
  elapsedRatio: number;
  headingError: number;
  intervention: boolean;
  lateralError: number;
  oscillation: number;
  progress: number;
  safetyStop: boolean;
}): number {
  const normalized = {
    elapsed: clamp01(input.elapsedRatio),
    heading: clamp01(Math.abs(input.headingError)),
    lateral: clamp01(Math.abs(input.lateralError)),
    oscillation: clamp01(input.oscillation),
    progress: clamp01(input.progress),
  };
  return (
    2 * normalized.progress -
    1.5 * normalized.lateral -
    1.2 * normalized.heading -
    0.4 * normalized.elapsed -
    0.5 * normalized.oscillation -
    (input.blocked ? 3 : 0) -
    (input.intervention ? 10 : 0) -
    (input.safetyStop ? 50 : 0)
  );
}

function buildActions(): DriveLearningAction[] {
  const actions: DriveLearningAction[] = [];
  for (const steeringDelta of [-0.04, 0, 0.04])
    for (const intensityDelta of [-0.05, 0, 0.05])
      for (const durationDeltaMs of [-50, 0, 50])
        actions.push({ durationDeltaMs, intensityDelta, steeringDelta });
  return actions;
}

function featureVector(context: DriveLearningContext): number[] {
  return [
    1,
    clampSigned(context.headingError),
    clampSigned(context.lateralError),
    clamp01(context.progress),
    clamp01(context.clearance),
    clamp01(context.localizationConfidence),
    context.underVoltage ? 1 : 0,
  ];
}

function score(arm: ArmState, features: number[], confidence: number): number {
  let estimate = 0;
  let uncertainty = 0;
  for (let index = 0; index < FEATURE_COUNT; index += 1) {
    const feature = features[index] ?? 0;
    const diagonal = arm.diagonal[index] ?? 1;
    estimate += ((arm.reward[index] ?? 0) / diagonal) * feature;
    uncertainty += (feature * feature) / diagonal;
  }
  return estimate + confidence * Math.sqrt(uncertainty);
}

function constrain(
  action: DriveLearningAction,
  context: DriveLearningContext,
): DriveLearningAction {
  if (context.clearance < 0.35 || context.localizationConfidence < 0.6)
    return {
      steeringDelta: Math.max(-0.02, Math.min(0.02, action.steeringDelta)),
      intensityDelta: Math.min(0, action.intensityDelta),
      durationDeltaMs: Math.min(0, action.durationDeltaMs),
    };
  return action;
}

function isSafeContext(context: DriveLearningContext): boolean {
  return (
    !context.underVoltage &&
    context.clearance >= 0.2 &&
    context.localizationConfidence >= 0.5 &&
    Object.values(context).every(
      (value) => typeof value === 'boolean' || Number.isFinite(value),
    )
  );
}

function zeroAction(): DriveLearningAction {
  return { durationDeltaMs: 0, intensityDelta: 0, steeringDelta: 0 };
}

function isZero(action: DriveLearningAction): boolean {
  return sameAction(action, zeroAction());
}

function sameAction(a: DriveLearningAction, b: DriveLearningAction): boolean {
  return (
    a.durationDeltaMs === b.durationDeltaMs &&
    a.intensityDelta === b.intensityDelta &&
    a.steeringDelta === b.steeringDelta
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
