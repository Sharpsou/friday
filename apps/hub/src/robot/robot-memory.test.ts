import { describe, expect, it } from 'vitest';

import type { RobotState } from '@friday/contracts';

import { openDatabase } from '../db/database.js';
import { RobotMemoryService } from './robot-memory.js';

describe('RobotMemoryService', () => {
  it('requires repeated high-confidence viewpoints before confirming an object', () => {
    const database = openDatabase(':memory:');
    const memory = new RobotMemoryService(database, 'household-test');
    const now = Date.now();
    memory.observe(state(1, now, 0));
    memory.observe(state(2, now + 10, 0));
    expect(memory.summary().entities[0]?.status).toBe('candidate');
    memory.observe(state(3, now + 20, 0.7));
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
    memory.observe(next);
    const summary = memory.summary();
    expect(summary.entities).toHaveLength(0);
    expect(summary.anonymousPresence.active).toBe(true);
    database.close();
  });
});

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
