import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  driveRobot,
  getRobotState,
  haltRobot,
  lookRobotCamera,
  setRobotActuators,
  stopRobot,
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
