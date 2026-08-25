import { describe, expect, it } from 'vitest';

import {
  RobotCameraLookRequestSchema,
  RobotActuatorsRequestSchema,
  RobotDetectionSchema,
  RobotDriveRequestSchema,
  RobotStateSchema,
} from './index.js';

const timing = {
  commandId: 'ddac3a50-2a56-4bec-8678-9802c21cf5e3',
  issuedAt: '2026-08-23T12:00:00.000Z',
  expiresAt: '2026-08-23T12:00:00.400Z',
};

describe('Robot contracts', () => {
  it('accepts only short and slow AlphaBot drive pulses', () => {
    expect(
      RobotDriveRequestSchema.parse({
        ...timing,
        direction: 'forward',
        intensity: 0.25,
        steering: 0.6,
        maxDurationMs: 350,
      }).direction,
    ).toBe('forward');
    expect(
      RobotDriveRequestSchema.safeParse({
        ...timing,
        direction: 'forward',
        intensity: 0.8,
        steering: 0,
        maxDurationMs: 2_000,
      }).success,
    ).toBe(false);
  });

  it('bounds camera targets and keeps disabled state explicit', () => {
    expect(
      RobotCameraLookRequestSchema.safeParse({
        ...timing,
        pan: 1.1,
        tilt: 0,
      }).success,
    ).toBe(false);
    expect(
      RobotStateSchema.parse({
        available: false,
        connected: false,
        armed: false,
        mode: 'disabled',
        cameraAvailable: false,
        actuators: { wheelsEnabled: false, cameraServosEnabled: false },
        moving: false,
        lastSeenAt: null,
        warning: 'Robot non configuré.',
        capabilities: [],
        operatingMode: 'manual',
        controlExpiresAt: null,
        cameraPose: { pan: 0, tilt: 0 },
        telemetry: {
          temperatureC: null,
          throttledCode: null,
          underVoltageActive: false,
          underVoltageOccurred: false,
          irLeftClear: null,
          irRightClear: null,
          lineSensors: [0, 0, 0, 0, 0],
          cameraFps: null,
          commandLatencyMs: null,
        },
        vision: null,
      }).mode,
    ).toBe('disabled');
  });

  it('requires both actuator switches to be explicit booleans', () => {
    expect(
      RobotActuatorsRequestSchema.parse({
        wheelsEnabled: true,
        cameraServosEnabled: false,
      }),
    ).toEqual({ wheelsEnabled: true, cameraServosEnabled: false });
    expect(
      RobotActuatorsRequestSchema.safeParse({ wheelsEnabled: true }).success,
    ).toBe(false);
  });

  it('rejects overlays outside the source image', () => {
    expect(
      RobotDetectionSchema.safeParse({
        id: 'object-1',
        kind: 'object',
        label: 'tasse',
        confidence: 0.92,
        x: 0.9,
        y: 0.1,
        width: 0.2,
        height: 0.2,
        trackId: null,
      }).success,
    ).toBe(false);
  });
});
