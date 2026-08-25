import { describe, expect, it } from 'vitest';

import {
  RobotDynaAgent,
  availableRobotActions,
  potentialShapingReward,
  robotStateKey,
  type RobotLearningObservation,
} from './robot-dyna.js';

const observation: RobotLearningObservation = {
  cameraMoving: false,
  cameraPreset: 'center',
  cameraServosEnabled: true,
  headingBucket: 0,
  irLeftClear: true,
  irRightClear: true,
  lastAction: null,
  mapNovelty: 'high',
  moving: false,
  personDirection: 'none',
  wheelsEnabled: true,
};

describe('RobotDynaAgent', () => {
  it('leaves head actions naturally available when the wheel switch is off', () => {
    const actions = availableRobotActions({
      ...observation,
      wheelsEnabled: false,
    });

    expect(actions).toContain('look_left');
    expect(actions).toEqual(
      expect.arrayContaining([
        'look_left_wide',
        'look_right_wide',
        'look_up_high',
        'look_down_low',
        'look_up_left',
        'look_down_right',
      ]),
    );
    expect(actions).not.toContain('turn_left');
    expect(actions.some((action) => action.startsWith('forward_'))).toBe(false);
  });

  it('excludes only the current head target, not a diagonal sharing its name', () => {
    const actions = availableRobotActions({
      ...observation,
      cameraPreset: 'left',
      wheelsEnabled: false,
    });

    expect(actions).not.toContain('look_left');
    expect(actions).toContain('look_down_left');
  });

  it('masks forward motion around a person without prescribing a turn', () => {
    const actions = availableRobotActions({
      ...observation,
      personDirection: 'center',
    });

    expect(actions.some((action) => action.startsWith('forward_'))).toBe(false);
    expect(actions).toEqual(
      expect.arrayContaining(['turn_left', 'turn_right', 'look_left']),
    );
  });

  it('keeps only the contour turn away from a person on one side', () => {
    const actions = availableRobotActions({
      ...observation,
      personDirection: 'left',
    });

    expect(actions).toContain('turn_right');
    expect(actions).not.toContain('turn_left');
  });

  it('learns from real transitions, performs planning and persists its model', () => {
    const agent = new RobotDynaAgent(10, 0, {
      epsilonFloor: 0,
      epsilonStart: 0,
      random: () => 0,
    });
    const state = robotStateKey(observation);
    const next = { ...observation, mapNovelty: 'known' as const };
    const nextState = robotStateKey(next);
    const actions = availableRobotActions(next);

    const error = agent.learn({
      action: 'forward_10_straight',
      nextActions: actions,
      nextState,
      reward: 2,
      state,
    });
    const snapshot = agent.export();

    expect(error).toBeGreaterThan(0);
    expect(snapshot.model[state]?.forward_10_straight?.count).toBe(1);
    expect(snapshot.q[state]?.forward_10_straight).toBeGreaterThan(0.2);
    expect(new RobotDynaAgent(10, 0, { snapshot }).export()).toStrictEqual(
      snapshot,
    );
  });

  it('uses policy-invariant potential shaping', () => {
    expect(potentialShapingReward(0.2, 0.6, 0.85)).toBeCloseTo(0.31);
    expect(potentialShapingReward(Number.NaN, 0.6)).toBe(0);
  });
});
