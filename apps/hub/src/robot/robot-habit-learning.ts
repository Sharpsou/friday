import type Database from 'better-sqlite3';

import type { RobotAutonomyAction } from '@friday/contracts';

export const HABIT_POLICY_VERSION = 'topological-habits-v1';

const ALPHA = 0.15;
const GAMMA = 0.9;
const LAMBDA = 0.7;
const MIN_EPSILON = 0.03;
const INITIAL_EPSILON = 0.15;

export interface RobotHabitContext {
  arrival: 'known' | 'unknown';
  informationTrend: 'falling' | 'stable' | 'rising';
  infrared: 'clear' | 'left' | 'right' | 'both';
  localization: 'low' | 'medium' | 'high';
  motion:
    | 'stationary'
    | 'camera_rotation'
    | 'body_rotation'
    | 'translation'
    | 'uncertain';
  panorama: 'missing' | 'incomplete' | 'complete' | 'redundant';
  ports: 'none' | 'one' | 'multiple';
  progress: 'moving' | 'stalled' | 'oscillating';
  previousOutcome: 'none' | 'success' | 'failure';
}

export interface RobotHabitChoice {
  action: RobotAutonomyAction;
  confidence: number;
  contextKey: string;
  exploratory: boolean;
}

export interface RobotHabitOutcome {
  durationMs: number;
  informationGain: number;
  success: boolean;
}

const PRIORS: Record<RobotAutonomyAction, number> = {
  advance_slow: 0.18,
  advance_normal: 0.22,
  pivot_left: 0.08,
  pivot_right: 0.08,
  inspect_anchor: 0.05,
  try_alternate_port: 0.04,
  return_to_last_anchor: 0,
  apply_recovery: 0.12,
};

export class RobotHabitLearningService {
  private readonly traces = new Map<string, number>();

  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly random: () => number = Math.random,
  ) {}

  resetEpisode(): void {
    this.traces.clear();
  }

  choose(
    context: RobotHabitContext,
    available: RobotAutonomyAction[],
    decisionCount: number,
  ): RobotHabitChoice {
    if (available.length === 0)
      throw new Error('Aucune habitude admissible dans ce contexte.');
    const contextKey = robotHabitContextKey(context);
    const values = this.readValues(contextKey);
    const epsilon = Math.max(
      MIN_EPSILON,
      INITIAL_EPSILON * Math.exp(-decisionCount / 1_000),
    );
    if (this.random() < epsilon) {
      return {
        action: available[Math.floor(this.random() * available.length)]!,
        confidence: 0,
        contextKey,
        exploratory: true,
      };
    }
    const ranked = available
      .map((action) => ({
        action,
        value: values.get(action) ?? PRIORS[action],
        visits: values.visits.get(action) ?? 0,
        failures: values.failures.get(action) ?? 0,
      }))
      .sort(
        (left, right) =>
          right.value - left.value ||
          left.failures - right.failures ||
          left.visits - right.visits,
      );
    const best = ranked[0]!;
    const runnerUp = ranked[1]?.value ?? best.value - 0.25;
    return {
      action: best.action,
      confidence: Math.min(
        1,
        Math.max(0, best.visits / 5) * Math.max(0, best.value - runnerUp + 0.5),
      ),
      contextKey,
      exploratory: false,
    };
  }

  learn(
    previous: RobotHabitChoice,
    reward: number,
    next: RobotHabitChoice | null,
    outcome: RobotHabitOutcome,
  ): void {
    const currentQ = this.qValue(previous.contextKey, previous.action);
    const nextQ = next ? this.qValue(next.contextKey, next.action) : 0;
    const delta = reward + GAMMA * nextQ - currentQ;
    const activeKey = traceKey(previous.contextKey, previous.action);
    this.traces.set(activeKey, 1);
    const now = new Date().toISOString();
    const update = this.database.prepare(
      `INSERT INTO robot_habit_values(
         household_id, policy_version, context_key, action, q_value,
         visit_count, success_count, failure_count, consecutive_failures,
         information_gain_total, duration_total_ms, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(household_id, policy_version, context_key, action)
       DO UPDATE SET q_value = excluded.q_value,
                     visit_count = visit_count + CASE WHEN context_key = ? AND action = ? THEN 1 ELSE 0 END,
                     success_count = success_count + CASE WHEN context_key = ? AND action = ? THEN excluded.success_count ELSE 0 END,
                     failure_count = failure_count + CASE WHEN context_key = ? AND action = ? THEN excluded.failure_count ELSE 0 END,
                     consecutive_failures = CASE
                       WHEN context_key = ? AND action = ? AND excluded.success_count = 1 THEN 0
                       WHEN context_key = ? AND action = ? THEN consecutive_failures + 1
                       ELSE consecutive_failures END,
                     information_gain_total = information_gain_total + CASE WHEN context_key = ? AND action = ? THEN excluded.information_gain_total ELSE 0 END,
                     duration_total_ms = duration_total_ms + CASE WHEN context_key = ? AND action = ? THEN excluded.duration_total_ms ELSE 0 END,
                     updated_at = excluded.updated_at`,
    );
    this.database.transaction(() => {
      for (const [key, eligibility] of this.traces) {
        const [contextKey, action] = parseTraceKey(key);
        const q = this.qValue(contextKey, action);
        const nextValue = Math.max(
          -10,
          Math.min(10, q + ALPHA * delta * eligibility),
        );
        const isActive = key === activeKey;
        update.run(
          this.householdId,
          HABIT_POLICY_VERSION,
          contextKey,
          action,
          nextValue,
          isActive && outcome.success ? 1 : 0,
          isActive && !outcome.success ? 1 : 0,
          isActive && !outcome.success ? 1 : 0,
          isActive ? outcome.informationGain : 0,
          isActive ? outcome.durationMs : 0,
          now,
          previous.contextKey,
          previous.action,
          previous.contextKey,
          previous.action,
          previous.contextKey,
          previous.action,
          previous.contextKey,
          previous.action,
          previous.contextKey,
          previous.action,
          previous.contextKey,
          previous.action,
          previous.contextKey,
          previous.action,
        );
        const decayed = eligibility * GAMMA * LAMBDA;
        if (decayed < 0.05) this.traces.delete(key);
        else this.traces.set(key, decayed);
      }
    })();
  }

  private qValue(contextKey: string, action: RobotAutonomyAction): number {
    const row = this.database
      .prepare(
        `SELECT q_value FROM robot_habit_values
          WHERE household_id = ? AND policy_version = ?
            AND context_key = ? AND action = ?`,
      )
      .get(this.householdId, HABIT_POLICY_VERSION, contextKey, action) as
      { q_value: number } | undefined;
    return row?.q_value ?? PRIORS[action];
  }

  private readValues(contextKey: string) {
    const rows = this.database
      .prepare(
        `SELECT action, q_value, visit_count, consecutive_failures
           FROM robot_habit_values
          WHERE household_id = ? AND policy_version = ? AND context_key = ?`,
      )
      .all(this.householdId, HABIT_POLICY_VERSION, contextKey) as Array<{
      action: RobotAutonomyAction;
      consecutive_failures: number;
      q_value: number;
      visit_count: number;
    }>;
    const values = new Map(rows.map((row) => [row.action, row.q_value]));
    return Object.assign(values, {
      failures: new Map(
        rows.map((row) => [row.action, row.consecutive_failures]),
      ),
      visits: new Map(rows.map((row) => [row.action, row.visit_count])),
    });
  }
}

export function robotHabitContextKey(context: RobotHabitContext): string {
  return [
    context.infrared,
    context.motion,
    context.localization,
    context.informationTrend,
    context.ports,
    context.arrival,
    context.panorama,
    context.progress,
    context.previousOutcome,
  ].join('|');
}

function traceKey(contextKey: string, action: RobotAutonomyAction): string {
  return `${contextKey}\u0000${action}`;
}

function parseTraceKey(key: string): [string, RobotAutonomyAction] {
  const separator = key.lastIndexOf('\u0000');
  return [
    key.slice(0, separator),
    key.slice(separator + 1) as RobotAutonomyAction,
  ];
}
