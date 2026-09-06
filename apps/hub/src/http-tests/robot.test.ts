import { describe, expect, it, vi } from 'vitest';
import { buildHub } from '../app.js';
import { SimulatedRobotController } from '../robot/robot-controller.js';
import {
  NetworkStandbyRobotController,
  type RobotPowerClient,
} from '../robot/robot-power.js';
import { bootstrap, createHubFixtures } from './fixtures.js';
const { apps } = createHubFixtures();
describe('Friday hub robot', () => {
  it('exposes owner-only idempotent sleep and wake endpoints', async () => {
    let sleeping = false;
    const power: RobotPowerClient = {
      status: async () => ({
        powerState: sleeping ? 'sleeping' : 'awake',
        robotService: sleeping ? 'inactive' : 'active',
        cameraService: sleeping ? 'inactive' : 'active',
        updatedAt: new Date().toISOString(),
        message: null,
      }),
      sleep: async () => {
        sleeping = true;
        return power.status();
      },
      wake: async () => {
        sleeping = false;
        return power.status();
      },
    };
    const controller = new NetworkStandbyRobotController(
      new SimulatedRobotController(),
      power,
    );
    await controller.initialize();
    const app = await buildHub({
      databasePath: ':memory:',
      robotController: controller,
    });
    apps.push(app);

    expect(
      (await app.inject({ method: 'POST', url: '/api/robot/power/sleep' }))
        .statusCode,
    ).toBe(401);
    const cookie = await bootstrap(app);
    const asleep = await app.inject({
      method: 'POST',
      url: '/api/robot/power/sleep',
      headers: { cookie },
      payload: {},
    });
    expect(asleep.statusCode, asleep.body).toBe(200);
    expect(asleep.json().state).toMatchObject({
      powerState: 'sleeping',
      actuators: { wheelsEnabled: false, cameraServosEnabled: false },
    });
    const awake = await app.inject({
      method: 'POST',
      url: '/api/robot/power/wake',
      headers: { cookie },
      payload: {},
    });
    expect(awake.statusCode, awake.body).toBe(200);
    expect(awake.json().state).toMatchObject({
      powerState: 'awake',
      operatingMode: 'manual',
    });
  });
  it('keeps switched robot control authenticated, expiring and stoppable', async () => {
    const robotController = new SimulatedRobotController();
    const driveSpy = vi.spyOn(robotController, 'drive');
    const app = await buildHub({
      databasePath: ':memory:',
      robotController,
    });
    apps.push(app);
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/robot/state',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const cookie = await bootstrap(app);
    const initial = await app.inject({
      method: 'GET',
      url: '/api/robot/state',
      headers: { cookie },
    });
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json()).toMatchObject({
      available: true,
      armed: false,
      mode: 'simulated',
      actuators: { wheelsEnabled: false, cameraServosEnabled: false },
    });

    const initialDisplayPreferences = await app.inject({
      method: 'GET',
      url: '/api/robot/display-preferences',
      headers: { cookie },
    });
    expect(
      initialDisplayPreferences.statusCode,
      initialDisplayPreferences.body,
    ).toBe(200);
    expect(initialDisplayPreferences.json()).toEqual({
      recognitionVisible: true,
      updatedAt: null,
    });

    const initialControlPreferences = await app.inject({
      method: 'GET',
      url: '/api/robot/control-preferences',
      headers: { cookie },
    });
    expect(initialControlPreferences.statusCode).toBe(200);
    expect(initialControlPreferences.json()).toEqual({
      steeringTrimPercent: 0,
      updatedAt: null,
    });

    const calibratedTrim = await app.inject({
      method: 'PATCH',
      url: '/api/robot/control-preferences',
      headers: { cookie },
      payload: { steeringTrimPercent: -5 },
    });
    expect(calibratedTrim.statusCode, calibratedTrim.body).toBe(200);
    expect(calibratedTrim.json()).toMatchObject({ steeringTrimPercent: -5 });
    expect(calibratedTrim.json().updatedAt).toEqual(expect.any(String));

    const sharedControlPreferences = await app.inject({
      method: 'GET',
      url: '/api/robot/control-preferences',
      headers: { cookie },
    });
    expect(sharedControlPreferences.json()).toEqual(calibratedTrim.json());

    const initialPanoramaPreferences = await app.inject({
      method: 'GET',
      url: '/api/robot/panorama-preferences',
      headers: { cookie },
    });
    expect(initialPanoramaPreferences.statusCode).toBe(200);
    expect(initialPanoramaPreferences.json()).toMatchObject({
      panoramaPulseMs: 220,
    });

    const fasterPanorama = await app.inject({
      method: 'PATCH',
      url: '/api/robot/panorama-preferences',
      headers: { cookie },
      payload: { panoramaPulseMs: 340 },
    });
    expect(fasterPanorama.statusCode, fasterPanorama.body).toBe(200);
    expect(fasterPanorama.json()).toMatchObject({
      panoramaPulseMs: 340,
    });

    const hiddenRecognition = await app.inject({
      method: 'PATCH',
      url: '/api/robot/display-preferences',
      headers: { cookie },
      payload: { recognitionVisible: false },
    });
    expect(hiddenRecognition.statusCode, hiddenRecognition.body).toBe(200);
    expect(hiddenRecognition.json()).toMatchObject({
      recognitionVisible: false,
    });
    expect(hiddenRecognition.json().updatedAt).toEqual(expect.any(String));

    const sharedDisplayPreferences = await app.inject({
      method: 'GET',
      url: '/api/robot/display-preferences',
      headers: { cookie },
    });
    expect(sharedDisplayPreferences.json()).toEqual(hiddenRecognition.json());

    const graph = await app.inject({
      method: 'GET',
      url: '/api/robot/graph',
      headers: { cookie },
    });
    expect(graph.statusCode, graph.body).toBe(200);
    expect(graph.json()).toMatchObject({
      currentPlaceId: null,
      places: [],
      transitions: [],
    });

    const invalidPlaceRename = await app.inject({
      method: 'PATCH',
      url: `/api/robot/graph/places/${crypto.randomUUID()}`,
      headers: { cookie },
      payload: { label: ' ' },
    });
    expect(invalidPlaceRename.statusCode, invalidPlaceRename.body).toBe(400);
    expect(invalidPlaceRename.json()).toMatchObject({
      error: 'invalid_robot_visual_place',
    });

    const placeId = crypto.randomUUID();
    const invalidMerge = await app.inject({
      method: 'POST',
      url: `/api/robot/graph/places/${placeId}/merge`,
      headers: { cookie },
      payload: { sourcePlaceId: placeId },
    });
    expect(invalidMerge.statusCode, invalidMerge.body).toBe(409);
    expect(invalidMerge.json()).toMatchObject({
      error: 'robot_visual_conflict',
    });

    const missingPlaceDeletion = await app.inject({
      method: 'DELETE',
      url: `/api/robot/graph/places/${crypto.randomUUID()}`,
      headers: { cookie },
    });
    expect(missingPlaceDeletion.statusCode, missingPlaceDeletion.body).toBe(
      404,
    );
    expect(missingPlaceDeletion.json()).toMatchObject({
      error: 'robot_visual_not_found',
    });

    const missingObjectDeletion = await app.inject({
      method: 'DELETE',
      url: `/api/robot/graph/objects/${crypto.randomUUID()}`,
      headers: { cookie },
    });
    expect(missingObjectDeletion.statusCode, missingObjectDeletion.body).toBe(
      404,
    );
    expect(missingObjectDeletion.json()).toMatchObject({
      error: 'robot_visual_not_found',
    });

    const bandwidth = await app.inject({
      method: 'POST',
      url: '/api/robot/camera/bandwidth',
      headers: { cookie },
      payload: { profile: 'reduced' },
    });
    expect(bandwidth.statusCode, bandwidth.body).toBe(200);
    expect(bandwidth.json()).toMatchObject({
      profile: 'reduced',
      width: 640,
      height: 480,
      fps: 7,
      estimatedReductionPercent: 60,
    });

    const purge = await app.inject({
      method: 'POST',
      url: '/api/robot/graph/purge',
      headers: { cookie },
      payload: { scope: 'last_hour' },
    });
    expect(purge.statusCode, purge.body).toBe(200);
    expect(purge.json()).toMatchObject({
      deletedPlaces: 0,
      deletedViews: 0,
      graph: { places: [] },
    });

    const relocalize = await app.inject({
      method: 'POST',
      url: '/api/robot/mapping/relocalize',
      headers: { cookie },
      payload: {},
    });
    expect(relocalize.statusCode, relocalize.body).toBe(404);

    const autonomous = await app.inject({
      method: 'POST',
      url: '/api/robot/mode',
      headers: { cookie },
      payload: { mode: 'autonomous' },
    });
    expect(autonomous.statusCode, autonomous.body).toBe(409);
    expect(autonomous.json()).toMatchObject({
      error: 'robot_wheels_required',
    });

    const cameraStream = await app.inject({
      method: 'GET',
      url: '/api/robot/camera/stream',
      headers: { cookie },
    });
    expect(cameraStream.statusCode, cameraStream.body).toBe(200);
    expect(cameraStream.headers['content-type']).toContain('image/gif');
    expect(cameraStream.headers['cache-control']).toBe(
      'no-store, no-transform',
    );
    expect(cameraStream.headers['x-accel-buffering']).toBe('no');

    const actuators = await app.inject({
      method: 'POST',
      url: '/api/robot/actuators',
      headers: { cookie },
      payload: { wheelsEnabled: true, cameraServosEnabled: true },
    });
    expect(actuators.statusCode, actuators.body).toBe(200);
    expect(actuators.json().state.actuators.wheelsEnabled).toBe(true);

    const legacyArm = await app.inject({
      method: 'POST',
      url: '/api/robot/arm',
      headers: { cookie },
      payload: { durationMs: 2_000 },
    });
    expect(legacyArm.statusCode, legacyArm.body).toBe(200);
    expect(legacyArm.json().state).toMatchObject({
      armed: true,
      controlExpiresAt: null,
    });

    const drive = await app.inject({
      method: 'POST',
      url: '/api/robot/drive',
      headers: { cookie },
      payload: {
        commandId: crypto.randomUUID(),
        issuedAt: '2026-08-23T00:00:00.000Z',
        expiresAt: '2026-08-23T00:00:00.300Z',
        direction: 'forward',
        intensity: 0.2,
        steering: 0.65,
        maxDurationMs: 300,
      },
    });
    expect(drive.statusCode, drive.body).toBe(200);
    expect(drive.json().state.moving).toBe(true);
    const forwardedDrive = driveSpy.mock.calls[0]?.[0];
    expect(
      Date.parse(forwardedDrive!.expiresAt) -
        Date.parse(forwardedDrive!.issuedAt),
    ).toBe(1_800);
    expect(forwardedDrive!.maxDurationMs).toBe(300);
    expect(forwardedDrive!.steering).toBe(0.65);

    const camera = await app.inject({
      method: 'POST',
      url: '/api/robot/camera/look',
      headers: { cookie },
      payload: {
        commandId: crypto.randomUUID(),
        issuedAt: '2026-08-23T00:00:00.000Z',
        expiresAt: '2026-08-23T00:00:01.800Z',
        pan: 0.5,
        tilt: 0,
      },
    });
    expect(camera.statusCode, camera.body).toBe(200);
    expect(camera.json().state.cameraPose).toEqual({ pan: 0.5, tilt: 0 });

    const stopped = await app.inject({
      method: 'POST',
      url: '/api/robot/stop',
      headers: { cookie },
    });
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json().state).toMatchObject({
      armed: true,
      moving: false,
    });
  });
  it('rejects malformed robot commands and cross-site mutation attempts', async () => {
    const app = await buildHub({
      databasePath: ':memory:',
      publicOrigin: 'https://friday.test',
      robotController: new SimulatedRobotController(),
    });
    apps.push(app);
    const cookie = await bootstrap(app);
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/robot/drive',
      headers: { cookie },
      payload: {
        commandId: crypto.randomUUID(),
        issuedAt: 'not-an-instant',
        expiresAt: '2026-08-23T00:00:00.300Z',
        direction: 'forward',
        intensity: 0.2,
        steering: 0,
        maxDurationMs: 300,
      },
    });
    expect(malformed.statusCode).toBe(400);

    const malformedDisplayPreferences = await app.inject({
      method: 'PATCH',
      url: '/api/robot/display-preferences',
      headers: { cookie },
      payload: { recognitionVisible: 'false' },
    });
    expect(malformedDisplayPreferences.statusCode).toBe(400);

    const malformedControlPreferences = await app.inject({
      method: 'PATCH',
      url: '/api/robot/control-preferences',
      headers: { cookie },
      payload: { steeringTrimPercent: 50 },
    });
    expect(malformedControlPreferences.statusCode).toBe(400);

    const malformedPanoramaPulse = await app.inject({
      method: 'PATCH',
      url: '/api/robot/panorama-preferences',
      headers: { cookie },
      payload: { panoramaPulseMs: 1001 },
    });
    expect(malformedPanoramaPulse.statusCode).toBe(400);

    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/robot/stop',
      headers: {
        cookie,
        origin: 'https://hostile.example',
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(crossSite.statusCode).toBe(403);

    const crossSiteDisplayPreferences = await app.inject({
      method: 'PATCH',
      url: '/api/robot/display-preferences',
      headers: {
        cookie,
        origin: 'https://hostile.example',
        'sec-fetch-site': 'cross-site',
      },
      payload: { recognitionVisible: false },
    });
    expect(crossSiteDisplayPreferences.statusCode).toBe(403);

    const crossSiteControlPreferences = await app.inject({
      method: 'PATCH',
      url: '/api/robot/control-preferences',
      headers: {
        cookie,
        origin: 'https://hostile.example',
        'sec-fetch-site': 'cross-site',
      },
      payload: { steeringTrimPercent: -5 },
    });
    expect(crossSiteControlPreferences.statusCode).toBe(403);
  });
  it('runs topological habits without legacy head actions and keeps manual recovery', async () => {
    const app = await buildHub({
      databasePath: ':memory:',
      publicOrigin: 'https://friday.test',
      robotController: new SimulatedRobotController(),
    });
    apps.push(app);
    const cookie = await bootstrap(app);
    await app.inject({
      method: 'POST',
      url: '/api/robot/actuators',
      headers: { cookie },
      payload: { wheelsEnabled: true, cameraServosEnabled: true },
    });

    const started = await app.inject({
      method: 'POST',
      url: '/api/robot/autonomy/start',
      headers: { cookie },
      payload: { powerPercent: 20, steeringTrimPercent: -2 },
    });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json()).toMatchObject({
      autonomy: { status: 'exploring', speedPercent: 20 },
      graph: { places: [], transitions: [] },
      state: { operatingMode: 'autonomous' },
    });

    const powerChanged = await app.inject({
      method: 'PATCH',
      url: '/api/robot/autonomy/power',
      headers: { cookie },
      payload: { powerPercent: 35 },
    });
    expect(powerChanged.statusCode, powerChanged.body).toBe(200);
    expect(powerChanged.json()).toMatchObject({
      status: 'exploring',
      speedPercent: 35,
    });

    const invalidPower = await app.inject({
      method: 'PATCH',
      url: '/api/robot/autonomy/power',
      headers: { cookie },
      payload: { powerPercent: 36 },
    });
    expect(invalidPower.statusCode).toBe(400);

    const status = await app.inject({
      method: 'GET',
      url: '/api/robot/autonomy',
      headers: { cookie },
    });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json()).toMatchObject({
      motionState: 'uncertain',
      blockReason: 'stabilizing',
      informationGain: 0,
      habitConfidence: 0,
    });
    expect(
      status
        .json()
        .availableActions.some((action: string) => action.startsWith('look_')),
    ).toBe(false);

    const recovery = await app.inject({
      method: 'POST',
      url: '/api/robot/autonomy/recovery/start',
      headers: { cookie },
      payload: {},
    });
    expect(recovery.statusCode, recovery.body).toBe(200);
    expect(recovery.json()).toMatchObject({
      autonomy: {
        status: 'recovering',
        humanRecovery: { commandCount: 0 },
      },
      state: { operatingMode: 'manual' },
    });

    const stopped = await app.inject({
      method: 'POST',
      url: '/api/robot/autonomy/stop',
      headers: { cookie },
    });
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json()).toMatchObject({
      autonomy: { status: 'inactive' },
      state: { operatingMode: 'manual' },
    });
  });
});
