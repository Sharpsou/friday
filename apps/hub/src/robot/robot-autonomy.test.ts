import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { RobotAutonomyService } from './robot-autonomy.js';
import { RobotMappingService } from './robot-mapping.js';
import { SimulatedRobotController } from './robot-controller.js';

const HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';

describe('RobotAutonomyService', () => {
  const closeCallbacks: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const close of closeCallbacks.splice(0).reverse()) await close();
  });

  it('maps with camera presets when wheels are disabled and persists learning', async () => {
    const database = openDatabase(':memory:');
    const robot = new SimulatedRobotController();
    closeCallbacks.push(async () => {
      await robot.close();
      database.close();
    });
    await robot.setActuators({
      wheelsEnabled: false,
      cameraServosEnabled: true,
    });
    const mapping = new RobotMappingService(database, HOUSEHOLD_ID);
    const autonomy = new RobotAutonomyService(
      database,
      HOUSEHOLD_ID,
      robot,
      mapping,
    );

    const state = await autonomy.start({
      powerPercent: 20,
      steeringTrimPercent: 2,
    });
    expect(state.operatingMode).toBe('autonomous');
    expect(mapping.snapshot().mapping.status).toBe('recording');
    const status = autonomy.status();
    expect(status.status).toBe('exploring');
    expect(status.availableActions).toContain('wait_observe');
    expect(
      status.availableActions.some((action) => action.startsWith('look_')),
    ).toBe(true);
    expect(
      status.availableActions.some((action) => action.startsWith('forward_')),
    ).toBe(false);

    await autonomy.stop();
    expect(autonomy.status().status).toBe('inactive');
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS count FROM robot_navigation_policies')
          .get() as { count: number }
      ).count,
    ).toBe(1);
  });

  it('closes active persisted runs instead of resuming after hub restart', () => {
    const database = openDatabase(':memory:');
    const robot = new SimulatedRobotController();
    closeCallbacks.push(async () => {
      await robot.close();
      database.close();
    });
    const mapping = new RobotMappingService(database, HOUSEHOLD_ID);
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO robot_autonomy_runs(
           id, household_id, status, goal, initial_power_percent,
           steering_trim_percent, started_at, updated_at
         ) VALUES (?, ?, 'exploring', 'explore_frontier', 20, 0, ?, ?)`,
      )
      .run(crypto.randomUUID(), HOUSEHOLD_ID, now, now);

    const autonomy = new RobotAutonomyService(
      database,
      HOUSEHOLD_ID,
      robot,
      mapping,
    );
    expect(autonomy.status().status).toBe('inactive');
    expect(
      database
        .prepare('SELECT status, stop_reason FROM robot_autonomy_runs')
        .get(),
    ).toMatchObject({ status: 'completed', stop_reason: 'hub_restart' });
  });
});
