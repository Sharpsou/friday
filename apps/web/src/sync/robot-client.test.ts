import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  driveRobot,
  getRobotControlPreferences,
  getRobotPanoramaPreferences,
  getRobotDisplayPreferences,
  getRobotState,
  haltRobot,
  lookRobotCamera,
  setRobotControlPreferences,
  setRobotPanoramaPreferences,
  setRobotDisplayPreferences,
  sleepRobotNetwork,
  setRobotActuators,
  setRobotAutonomyPower,
  stopRobot,
  wakeRobotNetwork,
} from './robot-client.js';

afterEach(() => vi.unstubAllGlobals());

const state = {
  available: true,
  connected: true,
  armed: false,
  mode: 'simulated',
  cameraAvailable: true,
  actuators: { wheelsEnabled: false, cameraServosEnabled: false },
  moving: false,
  lastSeenAt: '2026-08-24T00:00:00.000Z',
  warning: 'Simulation : aucune sortie GPIO.',
  capabilities: ['teleop', 'camera_stream'],
  operatingMode: 'manual',
  controlExpiresAt: null,
  cameraPose: { pan: 0, tilt: 0 },
  telemetry: {
    temperatureC: 48,
    throttledCode: '0x0',
    underVoltageActive: false,
    underVoltageOccurred: false,
    irLeftClear: true,
    irRightClear: true,
    lineSensors: [1, 2, 3, 4, 5],
    cameraFps: 10,
    commandLatencyMs: 18,
  },
  vision: null,
} as const;

describe('robot client', () => {
  it('uses dedicated non-queued sleep and wake commands', async () => {
    const standbyState = {
      ...state,
      powerState: 'sleeping',
      available: false,
      connected: true,
      cameraAvailable: false,
      capabilities: ['network_standby'],
    } as const;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true, state: standbyState })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accepted: true,
            state: { ...state, powerState: 'awake' },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(sleepRobotNetwork()).resolves.toMatchObject({
      powerState: 'sleeping',
    });
    await expect(wakeRobotNetwork()).resolves.toMatchObject({
      powerState: 'awake',
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/robot/power/sleep',
      '/api/robot/power/wake',
    ]);
  });

  it('never uses a cache or retry queue for state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(state), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRobotState()).resolves.toMatchObject({ mode: 'simulated' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('sends both actuator states atomically', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, state }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await setRobotActuators({
      wheelsEnabled: true,
      cameraServosEnabled: false,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/robot/actuators');
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      wheelsEnabled: true,
      cameraServosEnabled: false,
    });
  });

  it('reads and updates the shared recognition display preference', async () => {
    const visible = {
      recognitionVisible: true,
      updatedAt: '2026-08-26T12:00:00.000Z',
    };
    const hidden = { ...visible, recognitionVisible: false };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(visible), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(hidden), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getRobotDisplayPreferences()).resolves.toEqual(visible);
    await expect(setRobotDisplayPreferences(false)).resolves.toEqual(hidden);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/robot/display-preferences');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      recognitionVisible: false,
    });
  });

  it('reads and updates the shared steering trim', async () => {
    const initial = { steeringTrimPercent: 0, updatedAt: null };
    const calibrated = {
      steeringTrimPercent: -5,
      updatedAt: '2026-08-26T13:30:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(initial)))
      .mockResolvedValueOnce(new Response(JSON.stringify(calibrated)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getRobotControlPreferences()).resolves.toEqual(initial);
    await expect(setRobotControlPreferences(-5)).resolves.toEqual(calibrated);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/robot/control-preferences');
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      steeringTrimPercent: -5,
    });
  });

  it('reads and updates the shared panorama pulse', async () => {
    const initial = { panoramaPulseMs: 220, updatedAt: null };
    const calibrated = {
      panoramaPulseMs: 340,
      updatedAt: '2026-08-26T13:31:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(initial)))
      .mockResolvedValueOnce(new Response(JSON.stringify(calibrated)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getRobotPanoramaPreferences()).resolves.toEqual(initial);
    await expect(setRobotPanoramaPreferences(340)).resolves.toEqual(calibrated);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/robot/panorama-preferences',
    );
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      panoramaPulseMs: 340,
    });
  });

  it('updates autonomous power while the run is active', async () => {
    const autonomy = {
      status: 'exploring',
      runId: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      startedAt: '2026-08-27T12:00:00.000Z',
      updatedAt: '2026-08-27T12:00:01.000Z',
      currentPlaceId: null,
      targetPlaceId: null,
      action: null,
      availableActions: [],
      confidence: 0,
      speedPercent: 35,
      reward: null,
      reason: 'Réglage actif.',
      learningStepCount: 0,
      imageUsable: false,
      motionState: 'uncertain',
      blockReason: 'stabilizing',
      informationGain: 0,
      localizationConfidence: 0,
      habitConfidence: 0,
      humanRecovery: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(autonomy), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(setRobotAutonomyPower(35)).resolves.toMatchObject({
      speedPercent: 35,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/robot/autonomy/power');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      powerPercent: 35,
    });
  });

  it('creates a short fresh drive command and sends stop with keepalive', async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ accepted: true, state }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await driveRobot('left');
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      issuedAt: string;
      expiresAt: string;
      direction: string;
      intensity: number;
      steering: number;
    };
    expect(body.direction).toBe('left');
    expect(body.intensity).toBe(0.2);
    expect(body.steering).toBe(0);
    expect(Date.parse(body.expiresAt) - Date.parse(body.issuedAt)).toBe(350);
    await stopRobot();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ keepalive: true });
    await haltRobot();
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/robot/halt');
  });

  it('gives a smoothed camera move enough time to reach the Pi', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, state }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await lookRobotCamera(0.5, 0);
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      issuedAt: string;
      expiresAt: string;
    };
    expect(Date.parse(body.expiresAt) - Date.parse(body.issuedAt)).toBe(1_800);
  });

  it('shows the precise hub rejection instead of a generic error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'robot_owner_required' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(lookRobotCamera(0.5, 0)).rejects.toThrow(
      'Le contrôle du robot est réservé au propriétaire.',
    );
  });
});
