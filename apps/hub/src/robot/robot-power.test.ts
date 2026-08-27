import { describe, expect, it, vi } from 'vitest';

import type { RobotPowerStatus } from '@friday/contracts';

import { SimulatedRobotController } from './robot-controller.js';
import {
  NetworkStandbyRobotController,
  type RobotPowerClient,
} from './robot-power.js';

function status(powerState: RobotPowerStatus['powerState']): RobotPowerStatus {
  const active = powerState === 'awake' ? 'active' : 'inactive';
  return {
    powerState,
    robotService: active,
    cameraService: active,
    updatedAt: new Date().toISOString(),
    message: null,
  };
}

class FakePower implements RobotPowerClient {
  current = status('awake');
  async status() {
    return this.current;
  }
  async sleep() {
    this.current = status('sleeping');
    return this.current;
  }
  async wake() {
    this.current = status('awake');
    return this.current;
  }
}

describe('network standby robot controller', () => {
  it('pauses vision, exposes a stable sleeping state, and wakes safe in manual', async () => {
    const base = new SimulatedRobotController();
    const power = new FakePower();
    const vision = { pause: vi.fn(async () => undefined), resume: vi.fn() };
    const robot = new NetworkStandbyRobotController(base, power, vision);

    await robot.initialize();
    const sleeping = await robot.sleepNetwork();
    expect(sleeping).toMatchObject({
      powerState: 'sleeping',
      moving: false,
      operatingMode: 'manual',
      actuators: { wheelsEnabled: false, cameraServosEnabled: false },
    });
    expect(vision.pause).toHaveBeenCalledOnce();

    const awake = await robot.wakeNetwork();
    expect(awake).toMatchObject({
      powerState: 'awake',
      operatingMode: 'manual',
      actuators: { wheelsEnabled: false, cameraServosEnabled: false },
    });
    expect(vision.resume).toHaveBeenCalledTimes(2);
    await robot.close();
  });

  it('does not mistake an unreachable wake agent for sleeping', async () => {
    const base = new SimulatedRobotController();
    const power: RobotPowerClient = {
      status: async () => {
        throw new Error('offline');
      },
      sleep: async () => status('sleeping'),
      wake: async () => status('awake'),
    };
    const robot = new NetworkStandbyRobotController(base, power);
    expect(await robot.state()).toMatchObject({
      powerState: 'unavailable',
      connected: false,
    });
    await robot.close();
  });
});
