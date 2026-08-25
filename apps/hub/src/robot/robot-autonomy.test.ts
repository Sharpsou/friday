import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RobotDriveRequest } from '@friday/contracts';

import { openDatabase } from '../db/database.js';
import {
  RobotAutonomyService,
  cameraQualityReward,
  manualDriveAction,
} from './robot-autonomy.js';
import { RobotMappingService } from './robot-mapping.js';
import { SimulatedRobotController } from './robot-controller.js';

const HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';

class UnderVoltageRobotController extends SimulatedRobotController {
  override async state() {
    const state = await super.state();
    return {
      ...state,
      telemetry: {
        ...state.telemetry,
        throttledCode: '0x50005',
        underVoltageActive: true,
        underVoltageOccurred: true,
      },
    };
  }
}

class RecoverableRobotController extends SimulatedRobotController {
  private recovered = false;

  override async state() {
    const state = await super.state();
    return {
      ...state,
      telemetry: {
        ...state.telemetry,
        irLeftClear: this.recovered,
        irRightClear: true,
      },
    };
  }

  override async drive(command: RobotDriveRequest) {
    await super.drive(command);
    if ((await super.state()).operatingMode === 'manual')
      this.recovered = command.direction === 'right';
    return this.state();
  }
}

function manualCommand(
  direction: RobotDriveRequest['direction'],
  steering = 0,
): RobotDriveRequest {
  const now = Date.now();
  return {
    commandId: crypto.randomUUID(),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 1_000).toISOString(),
    direction,
    intensity: 0.2,
    steering,
    maxDurationMs: 350,
  };
}

describe('RobotAutonomyService', () => {
  const closeCallbacks: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const close of closeCallbacks.splice(0).reverse()) await close();
  });

  it('rewards an informative new camera viewpoint over a repeated one', async () => {
    const robot = new SimulatedRobotController();
    closeCallbacks.push(() => robot.close());
    const state = await robot.state();

    expect(
      cameraQualityReward('look_up_left', state, 2, 3, 1, true),
    ).toBeGreaterThan(
      cameraQualityReward('look_up_left', state, 3, 3, 6, true),
    );
    expect(
      cameraQualityReward('forward_10_straight', state, 2, 3, 1, true),
    ).toBe(0);
    expect(cameraQualityReward('look_up', state, 2, 2, 1, false)).toBeLessThan(
      0,
    );
  });

  it('maps a manual joystick command into the bounded autonomous action space', () => {
    expect(manualDriveAction(manualCommand('left'))).toBe('turn_left');
    expect(manualDriveAction(manualCommand('right'))).toBe('turn_right');
    expect(manualDriveAction(manualCommand('backward', 0.4))).toBe(
      'reverse_escape',
    );
    expect(manualDriveAction(manualCommand('forward', -0.4))).toBe(
      'forward_20_left',
    );
    expect(manualDriveAction(manualCommand('forward', 0.4))).toBe(
      'forward_20_right',
    );
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

  it('keeps learning and camera exploration active when the Pi voltage bit is set', async () => {
    const database = openDatabase(':memory:');
    const robot = new UnderVoltageRobotController();
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

    await autonomy.start({ powerPercent: 20, steeringTrimPercent: 0 });
    await vi.waitFor(() =>
      expect(autonomy.status().episodeCount).toBeGreaterThan(0),
    );
    expect(autonomy.status()).toMatchObject({ status: 'exploring' });
    expect(
      autonomy
        .journal()
        .entries.some((entry) => entry.message.includes('Sous-tension')),
    ).toBe(false);

    await autonomy.stop();
  });

  it('learns a successful explicit Récup demonstration when autonomy resumes', async () => {
    const database = openDatabase(':memory:');
    const robot = new SimulatedRobotController();
    closeCallbacks.push(async () => {
      await robot.close();
      database.close();
    });
    await robot.setActuators({
      wheelsEnabled: true,
      cameraServosEnabled: true,
    });
    const mapping = new RobotMappingService(database, HOUSEHOLD_ID);
    const autonomy = new RobotAutonomyService(
      database,
      HOUSEHOLD_ID,
      robot,
      mapping,
    );

    await autonomy.start({ powerPercent: 20, steeringTrimPercent: 0 });
    const manual = await autonomy.beginHumanRecovery();
    expect(manual.operatingMode).toBe('manual');
    expect(autonomy.status().humanRecovery).toMatchObject({
      explicit: true,
      commandCount: 0,
    });
    await robot.arm(5_000);
    const command = manualCommand('left');
    const moved = await robot.drive(command);
    mapping.recordDrive(command, moved);
    autonomy.observeManualDrive(command, moved);
    expect(autonomy.status().humanRecovery?.commandCount).toBe(1);

    await autonomy.start({ powerPercent: 20, steeringTrimPercent: 0 });

    expect(
      database
        .prepare(
          `SELECT trigger_kind, status, command_count, reason
             FROM robot_human_recovery_demonstrations`,
        )
        .get(),
    ).toEqual({
      trigger_kind: 'explicit_recovery',
      status: 'applied',
      command_count: 1,
      reason: 'explicit_repositioning',
    });
    expect(
      autonomy
        .journal()
        .entries.some((entry) =>
          entry.message.includes('Démonstration Récup apprise'),
        ),
    ).toBe(true);
    expect(autonomy.status().humanRecovery).toBeNull();
    await autonomy.stop();
  });

  it('does not learn Récup when the user returns autonomy without moving', async () => {
    const database = openDatabase(':memory:');
    const robot = new SimulatedRobotController();
    closeCallbacks.push(async () => {
      await robot.close();
      database.close();
    });
    await robot.setActuators({
      wheelsEnabled: true,
      cameraServosEnabled: true,
    });
    const mapping = new RobotMappingService(database, HOUSEHOLD_ID);
    const autonomy = new RobotAutonomyService(
      database,
      HOUSEHOLD_ID,
      robot,
      mapping,
    );

    await autonomy.start({ powerPercent: 20, steeringTrimPercent: 0 });
    await autonomy.beginHumanRecovery();
    await autonomy.start({ powerPercent: 20, steeringTrimPercent: 0 });

    expect(
      database
        .prepare(
          `SELECT status, reason
             FROM robot_human_recovery_demonstrations`,
        )
        .get(),
    ).toEqual({ status: 'rejected', reason: 'no_manual_motion' });
    await autonomy.stop();
  });

  it('learns an implicit Manual takeover only when sensors confirm recovery', async () => {
    const database = openDatabase(':memory:');
    const robot = new RecoverableRobotController();
    closeCallbacks.push(async () => {
      await robot.close();
      database.close();
    });
    await robot.setActuators({
      wheelsEnabled: true,
      cameraServosEnabled: true,
    });
    const mapping = new RobotMappingService(database, HOUSEHOLD_ID);
    const autonomy = new RobotAutonomyService(
      database,
      HOUSEHOLD_ID,
      robot,
      mapping,
    );

    await autonomy.start({ powerPercent: 20, steeringTrimPercent: 0 });
    await autonomy.stop('manual_mode');
    await robot.arm(5_000);
    const command = manualCommand('right');
    const moved = await robot.drive(command);
    mapping.recordDrive(command, moved);
    autonomy.observeManualDrive(command, moved);
    await autonomy.start({ powerPercent: 20, steeringTrimPercent: 0 });

    expect(
      database
        .prepare(
          `SELECT trigger_kind, status, reason
             FROM robot_human_recovery_demonstrations`,
        )
        .get(),
    ).toEqual({
      trigger_kind: 'manual_takeover',
      status: 'applied',
      reason: 'obstacle_cleared',
    });
    await autonomy.stop();
  });
});
