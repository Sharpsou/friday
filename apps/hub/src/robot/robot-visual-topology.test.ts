import { afterEach, describe, expect, it } from 'vitest';

import type { RobotState } from '@friday/contracts';

import { openDatabase } from '../db/database.js';
import type {
  RobotPlaceCandidate,
  RobotPlaceRecognitionEngine,
  RobotPlaceSignatureFeatures,
  RobotVisualMotionFeatures,
} from './robot-place-recognition.js';
import {
  classifyVisualMotion,
  hammingDistance,
  isAcceptedPlaceMatch,
  isUsableVisual,
  RobotVisualTopologyService,
} from './robot-visual-topology.js';

const HOUSEHOLD = '1030b4f6-1e0f-48fa-adab-865750ce597d';
const FEATURES: RobotPlaceSignatureFeatures = {
  descriptors: Buffer.alloc(50 * 32, 7).toString('base64'),
  featureCount: 50,
  keypoints: Array.from({ length: 50 }, (_, index) => [
    (index % 10) / 10,
    Math.floor(index / 10) / 5,
    0,
  ]),
  luminance: 90,
  perceptualHash: '0123456789abcdef',
  quality: 120,
};
const STATIONARY: RobotVisualMotionFeatures = {
  coherence: 0.9,
  medianFlowPx: 0.1,
  rotationRad: 0,
  scaleDelta: 0,
  trackCount: 50,
};

class MatchingEngine implements RobotPlaceRecognitionEngine {
  features = FEATURES;
  matchScore = 0.9;
  motionFeatures = STATIONARY;
  recognizeCandidates = true;

  async extract() {
    return this.features;
  }

  async match(
    _probe: RobotPlaceSignatureFeatures,
    candidates: RobotPlaceCandidate[],
  ) {
    if (!this.recognizeCandidates) return [];
    return candidates.map((candidate) => ({
      candidateId: candidate.id,
      coverage: 4,
      inlierRatio: 0.75,
      inliers: 35,
      rawMatches: 42,
      rotationRad: 0,
      score: this.matchScore,
    }));
  }

  async motion() {
    return this.motionFeatures;
  }

  async close() {}
}

function state(
  frameId: number,
  observedAt: string,
  options: { objectVisible?: boolean; pan?: number; person?: boolean } = {},
): RobotState {
  return {
    available: true,
    connected: true,
    armed: true,
    mode: 'simulated',
    cameraAvailable: true,
    actuators: { cameraServosEnabled: true, wheelsEnabled: true },
    moving: false,
    lastSeenAt: observedAt,
    warning: null,
    capabilities: ['teleop', 'camera_stream', 'camera_look', 'vision_objects'],
    operatingMode: 'manual',
    controlExpiresAt: null,
    cameraPose: { pan: options.pan ?? 0, tilt: 0.2 },
    telemetry: {
      cameraFps: 10,
      commandLatencyMs: 5,
      irLeftClear: true,
      irRightClear: true,
      lineSensors: [0, 0, 0, 0, 0],
      temperatureC: 40,
      throttledCode: '0x0',
      underVoltageActive: false,
      underVoltageOccurred: false,
    },
    vision: {
      detections: [
        ...(options.objectVisible === false
          ? []
          : [
              {
                confidence: 0.9,
                height: 0.2,
                id: `object-${frameId.toString()}`,
                kind: 'object' as const,
                label: 'Chaise',
                trackId: null,
                width: 0.2,
                x: 0.2,
                y: 0.2,
              },
            ]),
        ...(options.person
          ? [
              {
                confidence: 0.9,
                height: 0.4,
                id: `person-${frameId.toString()}`,
                kind: 'person' as const,
                label: 'Personne',
                trackId: null,
                width: 0.2,
                x: 0.5,
                y: 0.2,
              },
            ]
          : []),
      ],
      expiresAt: new Date(Date.parse(observedAt) + 1_000).toISOString(),
      frameId,
      imageHeight: 480,
      imageWidth: 640,
      observedAt,
      processingMs: 20,
    },
  };
}

async function observeFrames(
  topology: RobotVisualTopologyService,
  fromFrame: number,
  count: number,
  options: { objectVisible?: boolean; person?: boolean } = {},
) {
  const origin = Date.parse('2026-08-26T10:00:00.000Z');
  for (let offset = 0; offset < count; offset += 1) {
    const frameId = fromFrame + offset;
    const observedAt = new Date(origin + frameId * 300).toISOString();
    await topology.observe(state(frameId, observedAt, options), {
      frameId,
      image: Buffer.from(`jpeg-${frameId.toString()}`),
      observedAt,
    });
  }
}

function insertPlace(
  database: ReturnType<typeof openDatabase>,
  id: string,
  panorama: 'absent' | 'complete' | 'incomplete' = 'complete',
) {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO robot_visual_places(
         id, household_id, status, confidence, observation_count,
         panorama_status, first_seen_at, last_seen_at, updated_at
       ) VALUES (?, ?, 'confirmed', 0.9, 3, ?, ?, ?, ?)`,
    )
    .run(id, HOUSEHOLD, panorama, now, now, now);
}

describe('RobotVisualTopologyService', () => {
  const databases: ReturnType<typeof openDatabase>[] = [];
  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  it('creates one stable anchor instead of one UUID per frame', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const topology = new RobotVisualTopologyService(
      database,
      HOUSEHOLD,
      new MatchingEngine(),
    );

    await observeFrames(topology, 1, 12);

    expect(topology.snapshot()).toMatchObject({
      places: [
        expect.objectContaining({
          status: 'confirmed',
          panoramaStatus: 'absent',
          viewCount: 1,
          objectCount: 1,
        }),
      ],
      transitions: [],
    });
  });

  it('does not create a new anchor from unmatched stationary frames without translation', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const engine = new MatchingEngine();
    const topology = new RobotVisualTopologyService(
      database,
      HOUSEHOLD,
      engine,
    );
    await observeFrames(topology, 1, 10);
    engine.recognizeCandidates = false;
    engine.features = { ...FEATURES, perceptualHash: 'fedcba9876543210' };

    await observeFrames(topology, 20, 20);

    expect(topology.snapshot().places).toHaveLength(1);
    expect(topology.snapshot().transitions).toEqual([]);
  });

  it('can establish a new anchor after translation while initially unlocalized', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const initial = new RobotVisualTopologyService(
      database,
      HOUSEHOLD,
      new MatchingEngine(),
    );
    await observeFrames(initial, 1, 10);

    const engine = new MatchingEngine();
    engine.recognizeCandidates = false;
    engine.features = { ...FEATURES, perceptualHash: 'fedcba9876543210' };
    const relocated = new RobotVisualTopologyService(
      database,
      HOUSEHOLD,
      engine,
    );
    await observeFrames(relocated, 20, 1);
    relocated.recordDriveCommand('forward');
    engine.motionFeatures = { ...STATIONARY, medianFlowPx: 8 };
    await observeFrames(relocated, 21, 1);
    engine.motionFeatures = STATIONARY;
    await observeFrames(relocated, 22, 8);

    expect(relocated.snapshot().places).toHaveLength(2);
    expect(relocated.snapshot().transitions).toEqual([]);
  });

  it('treats camera and body rotations as views rather than translations', () => {
    expect(classifyVisualMotion(STATIONARY, true, null)).toBe(
      'camera_rotation',
    );
    expect(
      classifyVisualMotion(
        { ...STATIONARY, medianFlowPx: 4, rotationRad: 0.1 },
        false,
        'left',
      ),
    ).toBe('body_rotation');
    expect(
      classifyVisualMotion(
        { ...STATIONARY, medianFlowPx: 4 },
        false,
        'forward',
      ),
    ).toBe('translation');
  });

  it('closes a bounded panorama only after six stable sectors and visual return', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const engine = new MatchingEngine();
    const topology = new RobotVisualTopologyService(
      database,
      HOUSEHOLD,
      engine,
    );
    await observeFrames(topology, 1, 10);
    engine.recognizeCandidates = false;
    for (let sector = 0; sector < 6; sector += 1) {
      engine.features = {
        ...FEATURES,
        perceptualHash: sector.toString(16).repeat(16),
      };
      await observeFrames(topology, 20 + sector, 1);
      expect((await topology.captureStablePanoramaSector()).complete).toBe(
        false,
      );
    }
    engine.recognizeCandidates = true;
    engine.features = FEATURES;
    await observeFrames(topology, 40, 3);

    const closed = await topology.captureStablePanoramaSector();

    expect(closed).toMatchObject({ complete: true, sectorCount: 6 });
    expect(topology.snapshot().places[0]?.panoramaStatus).toBe('complete');
    expect(topology.snapshot().sectors).toHaveLength(6);
  });

  it('uses a recurring start object to corroborate a weaker visual loop closure', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const engine = new MatchingEngine();
    const topology = new RobotVisualTopologyService(
      database,
      HOUSEHOLD,
      engine,
    );
    await observeFrames(topology, 1, 10);
    topology.beginPanoramaSession();
    engine.recognizeCandidates = false;
    for (let sector = 0; sector < 6; sector += 1) {
      engine.features = {
        ...FEATURES,
        perceptualHash: sector.toString(16).repeat(16),
      };
      await observeFrames(topology, 20 + sector, 1);
      await topology.captureStablePanoramaSector();
    }
    engine.recognizeCandidates = true;
    engine.matchScore = 0.62;
    engine.features = FEATURES;
    await observeFrames(topology, 40, 1);

    expect(await topology.captureStablePanoramaSector()).toMatchObject({
      complete: true,
      sectorCount: 6,
    });
  });

  it('closes on a strong perceptual return even when ORB and objects are absent', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const engine = new MatchingEngine();
    const topology = new RobotVisualTopologyService(
      database,
      HOUSEHOLD,
      engine,
    );
    await observeFrames(topology, 1, 10, { objectVisible: false });
    topology.beginPanoramaSession();
    engine.recognizeCandidates = false;
    for (let sector = 0; sector < 6; sector += 1) {
      engine.features = {
        ...FEATURES,
        perceptualHash:
          sector === 0
            ? FEATURES.perceptualHash
            : sector.toString(16).repeat(16),
      };
      await observeFrames(topology, 20 + sector, 1, {
        objectVisible: false,
      });
      await topology.captureStablePanoramaSector();
    }
    engine.features = FEATURES;
    await observeFrames(topology, 40, 1, { objectVisible: false });

    expect(await topology.captureStablePanoramaSector()).toMatchObject({
      complete: true,
      sectorCount: 6,
    });
  });

  it('never stores a JPEG for an anchor observed with a person', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const topology = new RobotVisualTopologyService(
      database,
      HOUSEHOLD,
      new MatchingEngine(),
    );

    await observeFrames(topology, 1, 8, { person: true });

    expect(topology.snapshot().views[0]?.hasImage).toBe(false);
  });

  it('uses only confirmed sector-aware passages for normal navigation', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const topology = new RobotVisualTopologyService(database, HOUSEHOLD);
    const first = crypto.randomUUID();
    const middle = crypto.randomUUID();
    const target = crypto.randomUUID();
    insertPlace(database, first);
    insertPlace(database, middle);
    insertPlace(database, target);
    const insert = database.prepare(
      `INSERT INTO robot_visual_transitions(
         id, household_id, from_place_id, to_place_id, direction, status,
         confidence, traversal_count, success_count, failure_count,
         motion_sequence_json, first_traversed_at, last_traversed_at
       ) VALUES (?, ?, ?, ?, 'forward', ?, 0.8, 1, 1, 0, '[]', ?, ?)`,
    );
    const now = new Date().toISOString();
    insert.run(
      crypto.randomUUID(),
      HOUSEHOLD,
      first,
      middle,
      'candidate',
      now,
      now,
    );
    insert.run(
      crypto.randomUUID(),
      HOUSEHOLD,
      middle,
      target,
      'confirmed',
      now,
      now,
    );

    expect(topology.confirmedPath(first, target)).toBeNull();
    expect(topology.validationPath(first, target)).toEqual([
      first,
      middle,
      target,
    ]);
  });

  it('forgets absorbed sector-relative routes instead of redirecting them blindly', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const topology = new RobotVisualTopologyService(database, HOUSEHOLD);
    const target = crypto.randomUUID();
    const source = crypto.randomUUID();
    const neighbor = crypto.randomUUID();
    insertPlace(database, target);
    insertPlace(database, source);
    insertPlace(database, neighbor);
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO robot_visual_transitions(
           id, household_id, from_place_id, to_place_id, direction, status,
           confidence, traversal_count, success_count, failure_count,
           motion_sequence_json, first_traversed_at, last_traversed_at
         ) VALUES (?, ?, ?, ?, 'forward', 'confirmed', 0.8, 2, 2, 0, '[]', ?, ?)`,
      )
      .run(crypto.randomUUID(), HOUSEHOLD, source, neighbor, now, now);

    const graph = await topology.mergePlaces(target, source);

    expect(graph.places.some((place) => place.id === source)).toBe(false);
    expect(graph.transitions).toEqual([]);
  });

  it('purges graph and procedural habits only on a complete reset', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const topology = new RobotVisualTopologyService(database, HOUSEHOLD);
    insertPlace(database, crypto.randomUUID());
    database
      .prepare(
        `INSERT INTO robot_habit_values(
           household_id, policy_version, context_key, action, q_value,
           visit_count, success_count, failure_count, consecutive_failures,
           information_gain_total, duration_total_ms, updated_at
         ) VALUES (?, 'topological-habits-v1', 'context', 'advance_slow',
                   1, 1, 1, 0, 0, 1, 100, ?)`,
      )
      .run(HOUSEHOLD, new Date().toISOString());

    const result = await topology.purge('all');

    expect(result.deletedPlaces).toBe(1);
    expect(result.graph.places).toEqual([]);
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM robot_habit_values')
        .get(),
    ).toEqual({ count: 0 });
  });

  it('keeps bounded visual quality and geometric thresholds', () => {
    expect(isUsableVisual(FEATURES)).toBe(true);
    expect(isUsableVisual({ ...FEATURES, luminance: 10 })).toBe(false);
    expect(isUsableVisual({ ...FEATURES, quality: 44 })).toBe(false);
    expect(
      isAcceptedPlaceMatch({
        coverage: 3,
        inlierRatio: 0.45,
        inliers: 18,
        rawMatches: 30,
      }),
    ).toBe(true);
    expect(hammingDistance('0000000000000000', '000000000000000f')).toBe(4);
  });
});
