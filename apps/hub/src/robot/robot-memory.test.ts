import { describe, expect, it } from 'vitest';

import type { RobotState } from '@friday/contracts';

import { openDatabase } from '../db/database.js';
import { RobotMappingService } from './robot-mapping.js';
import { RobotMemoryService } from './robot-memory.js';

describe('RobotMemoryService', () => {
  it('requires repeated high-confidence viewpoints before confirming an object', () => {
    const database = openDatabase(':memory:');
    const memory = new RobotMemoryService(database, 'household-test');
    const now = Date.now();
    memory.observe(state(1, now, 0), null, true);
    memory.observe(state(2, now + 5_000, 0), null, true);
    expect(memory.summary().entities[0]?.status).toBe('candidate');
    memory.observe(state(3, now + 5_010, 0.7), null, true);
    const entity = memory.summary().entities[0];
    expect(entity?.status).toBe('confirmed');
    expect(entity?.sightingCount).toBe(3);
    expect(entity?.classLabel).toBe('chaise');
    database.close();
  });

  it('keeps people anonymous and separate from remembered objects', () => {
    const database = openDatabase(':memory:');
    const memory = new RobotMemoryService(database, 'household-test');
    const now = Date.now();
    const next = state(1, now, 0);
    next.vision!.detections = [
      {
        confidence: 0.9,
        height: 0.5,
        id: 'person-1',
        kind: 'person',
        label: 'Personne',
        trackId: null,
        width: 0.3,
        x: 0.2,
        y: 0.2,
      },
    ];
    memory.observe(next, null, true);
    const summary = memory.summary();
    expect(summary.entities).toHaveLength(0);
    expect(summary.anonymousPresence.active).toBe(true);
    database.close();
  });

  it('keeps one bounded image-key linked to a confirmed mapped object', () => {
    const database = openDatabase(':memory:');
    const household = 'household-test';
    const memory = new RobotMemoryService(database, household);
    const mapping = new RobotMappingService(database, household);
    const now = Date.now();
    const first = state(1, now, 0);
    mapping.start(first);
    memory.observe(first, jpeg(1), true);
    memory.observe(state(2, now + 5_000, 0), jpeg(2), true);
    const confirmed = state(3, now + 5_010, 0.5);
    confirmed.vision!.detections[0]!.x = 0;
    memory.observe(confirmed, jpeg(3), true);
    mapping.observe(confirmed);

    const snapshot = mapping.snapshot();
    expect(snapshot.visualMemory).toMatchObject({ keyframeCount: 1 });
    expect(snapshot.visualMemory.storageBytes).toBeLessThan(1_024);
    expect(snapshot.objects[0]).toMatchObject({
      sightingCount: 3,
      viewpointCount: 2,
    });
    const keyframeId = snapshot.objects[0]?.keyframeId;
    expect(keyframeId).toBeTruthy();
    expect(memory.keyframe(keyframeId ?? '')?.image).toEqual(jpeg(3).image);
    database.close();
  });

  it('never persists a visual keyframe when a person is in the image', () => {
    const database = openDatabase(':memory:');
    const household = 'household-test';
    const memory = new RobotMemoryService(database, household);
    const mapping = new RobotMappingService(database, household);
    const now = Date.now();
    const first = state(1, now, 0);
    mapping.start(first);
    memory.observe(first, jpeg(1), true);
    memory.observe(state(2, now + 5_000, 0), jpeg(2), true);
    const mixed = state(3, now + 5_010, 0.5);
    mixed.vision!.detections[0]!.x = 0;
    mixed.vision!.detections.push({
      confidence: 0.9,
      height: 0.5,
      id: 'person-3',
      kind: 'person',
      label: 'Personne',
      trackId: null,
      width: 0.3,
      x: 0.6,
      y: 0.2,
    });
    memory.observe(mixed, jpeg(3), true);

    expect(mapping.snapshot().visualMemory.keyframeCount).toBe(0);
    database.close();
  });

  it('does not persist live recognition while capture is disabled', () => {
    const database = openDatabase(':memory:');
    const memory = new RobotMemoryService(database, 'household-test');

    memory.observe(state(1, Date.now(), 0));

    expect(memory.summary().entities).toHaveLength(0);
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS count FROM robot_memory_observations')
          .get() as { count: number }
      ).count,
    ).toBe(0);
    database.close();
  });

  it('samples a repeated object instead of recording every camera frame', () => {
    const database = openDatabase(':memory:');
    const memory = new RobotMemoryService(database, 'household-test');
    const now = Date.now();

    memory.observe(state(1, now, 0), null, true);
    memory.observe(state(2, now + 100, 0), null, true);

    expect(memory.summary().entities[0]?.sightingCount).toBe(1);
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS count FROM robot_memory_observations')
          .get() as { count: number }
      ).count,
    ).toBe(1);
    database.close();
  });
});

function jpeg(frameId: number) {
  return {
    frameId,
    image: Buffer.from([0xff, 0xd8, frameId, 0xff, 0xd9]),
    observedAt: new Date().toISOString(),
  };
}

function state(frameId: number, now: number, pan: number): RobotState {
  return {
    actuators: { cameraServosEnabled: false, wheelsEnabled: false },
    armed: false,
    available: true,
    cameraAvailable: true,
    cameraPose: { pan, tilt: 0.2 },
    capabilities: ['camera_stream', 'vision_objects', 'vision_people'],
    connected: true,
    controlExpiresAt: null,
    lastSeenAt: new Date(now).toISOString(),
    mode: 'alphabot2',
    moving: false,
    operatingMode: 'manual',
    telemetry: {
      cameraFps: 15,
      commandLatencyMs: 2,
      irLeftClear: true,
      irRightClear: true,
      lineSensors: [0, 0, 0, 0, 0],
      temperatureC: 45,
      throttledCode: '0x0',
      underVoltageActive: false,
      underVoltageOccurred: false,
    },
    vision: {
      detections: [
        {
          confidence: 0.9,
          height: 0.4,
          id: `chair-${frameId.toString()}`,
          kind: 'object',
          label: 'Chaise',
          trackId: null,
          width: 0.3,
          x: 0.2,
          y: 0.3,
        },
      ],
      expiresAt: new Date(now + 60_000).toISOString(),
      frameId,
      imageHeight: 480,
      imageWidth: 640,
      observedAt: new Date(now).toISOString(),
      processingMs: 120,
    },
    warning: null,
  };
}
