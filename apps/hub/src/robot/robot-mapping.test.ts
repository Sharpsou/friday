import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RobotDriveRequest, RobotState } from '@friday/contracts';

import { openDatabase } from '../db/database.js';
import type {
  RobotPlaceCandidate,
  RobotPlaceRecognitionEngine,
  RobotPlaceSignatureFeatures,
} from './robot-localization-engine.js';
import {
  RobotMappingError,
  RobotMappingService,
  relaxPoseGraph,
  type PoseGraphConstraint,
  type PoseGraphRow,
} from './robot-mapping.js';

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

const FEATURES: RobotPlaceSignatureFeatures = {
  descriptors: Buffer.alloc(50 * 32, 7).toString('base64'),
  featureCount: 50,
  keypoints: Array.from(
    { length: 50 },
    (_, index) =>
      [(index % 10) / 10, Math.floor(index / 10) / 5, 0] as [
        number,
        number,
        number,
      ],
  ),
  perceptualHash: '0123456789abcdef',
  quality: 120,
};

class MatchingPlaceEngine implements RobotPlaceRecognitionEngine {
  async extract(): Promise<RobotPlaceSignatureFeatures> {
    return FEATURES;
  }

  async match(
    _probe: RobotPlaceSignatureFeatures,
    candidates: RobotPlaceCandidate[],
  ) {
    return candidates.map((candidate) => ({
      candidateId: candidate.id,
      coverage: 4,
      inlierRatio: 0.75,
      inliers: 35,
      rawMatches: 42,
      rotationRad: 0,
      score: 0.9,
    }));
  }

  async close(): Promise<void> {}
}

class ChangingPlaceEngine extends MatchingPlaceEngine {
  private extractionCount = 0;

  override async extract(): Promise<RobotPlaceSignatureFeatures> {
    this.extractionCount += 1;
    return {
      ...FEATURES,
      perceptualHash:
        this.extractionCount === 1
          ? FEATURES.perceptualHash
          : 'fedcba9876543210',
    };
  }

  override async match() {
    return [];
  }
}

describe('RobotMappingService', () => {
  const databases: ReturnType<typeof openDatabase>[] = [];

  afterEach(() => {
    vi.useRealTimers();
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

  it('records distinct camera viewpoints as map directions, not extra path points', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const mapping = new RobotMappingService(database, HOUSEHOLD);
    mapping.start(state());
    const left = state(2);
    left.cameraPose = { pan: 0.7, tilt: -0.1 };
    mapping.observe(left);
    const down = state(3);
    down.cameraPose = { pan: 0, tilt: 0.6 };
    mapping.observe(down);

    const snapshot = mapping.snapshot();
    expect(snapshot.viewpoints).toHaveLength(2);
    expect(snapshot.viewpoints.map((viewpoint) => viewpoint.pan)).toEqual(
      expect.arrayContaining([0.7, 0]),
    );
    expect(snapshot.paths[0]?.points).toHaveLength(1);
  });

  it('does not persist map observations without an active Carto session', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const mapping = new RobotMappingService(database, HOUSEHOLD);

    mapping.observe(state(2));

    expect(mapping.snapshot().mapping.status).toBe('inactive');
    expect(mapping.snapshot().viewpoints).toHaveLength(0);
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS count FROM robot_map_cells')
          .get() as { count: number }
      ).count,
    ).toBe(0);
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

  it('creates a disconnected segment when two known views confirm a manual move', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    const database = openDatabase(':memory:');
    databases.push(database);
    const mapping = new RobotMappingService(database, HOUSEHOLD, {
      placeRecognition: new MatchingPlaceEngine(),
    });
    const first = state(1);
    first.vision!.observedAt = new Date(Date.now() - 3_000).toISOString();
    mapping.start(first);
    mapping.observe(first, {
      frameId: 1,
      image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      observedAt: first.vision!.observedAt,
    });
    await mapping.waitForLocalization();
    const originalSegment = mapping.snapshot().paths[0]!.points[0]!.segmentId;

    database
      .prepare(
        `UPDATE robot_place_signatures SET map_x = 2, map_y = 1
          WHERE household_id = ?`,
      )
      .run(HOUSEHOLD);
    for (const frameId of [2, 3]) {
      vi.advanceTimersByTime(2_100);
      const moved = state(frameId);
      moved.vision!.observedAt = new Date(
        Date.now() + frameId * 600,
      ).toISOString();
      mapping.observe(moved, {
        frameId,
        image: Buffer.from([0xff, 0xd8, frameId, 0xff, 0xd9]),
        observedAt: moved.vision!.observedAt,
      });
      await mapping.waitForLocalization();
      expect(mapping.snapshot().visualMemory.signatureCount).toBe(1);
    }

    const snapshot = mapping.snapshot();
    expect(snapshot.localization.source).toBe('visual_relocalization');
    expect(snapshot.localization.pose).toMatchObject({ x: 2, y: 1 });
    expect(snapshot.paths[0]!.points.at(-1)!.segmentId).not.toBe(
      originalSegment,
    );
    expect(snapshot.localizationEvents[0]).toMatchObject({
      kind: 'manual_relocation',
    });
    vi.useRealTimers();
  });

  it('relaxes a visual loop while preserving the first pose anchor', () => {
    const rows: PoseGraphRow[] = [
      {
        id: 'start',
        session_id: 'session',
        sequence: 0,
        segment_id: 'segment',
        x: 0,
        y: 0,
        heading: 0,
        raw_x: 0,
        raw_y: 0,
        raw_heading: 0,
        direction: null,
      },
      {
        id: 'end',
        session_id: 'session',
        sequence: 1,
        segment_id: 'segment',
        x: 1,
        y: 0.4,
        heading: 0.3,
        raw_x: 1,
        raw_y: 0.4,
        raw_heading: 0.3,
        direction: 'forward',
      },
    ];
    const constraints: PoseGraphConstraint[] = [
      {
        sourceId: 'start',
        targetId: 'end',
        dx: 0,
        dy: 0,
        dheading: 0,
        weight: 2,
      },
    ];

    const optimized = relaxPoseGraph(rows, constraints, 30);

    expect(optimized.get('start')).toMatchObject({ x: 0, y: 0, heading: 0 });
    expect(
      Math.hypot(optimized.get('end')!.x, optimized.get('end')!.y),
    ).toBeLessThan(0.05);
    expect(Math.abs(optimized.get('end')!.heading)).toBeLessThan(0.05);
  });

  it('detects a physical scene jump without storing images seen while carried', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T13:00:00.000Z'));
    const database = openDatabase(':memory:');
    databases.push(database);
    const mapping = new RobotMappingService(database, HOUSEHOLD, {
      placeRecognition: new ChangingPlaceEngine(),
    });
    mapping.start(state(1));
    mapping.observe(state(1), {
      frameId: 1,
      image: Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]),
      observedAt: new Date().toISOString(),
    });
    await mapping.waitForLocalization();

    for (const frameId of [2, 3]) {
      vi.advanceTimersByTime(2_100);
      mapping.observe(state(frameId), {
        frameId,
        image: Buffer.from([0xff, 0xd8, frameId, 0xff, 0xd9]),
        observedAt: new Date().toISOString(),
      });
      await mapping.waitForLocalization();
    }

    const snapshot = mapping.snapshot();
    expect(snapshot.localization.status).toBe('relocalizing');
    expect(snapshot.visualMemory.signatureCount).toBe(1);
    expect(snapshot.localizationEvents[0]?.reason).toContain(
      'déplacement physique probable',
    );
  });
});
