import { describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import {
  RobotHabitLearningService,
  robotHabitContextKey,
  type RobotHabitContext,
} from './robot-habit-learning.js';

const context: RobotHabitContext = {
  arrival: 'known',
  informationTrend: 'rising',
  infrared: 'clear',
  localization: 'high',
  motion: 'translation',
  panorama: 'complete',
  ports: 'multiple',
  progress: 'moving',
  previousOutcome: 'none',
};

describe('RobotHabitLearningService', () => {
  it('generalizes by sensory context rather than place UUID', () => {
    const database = openDatabase(':memory:');
    const learner = new RobotHabitLearningService(database, 'home', () => 0.9);
    const first = learner.choose(
      context,
      ['advance_slow', 'advance_normal'],
      0,
    );
    learner.learn(first, 4, null, {
      durationMs: 500,
      informationGain: 1,
      success: true,
    });
    const learned = learner.choose(
      context,
      ['advance_slow', 'advance_normal'],
      1_000,
    );
    expect(learned.contextKey).toBe(robotHabitContextKey(context));
    expect(learned.action).toBe(first.action);
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM robot_habit_values')
        .get(),
    ).toEqual({ count: 1 });
    database.close();
  });

  it('never chooses outside the deterministic action mask', () => {
    const database = openDatabase(':memory:');
    const learner = new RobotHabitLearningService(database, 'home', () => 0.99);
    expect(learner.choose(context, ['pivot_right'], 50).action).toBe(
      'pivot_right',
    );
    database.close();
  });
});
