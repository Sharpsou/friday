import { afterEach, describe, expect, it, vi } from 'vitest';

import { driveRobot, getRobotState, stopRobot } from './robot-client.js';

afterEach(() => vi.unstubAllGlobals());

const state = {
  available: true,
  connected: true,
  armed: false,
  mode: 'simulated',
  cameraAvailable: true,
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
    };
    expect(body.direction).toBe('left');
    expect(Date.parse(body.expiresAt) - Date.parse(body.issuedAt)).toBe(350);
    await stopRobot();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ keepalive: true });
  });
});
