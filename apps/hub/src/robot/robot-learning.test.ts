import { describe, expect, it } from 'vitest';

import {
  ConservativeDriveLearner,
  navigationReward,
} from './robot-learning.js';

describe('ConservativeDriveLearner', () => {
  const safeContext = {
    clearance: 0.9,
    headingError: 0.1,
    lateralError: 0.15,
    localizationConfidence: 0.95,
    progress: 0.4,
    underVoltage: false,
  };

  it('never proposes a correction in an unsafe context', () => {
    const learner = new ConservativeDriveLearner();
    expect(learner.recommend({ ...safeContext, underVoltage: true })).toEqual({
      durationDeltaMs: 0,
      intensityDelta: 0,
      steeringDelta: 0,
    });
  });

  it('keeps every proposal inside the initial residual envelope', () => {
    const learner = new ConservativeDriveLearner();
    const action = learner.recommend(safeContext);
    expect(Math.abs(action.steeringDelta)).toBeLessThanOrEqual(0.04);
    expect(Math.abs(action.intensityDelta)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(action.durationDeltaMs)).toBeLessThanOrEqual(50);
  });

  it('heavily penalizes a safety stop and ignores invalid rewards', () => {
    const learner = new ConservativeDriveLearner();
    const action = learner.recommend(safeContext);
    learner.record(safeContext, action, Number.NaN);
    expect(learner.sampleCount).toBe(0);
    expect(
      navigationReward({
        blocked: false,
        elapsedRatio: 0.2,
        headingError: 0,
        intervention: false,
        lateralError: 0,
        oscillation: 0,
        progress: 1,
        safetyStop: true,
      }),
    ).toBeLessThan(-40);
  });
});
