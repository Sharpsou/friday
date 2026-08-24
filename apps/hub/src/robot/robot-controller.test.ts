import { describe, expect, it } from 'vitest';

import {
  DisabledRobotController,
  parseRobotBaseUrl,
  RobotUnavailableError,
  SimulatedRobotController,
  validateRobotCommandTiming,
} from './robot-controller.js';

describe('Robot controller boundary', () => {
  it('only accepts literal private adapter addresses', () => {
    expect(parseRobotBaseUrl('http://192.168.1.22:8090').href).toBe(
      'http://192.168.1.22:8090/',
    );
    expect(() => parseRobotBaseUrl('https://robot.example.com')).toThrow();
    expect(() => parseRobotBaseUrl('http://169.254.169.254')).toThrow();
    expect(() => parseRobotBaseUrl('http://192.168.1.22?a=b')).toThrow();
  });

  it('rejects stale, long-lived and future commands', () => {
    const now = Date.parse('2026-08-23T12:00:00.000Z');
    expect(
      validateRobotCommandTiming(
        {
          issuedAt: '2026-08-23T11:59:59.900Z',
          expiresAt: '2026-08-23T12:00:00.400Z',
        },
        now,
      ),
    ).toBe(true);
    expect(
      validateRobotCommandTiming(
        {
          issuedAt: '2026-08-23T11:59:50.000Z',
          expiresAt: '2026-08-23T12:00:00.400Z',
        },
        now,
      ),
    ).toBe(false);
    expect(
      validateRobotCommandTiming(
        {
          issuedAt: '2026-08-23T12:00:00.000Z',
          expiresAt: '2026-08-23T12:00:02.000Z',
        },
        now,
      ),
    ).toBe(false);
  });

  it('keeps motion disabled until an adapter is explicitly configured', async () => {
    const controller = new DisabledRobotController();
    await expect(controller.state()).resolves.toMatchObject({
      available: false,
      armed: false,
      moving: false,
    });
    await expect(controller.drive()).rejects.toBeInstanceOf(
      RobotUnavailableError,
    );
    await expect(controller.stop()).resolves.toMatchObject({ moving: false });
  });

  it('simulates an armed expiring pulse without touching GPIO', async () => {
    const controller = new SimulatedRobotController();
    await expect(controller.arm(1_000)).resolves.toMatchObject({ armed: true });
    const now = Date.now();
    await expect(
      controller.drive({
        commandId: crypto.randomUUID(),
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 300).toISOString(),
        direction: 'forward',
        intensity: 0.2,
        maxDurationMs: 300,
      }),
    ).resolves.toMatchObject({ moving: true, mode: 'simulated' });
    await expect(controller.stop()).resolves.toMatchObject({
      armed: false,
      moving: false,
    });
    await controller.close();
  });
});
