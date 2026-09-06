import { RobotPanoramaSurveyController } from './robot-panorama-survey.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RobotState } from '@friday/contracts';
import { openDatabase } from '../db/database.js';
import { RobotAutonomyService } from './robot-autonomy.js';
import { SimulatedRobotController } from './robot-controller.js';
import {
  RobotVisualTopologyService,
  type RobotVisualObservation,
} from './robot-visual-topology.js';

const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-06T10:00:00Z'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const observation: RobotVisualObservation = {
  confidence: 0.9,
  imageUsable: true,
  placeId: 'fixture-anchor',
  stable: true,
  motionState: 'stationary',
  informationGain: 0,
};
const options = {
  panoramaPulseMs: 220,
  powerPercent: 20,
  steeringTrimPercent: 0,
};
async function fixture() {
  const db = openDatabase(':memory:');
  const robot = new SimulatedRobotController();
  await robot.setActuators({ wheelsEnabled: true, cameraServosEnabled: true });
  const topology = new RobotVisualTopologyService(
    db,
    '1030b4f6-1e0f-48fa-adab-865750ce597d',
  );
  const service = new RobotAutonomyService(
    db,
    '1030b4f6-1e0f-48fa-adab-865750ce597d',
    robot,
    topology,
    () => 0,
  );
  cleanups.push(async () => {
    await service.close();
    await robot.close();
    db.close();
  });
  const observed = vi.spyOn(topology, 'observe').mockResolvedValue(observation);
  const drive = vi.spyOn(robot, 'drive');
  return { robot, topology, service, observed, drive };
}
describe('autonomy cancellation boundaries', () => {
  it('discards an observation completed after stop and keeps the stopped status', async () => {
    const { service, observed, drive } = await fixture();
    const gate = deferred<RobotVisualObservation>();
    observed.mockImplementationOnce(() => gate.promise);
    await service.start(options);
    await vi.advanceTimersByTimeAsync(250);
    expect(observed).toHaveBeenCalledTimes(1);
    await service.stop();
    const stopped = service.status();
    gate.resolve(observation);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.status()).toEqual(stopped);
    expect(drive).not.toHaveBeenCalled();
  });
  it('does not renew motion after a delayed state response crosses stop', async () => {
    const { service, robot, drive } = await fixture();
    await service.start(options);
    await vi.advanceTimersByTimeAsync(250);
    const current = await robot.state();
    const gate = deferred<RobotState>();
    const reading = vi
      .spyOn(robot, 'state')
      .mockImplementationOnce(() => gate.promise);
    await vi.advanceTimersByTimeAsync(50);
    expect(reading).toHaveBeenCalledTimes(1);
    await service.stop();
    const stopped = service.status();
    const at = new Date().toISOString();
    gate.resolve({
      ...current,
      vision: {
        detections: [],
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        frameId: 1,
        imageHeight: 480,
        imageWidth: 640,
        observedAt: at,
        processingMs: 1,
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(drive).not.toHaveBeenCalled();
    expect(service.status()).toEqual(stopped);
  });
  it('cancels a pending start without reactivating the mode or its timers', async () => {
    const { service, robot, drive } = await fixture();
    const current = await robot.state();
    const gate = deferred<RobotState>();
    vi.spyOn(robot, 'state').mockImplementationOnce(() => gate.promise);
    const starting = service.start(options);
    await service.stop();
    gate.resolve(current);
    await starting;
    expect(service.status().status).toBe('inactive');
    expect((await robot.state()).operatingMode).toBe('manual');
    await vi.advanceTimersByTimeAsync(2000);
    expect(drive).not.toHaveBeenCalled();
  });
  it('stops periodic observation and never resumes an episode in a new service', async () => {
    const { service, observed, drive } = await fixture();
    await service.start(options);
    await vi.advanceTimersByTimeAsync(250);
    await service.stop();
    const calls = observed.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(observed).toHaveBeenCalledTimes(calls);
    expect(drive).not.toHaveBeenCalled();
    const fresh = await fixture();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fresh.service.status().status).toBe('inactive');
    expect(fresh.observed).not.toHaveBeenCalled();
  });
});

async function panoramaFixture() {
  const base = await fixture();
  vi.spyOn(base.topology, 'panoramaProgress').mockReturnValue({
    complete: false,
    placeId: 'fixture-anchor',
    sectorCount: 0,
  });
  const panorama = new RobotPanoramaSurveyController(
    base.robot,
    base.topology,
    (direction, intensity, maxDurationMs) => ({
      commandId: crypto.randomUUID(),
      direction,
      intensity,
      maxDurationMs,
      steering: 0,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1800).toISOString(),
    }),
    (pan, tilt) => ({
      commandId: crypto.randomUUID(),
      pan,
      tilt,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1800).toISOString(),
    }),
  );
  return { ...base, panorama };
}
describe('panorama cancellation boundaries', () => {
  it('does not rotate when sector capture resolves after cancellation', async () => {
    const { robot, topology, panorama, drive } = await panoramaFixture();
    const gate = deferred<{
      added: boolean;
      complete: boolean;
      sectorCount: number;
    }>();
    vi.spyOn(topology, 'captureStablePanoramaSector').mockImplementationOnce(
      () => gate.promise,
    );
    const state = await robot.state();
    await panorama.start(state);
    await vi.advanceTimersByTimeAsync(701);
    await panorama.tick(state, observation);
    await panorama.tick(state, observation);
    const pending = panorama.tick(state, observation);
    await Promise.resolve();
    await panorama.cancel();
    gate.resolve({ added: true, complete: false, sectorCount: 1 });
    await pending;
    expect(drive).not.toHaveBeenCalled();
    expect(panorama.status().active).toBe(false);
  });
  it('cancels preparation before a delayed stop can issue a camera command', async () => {
    const { robot, panorama } = await panoramaFixture();
    const state = await robot.state();
    const gate = deferred<RobotState>();
    vi.spyOn(robot, 'stop').mockImplementationOnce(() => gate.promise);
    const look = vi.spyOn(robot, 'look');
    const starting = panorama.start(state);
    await panorama.cancel();
    gate.resolve(state);
    await starting;
    expect(look).not.toHaveBeenCalled();
    expect(panorama.status().active).toBe(false);
  });
});
