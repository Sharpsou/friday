import { describe, expect, it } from 'vitest';

import type { RobotState } from '@friday/contracts';

import {
  actionForDirection,
  autonomousActionIntensity,
  motionBurstDurationMs,
  stabilizationFrameCount,
  unlocalizedSearchDirection,
} from './robot-autonomy.js';

describe('topological autonomy policy', () => {
  it('turns a learned transition into a bounded local habit', () => {
    expect(actionForDirection('forward')).toBe('advance_slow');
    expect(actionForDirection('left')).toBe('pivot_left');
    expect(actionForDirection('right')).toBe('pivot_right');
    expect(actionForDirection('backward')).toBe('return_to_last_anchor');
    expect(actionForDirection('unknown')).toBe('advance_slow');
  });

  it('scans for a landmark before allowing a short translation', () => {
    const clear = {
      telemetry: { irLeftClear: true, irRightClear: true },
    } as RobotState;
    expect(unlocalizedSearchDirection(clear, 0)).toBe('right');
    expect(unlocalizedSearchDirection(clear, 7)).toBe('right');
    expect(unlocalizedSearchDirection(clear, 8)).toBe('forward');
    expect(
      unlocalizedSearchDirection(
        {
          telemetry: { irLeftClear: false, irRightClear: true },
        } as RobotState,
        8,
      ),
    ).toBe('right');
    expect(
      unlocalizedSearchDirection(
        {
          telemetry: { irLeftClear: false, irRightClear: false },
        } as RobotState,
        0,
      ),
    ).toBeNull();
  });

  it('uses the complete user power range for every autonomous habit', () => {
    expect(autonomousActionIntensity('advance_normal', 35)).toBe(0.35);
    expect(autonomousActionIntensity('advance_slow', 18)).toBe(0.18);
    expect(autonomousActionIntensity('pivot_right', 10)).toBe(0.1);
    expect(autonomousActionIntensity('try_alternate_port', 50)).toBe(0.35);
  });

  it('shortens motion bursts when power rises instead of travelling farther', () => {
    expect(motionBurstDurationMs('advance_normal', 10)).toBe(500);
    expect(motionBurstDurationMs('advance_normal', 20)).toBe(320);
    expect(motionBurstDurationMs('advance_normal', 35)).toBe(183);
    expect(motionBurstDurationMs('pivot_left', 35)).toBe(140);
  });

  it('requires three consecutive stationary usable observations', () => {
    const stationary = {
      imageUsable: true,
      motionState: 'stationary' as const,
      stable: true,
    };
    expect(stabilizationFrameCount(0, stationary)).toBe(1);
    expect(stabilizationFrameCount(1, stationary)).toBe(2);
    expect(stabilizationFrameCount(2, stationary)).toBe(3);
    expect(
      stabilizationFrameCount(2, {
        ...stationary,
        motionState: 'body_rotation',
      }),
    ).toBe(0);
    expect(
      stabilizationFrameCount(2, { ...stationary, imageUsable: false }),
    ).toBe(0);
  });
});
