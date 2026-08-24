import { describe, expect, it } from 'vitest';

import { nextCameraPose } from './robot-camera-controls.js';

describe('RobotView camera controls', () => {
  it('moves pan in large half-range steps while keeping tilt precise', () => {
    expect(nextCameraPose({ pan: 0, tilt: 0 }, -0.5, 0)).toEqual({
      pan: -0.5,
      tilt: 0,
    });
    expect(nextCameraPose({ pan: -0.5, tilt: 0 }, -0.5, 0)).toEqual({
      pan: -1,
      tilt: 0,
    });
    expect(nextCameraPose({ pan: -1, tilt: 0 }, -0.5, 0)).toEqual({
      pan: -1,
      tilt: 0,
    });
    expect(nextCameraPose({ pan: 0, tilt: 0 }, 0, 0.05)).toEqual({
      pan: 0,
      tilt: 0.05,
    });
  });
});
