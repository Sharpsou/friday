import { afterEach, describe, expect, it } from 'vitest';

import type { RobotDriveRequest, RobotState } from '@friday/contracts';

import { openDatabase } from '../db/database.js';
import { RobotMappingError, RobotMappingService } from './robot-mapping.js';

const HOUSEHOLD = '1030b4f6-1e0f-48fa-adab-865750ce597d';

function state(frameId = 1): RobotState {
  const now = new Date();
  return {
    available: true,
    connected: true,
    armed: true,
    mode: 'simulated',
    cameraAvailable: true,
    actuators: { wheelsEnabled: true, cameraServosEnabled: true },
    moving: false,
    lastSeenAt: now.toISOString(),
    warning: null,
    capabilities: ['teleop', 'camera_stream', 'camera_look', 'vision_objects'],
    operatingMode: 'manual',
    controlExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    cameraPose: { pan: 0, tilt: 0.2 },
    telemetry: {
      temperatureC: 45,
      throttledCode: '0x0',
      underVoltageActive: false,
      underVoltageOccurred: false,
      irLeftClear: true,
      irRightClear: true,
      lineSensors: [0, 0, 0, 0, 0],
      cameraFps: 10,
      commandLatencyMs: 10,
    },
    vision: {
      frameId,
      observedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      imageWidth: 640,
      imageHeight: 480,
      processingMs: 20,
      detections: [],
    },
  };
}

function drive(direction: RobotDriveRequest['direction']): RobotDriveRequest {
  const now = Date.now();
  return {
    commandId: crypto.randomUUID(),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 350).toISOString(),
    direction,
    intensity: 0.2,
    steering: 0,
    maxDurationMs: 350,
  };
}

describe('RobotMappingService', () => {
  const databases: ReturnType<typeof openDatabase>[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('records compact geometry without persisting camera images', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const mapping = new RobotMappingService(database, HOUSEHOLD);

    expect(mapping.start(state()).mapping.status).toBe('recording');
    for (let index = 0; index < 8; index += 1)
      mapping.recordDrive(drive('forward'), state(index + 2));
    const snapshot = mapping.stop();

    expect(snapshot.paths[0]?.points.length).toBeGreaterThan(1);
    expect(snapshot.localization.pose.x).toBeGreaterThan(0);
    expect(snapshot.mapping.storageBytes).toBeLessThan(10_000);
    const columns = database
      .prepare("SELECT name FROM pragma_table_info('robot_map_points')")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(['image', 'jpeg', 'thumbnail']),
    );
  });

  it('pauses an interrupted recording after a hub restart', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    new RobotMappingService(database, HOUSEHOLD).start(state());

    const resumed = new RobotMappingService(database, HOUSEHOLD).snapshot();

    expect(resumed.mapping.status).toBe('paused');
  });

  it('keeps autonomous mode and mission previews fail-closed', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const mapping = new RobotMappingService(database, HOUSEHOLD);
    const started = mapping.start(state());
    const pointId = started.paths[0]?.points[0]?.id;
    expect(pointId).toBeTruthy();

    expect(() => mapping.setMode('autonomous')).not.toThrow();
    expect(mapping.snapshot().operatingMode).toBe('autonomous');
    expect(
      mapping.previewMission(pointId ?? crypto.randomUUID()),
    ).toMatchObject({ allowed: false });
    expect(mapping.previewMission(crypto.randomUUID())).toMatchObject({
      allowed: false,
    });
  });

  it('unlocks a destination only after a completed map has enough geometry', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const mapping = new RobotMappingService(database, HOUSEHOLD);
    mapping.start(state());
    for (let index = 0; index < 200; index += 1)
      mapping.recordDrive(drive('forward'), state(index + 2));
    const completed = mapping.stop();
    const pointId = completed.paths[0]?.points.at(-1)?.id;

    expect(completed.paths[0]?.points.length).toBeGreaterThanOrEqual(20);
    expect(
      mapping.previewMission(pointId ?? crypto.randomUUID()),
    ).toMatchObject({
      allowed: true,
      blockedReason: null,
    });
    expect(
      mapping.navigationTarget(pointId ?? crypto.randomUUID()),
    ).toMatchObject({
      id: pointId,
    });
  });

  it('requires the safe central camera preset for Carto', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const mapping = new RobotMappingService(database, HOUSEHOLD);
    const unsafeCamera = state();
    unsafeCamera.cameraPose.pan = 0.5;

    expect(() => mapping.start(unsafeCamera)).toThrowError(RobotMappingError);
    expect(mapping.snapshot().mapping.status).toBe('inactive');
  });
});
