import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RobotState } from '@friday/contracts';

import { RobotPanoramaSurveyController } from './robot-panorama-survey.js';
import type { RobotVisualObservation } from './robot-visual-topology.js';

const state = {
  actuators: { cameraServosEnabled: true, wheelsEnabled: true },
  telemetry: { irLeftClear: true, irRightClear: true },
} as unknown as RobotState;
const observation: RobotVisualObservation = {
  confidence: 0.8,
  imageUsable: true,
  informationGain: 0,
  motionState: 'stationary',
  placeId: crypto.randomUUID(),
  stable: true,
};

describe('RobotPanoramaSurveyController', () => {
  afterEach(() => vi.useRealTimers());

  it('waits for three stable frames before each bounded wheel pulse', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T10:00:00.000Z'));
    const calls: string[] = [];
    const robot = {
      drive: vi.fn(async (command) => {
        calls.push(`drive:${command.direction}:${command.maxDurationMs}`);
        return state;
      }),
      look: vi.fn(async () => {
        calls.push('look:center');
        return state;
      }),
      stop: vi.fn(async () => {
        calls.push('stop');
        return state;
      }),
    };
    const topology = {
      captureStablePanoramaSector: vi.fn(async () => ({
        added: true,
        complete: false,
        sectorCount: 1,
      })),
      markPanoramaIncomplete: vi.fn(),
      beginPanoramaSession: vi.fn(),
      panoramaProgress: vi.fn(() => ({
        complete: false,
        placeId: observation.placeId,
        sectorCount: 0,
      })),
      pauseObservations: vi.fn(),
      recordDriveCommand: vi.fn(),
      resumeObservationsAfter: vi.fn(),
    };
    const controller = new RobotPanoramaSurveyController(
      robot as never,
      topology as never,
      (direction, intensity, maxDurationMs) => ({
        commandId: crypto.randomUUID(),
        direction,
        expiresAt: new Date(Date.now() + 1_000).toISOString(),
        intensity,
        issuedAt: new Date().toISOString(),
        maxDurationMs,
        steering: 0,
      }),
      (pan, tilt) => ({
        commandId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 1_000).toISOString(),
        issuedAt: new Date().toISOString(),
        pan,
        tilt,
      }),
    );
    controller.setPulseDuration(340);

    expect(await controller.start(state)).toBe(true);
    vi.advanceTimersByTime(701);
    await controller.tick(state, observation);
    await controller.tick(state, observation);
    expect(topology.captureStablePanoramaSector).not.toHaveBeenCalled();
    await controller.tick(state, observation);

    expect(calls).toEqual(['stop', 'look:center', 'drive:right:340']);
    expect(topology.captureStablePanoramaSector).toHaveBeenCalledOnce();
    expect(topology.pauseObservations).toHaveBeenCalledTimes(2);
  });

  it('renews a long configurable pulse inside the physical watchdog bound', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T10:00:00.000Z'));
    const drive = vi.fn(async () => state);
    const topology = {
      captureStablePanoramaSector: vi.fn(async () => ({
        added: true,
        complete: false,
        sectorCount: 1,
      })),
      markPanoramaIncomplete: vi.fn(),
      beginPanoramaSession: vi.fn(),
      panoramaProgress: vi.fn(() => ({
        complete: false,
        placeId: observation.placeId,
        sectorCount: 0,
      })),
      pauseObservations: vi.fn(),
      recordDriveCommand: vi.fn(),
      resumeObservationsAfter: vi.fn(),
    };
    const controller = new RobotPanoramaSurveyController(
      {
        drive,
        look: vi.fn(async () => state),
        stop: vi.fn(async () => state),
      } as never,
      topology as never,
      (direction, intensity, maxDurationMs) => ({
        commandId: crypto.randomUUID(),
        direction,
        expiresAt: new Date(Date.now() + 1_000).toISOString(),
        intensity,
        issuedAt: new Date().toISOString(),
        maxDurationMs,
        steering: 0,
      }),
      (pan, tilt) => ({
        commandId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 1_000).toISOString(),
        issuedAt: new Date().toISOString(),
        pan,
        tilt,
      }),
    );
    controller.setPulseDuration(700);

    await controller.start(state);
    vi.advanceTimersByTime(701);
    await controller.tick(state, observation);
    await controller.tick(state, observation);
    await controller.tick(state, observation);

    expect(drive).toHaveBeenCalledWith(
      expect.objectContaining({ intensity: 0.2, maxDurationMs: 500 }),
    );
    controller.setDriveIntensity(0.35);
    vi.advanceTimersByTime(251);
    await controller.tick(state, observation);
    expect(drive).toHaveBeenCalledTimes(2);
    expect(drive).toHaveBeenLastCalledWith(
      expect.objectContaining({ intensity: 0.35, maxDurationMs: 449 }),
    );
    expect(controller.status()).toMatchObject({
      active: true,
      phase: 'rotating',
    });
  });

  it('crosses an unusable view instead of abandoning or freezing the panorama', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T10:00:00.000Z'));
    const topology = {
      beginPanoramaSession: vi.fn(),
      captureStablePanoramaSector: vi.fn(),
      markPanoramaIncomplete: vi.fn(),
      panoramaProgress: vi.fn(() => ({
        complete: false,
        placeId: observation.placeId,
        sectorCount: 0,
      })),
      pauseObservations: vi.fn(),
      recordDriveCommand: vi.fn(),
      resumeObservationsAfter: vi.fn(),
    };
    const controller = new RobotPanoramaSurveyController(
      {
        drive: vi.fn(async () => state),
        look: vi.fn(async () => state),
        stop: vi.fn(async () => state),
      } as never,
      topology as never,
      (direction, intensity, maxDurationMs) => ({
        commandId: crypto.randomUUID(),
        direction,
        expiresAt: new Date(Date.now() + 1_000).toISOString(),
        intensity,
        issuedAt: new Date().toISOString(),
        maxDurationMs,
        steering: 0,
      }),
      (pan, tilt) => ({
        commandId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 1_000).toISOString(),
        issuedAt: new Date().toISOString(),
        pan,
        tilt,
      }),
    );

    await controller.start(state);
    vi.advanceTimersByTime(120_000);
    await controller.tick(state, { ...observation, imageUsable: false });

    expect(controller.status()).toMatchObject({
      active: true,
      impulseCount: 1,
      phase: 'rotating',
    });
    expect(topology.markPanoramaIncomplete).not.toHaveBeenCalled();
  });
});
