import { expect, test } from './fixtures';

test('the real camera and physical actuator switches stay usable at 360px', async ({
  page,
}) => {
  let lastDriveDirection: string | null = null;
  let lastDriveIntensity: number | null = null;
  let lastDriveSteering: number | null = null;
  let lastCameraTilt: number | null = null;
  let recognitionVisible = true;
  let steeringTrimPercent = 0;
  let panoramaPulseMs = 220;
  let mappingStatus: 'inactive' | 'paused' | 'recording' = 'inactive';
  let robotState = {
    powerState: 'awake' as 'awake' | 'sleeping',
    available: true,
    connected: true,
    armed: false,
    mode: 'alphabot2' as const,
    cameraAvailable: true,
    actuators: { wheelsEnabled: false, cameraServosEnabled: false },
    moving: false,
    lastSeenAt: '2026-08-24T00:00:00.000Z',
    warning: null,
    capabilities: [
      'teleop',
      'camera_look',
      'camera_stream',
      'vision_objects',
      'vision_people',
      'visual_topology',
      'topological_autonomy',
      'network_standby',
    ],
    operatingMode: 'manual' as 'autonomous' | 'manual',
    controlExpiresAt: null as string | null,
    cameraPose: { pan: 0, tilt: 0 },
    telemetry: {
      temperatureC: 47,
      throttledCode: '0x0',
      underVoltageActive: false,
      underVoltageOccurred: false,
      irLeftClear: true,
      irRightClear: true,
      lineSensors: [700, 720, 900, 850, 910],
      cameraFps: 10,
      commandLatencyMs: null,
    },
    vision: {
      frameId: 1,
      observedAt: '2026-08-24T00:00:00.000Z',
      expiresAt: '2026-08-24T00:00:02.000Z',
      imageWidth: 640,
      imageHeight: 480,
      processingMs: 28,
      detections: [
        {
          id: '1-0-object',
          kind: 'object' as const,
          label: 'Lit',
          confidence: 0.59,
          x: 0.1,
          y: 0.2,
          width: 0.5,
          height: 0.4,
          trackId: null,
        },
      ],
    },
  };
  const robotMap = () => ({
    version: 3,
    operatingMode: robotState.operatingMode,
    mapping: {
      status: mappingStatus,
      sessionId:
        mappingStatus === 'inactive'
          ? null
          : '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
      startedAt:
        mappingStatus === 'inactive' ? null : '2026-08-25T00:00:00.000Z',
      pointCount: mappingStatus === 'inactive' ? 0 : 2,
      storageBytes: mappingStatus === 'inactive' ? 0 : 192,
      quotaBytes: 262_144_000,
    },
    localization: {
      status: 'estimated' as const,
      confidence: 0.9,
      source: 'odometry' as const,
      correctionRevision: 0,
      lastRelocalizedAt: null,
      visualRecognitionAvailable: true,
      pose: {
        x: 0.4,
        y: 0.2,
        heading: 0.1,
        uncertainty: 0.3,
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
    },
    localizationEvents: [],
    paths: [],
    objects: [
      {
        id: '70c7847d-e8eb-4e42-bab4-d553338138c3',
        displayName: 'Lit',
        classLabel: 'bed',
        x: 0.8,
        y: 0.4,
        uncertainty: 1.2,
        confidence: 0.91,
        sightingCount: 5,
        viewpointCount: 3,
        keyframeId: null,
        lastSeenAt: '2026-08-25T00:00:00.000Z',
      },
    ],
    viewpoints: [
      {
        id: '785a3690-4fb0-41f0-b34d-1cbf9bc5d417',
        x: 0.4,
        y: 0.2,
        heading: 0.1,
        pan: 0.5,
        tilt: 0.2,
        observationCount: 2,
        hasKeyframe: false,
        lastSeenAt: '2026-08-25T00:00:00.000Z',
      },
    ],
    visualMemory: {
      keyframeCount: 0,
      storageBytes: 0,
      quotaBytes: 16_777_216,
      signatureCount: 0,
      signatureStorageBytes: 0,
      signatureQuotaBytes: 12_582_912,
    },
    autonomy: {
      available: true,
      blockedReason: null,
    },
  });
  let humanRecovery: {
    commandCount: number;
    startedAt: string;
  } | null = null;
  const robotAutonomy = () => ({
    status: humanRecovery
      ? ('recovering' as const)
      : robotState.operatingMode === 'autonomous'
        ? ('exploring' as const)
        : ('inactive' as const),
    runId:
      robotState.operatingMode === 'autonomous'
        ? 'a89af9e6-4f63-4c4e-9bc5-585fce269f85'
        : null,
    startedAt:
      robotState.operatingMode === 'autonomous'
        ? '2026-08-25T00:00:00.000Z'
        : null,
    updatedAt: '2026-08-25T00:00:00.000Z',
    currentPlaceId: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
    targetPlaceId: null,
    action: null,
    availableActions: [],
    confidence: 0,
    speedPercent: 0,
    reward: null,
    reason: 'Observation visuelle.',
    learningStepCount: 0,
    imageUsable: true,
    motionState: 'stationary' as const,
    blockReason: null,
    informationGain: 0,
    localizationConfidence: 0.91,
    habitConfidence: 0,
    humanRecovery,
  });
  const robotGraph = () => ({
    version: 4,
    currentPlaceId: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
    places: [
      {
        id: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
        status: 'confirmed' as const,
        label: 'Salon',
        confidence: 0.91,
        viewCount: 1,
        objectCount: 1,
        panoramaStatus: 'complete' as const,
        canonicalSectorId: '2b8912c0-836d-4fe8-9600-632cf5f1c531',
        firstSeenAt: '2026-08-25T00:00:00.000Z',
        lastSeenAt: '2026-08-25T00:10:00.000Z',
      },
    ],
    views: [
      {
        id: '785a3690-4fb0-41f0-b34d-1cbf9bc5d417',
        placeId: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
        observedAt: '2026-08-25T00:10:00.000Z',
        pan: 0,
        tilt: 0.2,
        quality: 120,
        hasImage: false,
      },
    ],
    sectors: [
      {
        id: '2b8912c0-836d-4fe8-9600-632cf5f1c531',
        placeId: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
        ordinal: 0,
        quality: 120,
        observedAt: '2026-08-25T00:10:00.000Z',
        isCanonical: true,
      },
    ],
    ports: [],
    transitions: [],
    objects: [
      {
        id: '8bf07ebd-9e1b-45f7-b95b-d771049ea365',
        placeId: '1507eb5a-72e4-473c-a982-4d6c8c47e75e',
        classLabel: 'lampe',
        displayName: 'Lampe bureau',
        confidence: 0.93,
        sightingCount: 8,
        lastSeenAt: '2026-08-25T00:10:00.000Z',
      },
    ],
    storage: {
      imageBytes: 0,
      imageQuotaBytes: 33_554_432,
      descriptorBytes: 1_600,
      descriptorQuotaBytes: 8_388_608,
    },
  });
  const robotMemory = {
    roomName: 'Salon',
    entities: [
      {
        id: '8bf07ebd-9e1b-45f7-b95b-d771049ea365',
        kind: 'object' as const,
        classLabel: 'lampe',
        displayName: 'Lampe bureau',
        roomName: 'Salon',
        confidence: 0.93,
        status: 'confirmed' as const,
        sightingCount: 8,
        firstSeenAt: '2026-08-25T00:00:00.000Z',
        lastSeenAt: '2026-08-25T00:10:00.000Z',
        lastPosition: { x: 0.4, y: 0.3 },
      },
      {
        id: '6d8daa69-e13c-4a64-9ca2-5987f5a441a7',
        kind: 'object' as const,
        classLabel: 'chaise',
        displayName: 'Chaise possible',
        roomName: 'Salon',
        confidence: 0.61,
        status: 'candidate' as const,
        sightingCount: 1,
        firstSeenAt: '2026-08-25T00:11:00.000Z',
        lastSeenAt: '2026-08-25T00:11:00.000Z',
        lastPosition: { x: 0.6, y: 0.4 },
      },
    ],
    anonymousPresence: { active: false, lastSeenAt: null },
    mapping: { enabled: true, status: 'observer' as const },
    learning: {
      mode: 'online' as const,
      policyStatus: 'candidate' as const,
      episodeCount: 12,
    },
  };
  await page.route('**/api/robot/state', async (route) =>
    route.fulfill({ json: robotState }),
  );
  await page.route('**/api/robot/graph', async (route) =>
    route.fulfill({ json: robotGraph() }),
  );
  await page.route('**/api/robot/autonomy', async (route) =>
    route.fulfill({ json: robotAutonomy() }),
  );
  await page.route('**/api/robot/display-preferences', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as {
        recognitionVisible: boolean;
      };
      recognitionVisible = body.recognitionVisible;
    }
    await route.fulfill({
      json: {
        recognitionVisible,
        updatedAt: '2026-08-26T12:00:00.000Z',
      },
    });
  });
  await page.route('**/api/robot/control-preferences', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as {
        steeringTrimPercent?: number;
      };
      if (body.steeringTrimPercent !== undefined)
        steeringTrimPercent = body.steeringTrimPercent;
    }
    await route.fulfill({
      json: {
        steeringTrimPercent,
        updatedAt:
          steeringTrimPercent === 0 ? null : '2026-08-26T13:30:00.000Z',
      },
    });
  });
  await page.route('**/api/robot/panorama-preferences', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as {
        panoramaPulseMs: number;
      };
      panoramaPulseMs = body.panoramaPulseMs;
    }
    await route.fulfill({
      json: {
        panoramaPulseMs,
        updatedAt: panoramaPulseMs === 220 ? null : '2026-08-26T13:31:00.000Z',
      },
    });
  });
  await page.route('**/api/robot/memory', async (route) =>
    route.fulfill({ json: robotMemory }),
  );
  await page.route('**/api/robot/autonomy/start', async (route) => {
    robotState = { ...robotState, operatingMode: 'autonomous' };
    humanRecovery = null;
    mappingStatus = 'recording';
    await route.fulfill({
      json: {
        accepted: true,
        state: robotState,
        graph: robotGraph(),
        autonomy: robotAutonomy(),
      },
    });
  });
  await page.route('**/api/robot/autonomy/recovery/start', async (route) => {
    robotState = { ...robotState, operatingMode: 'manual', moving: false };
    humanRecovery = {
      commandCount: 0,
      startedAt: '2026-08-25T00:00:00.000Z',
    };
    await route.fulfill({
      json: {
        accepted: true,
        state: robotState,
        graph: robotGraph(),
        autonomy: robotAutonomy(),
      },
    });
  });
  await page.route('**/api/robot/mapping/*', async (route) => {
    const action = route.request().url().split('/').at(-1);
    mappingStatus =
      action === 'pause'
        ? 'paused'
        : action === 'stop'
          ? 'inactive'
          : 'recording';
    await route.fulfill({ json: { accepted: true, map: robotMap() } });
  });
  await page.route('**/api/robot/actuators', async (route) => {
    const actuators = route
      .request()
      .postDataJSON() as typeof robotState.actuators;
    robotState = { ...robotState, armed: actuators.wheelsEnabled, actuators };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/arm', async (route) => {
    robotState = {
      ...robotState,
      armed: true,
      controlExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/drive', async (route) => {
    const command = route.request().postDataJSON() as {
      direction: string;
      intensity: number;
      steering: number;
    };
    lastDriveDirection = command.direction;
    lastDriveIntensity = command.intensity;
    lastDriveSteering = command.steering;
    robotState = { ...robotState, moving: true };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/stop', async (route) => {
    robotState = {
      ...robotState,
      moving: false,
      controlExpiresAt: null,
    };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/halt', async (route) => {
    robotState = { ...robotState, moving: false };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/camera/look', async (route) => {
    const command = route.request().postDataJSON() as {
      pan: number;
      tilt: number;
    };
    lastCameraTilt = command.tilt;
    robotState = {
      ...robotState,
      cameraPose: { pan: command.pan, tilt: command.tilt },
    };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/power/*', async (route) => {
    const sleeping = route.request().url().endsWith('/sleep');
    robotState = {
      ...robotState,
      powerState: sleeping ? 'sleeping' : 'awake',
      available: !sleeping,
      cameraAvailable: !sleeping,
      armed: false,
      actuators: { wheelsEnabled: false, cameraServosEnabled: false },
      moving: false,
      operatingMode: 'manual',
    };
    await route.fulfill({ json: { accepted: true, state: robotState } });
  });
  await page.route('**/api/robot/camera/stream', async (route) =>
    route.fulfill({
      contentType: 'image/gif',
      body: Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
        'base64',
      ),
    }),
  );

  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('button', { name: 'Robot' })
    .click();

  const camera = page.getByRole('img', { name: 'Vue en direct du robot' });
  await expect(camera).toBeVisible();
  const cameraFrameBox = await page.locator('.robot-camera').boundingBox();
  expect(cameraFrameBox!.width / cameraFrameBox!.height).toBeCloseTo(4 / 3, 1);
  const recognition = page.getByRole('button', { name: 'Reco affichée' });
  await expect(recognition).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.robot-box', { hasText: 'Lit' })).toBeVisible();
  await recognition.click();
  await expect(
    page.getByRole('button', { name: 'Reco masquée' }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.robot-box')).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', {
      name: /Objets|Personnes|Identités|Repères|Sécurité/,
    }),
  ).toHaveCount(0);
  await expect(page.getByText('SIMULATION', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Robot' })).toHaveCount(0);
  await expect(
    page.getByRole('combobox', { name: 'Mode du robot' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manuel' })).toBeEnabled();
  await expect(page.getByText(/Repères visuels · 1 lieux/u)).toBeVisible();
  await page.getByRole('button', { name: 'Repères' }).click();
  await expect(
    page.getByRole('heading', { name: 'La carte du robot' }),
  ).toBeVisible();
  await expect(page.getByText('Lampe bureau')).toBeVisible();
  await expect(page.getByText('Vue privée ou non conservée')).toBeVisible();
  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('button', { name: 'Mettre en veille' }).click();
  await expect(
    page.getByRole('heading', { name: 'Robot en veille réseau' }),
  ).toBeVisible();
  await expect(camera).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Repères' })).toBeEnabled();
  await page.getByRole('button', { name: 'Réveiller' }).click();
  await expect(camera).toBeVisible();
  const wheels = page.getByRole('switch', { name: 'Roues' });
  const cameraServos = page.getByRole('switch', { name: 'Caméra' });
  await expect(wheels).not.toBeChecked();
  await expect(cameraServos).not.toBeChecked();
  await cameraServos.click();
  await expect(cameraServos).toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Caméra gauche' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Caméra centrer' }).click();
  await expect.poll(() => lastCameraTilt).toBe(0.2);
  await page.getByRole('button', { name: 'Caméra gauche' }).click();
  await page.getByRole('button', { name: 'Caméra centrer' }).click();
  await wheels.click();
  await expect(wheels).toBeChecked();
  await expect(page.getByRole('button', { name: 'Armer 60 s' })).toHaveCount(0);
  const power = page.getByRole('slider', { name: 'Puissance moteurs' });
  await expect(power).toHaveValue('20');
  await power.fill('35');
  await expect(power).toHaveValue('35');
  const joystick = page.getByRole('button', { name: 'Joystick locomotion' });
  await expect(joystick).toBeEnabled();
  const joystickBox = await joystick.boundingBox();
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width / 2,
    joystickBox!.y + joystickBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width - 10,
    joystickBox!.y + 10,
  );
  await expect.poll(() => lastDriveDirection).toBe('forward');
  await expect.poll(() => lastDriveIntensity).toBe(0.35);
  await expect.poll(() => lastDriveSteering).toBeGreaterThan(0.15);
  expect(lastDriveSteering).toBeLessThan(0.4);
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width / 2,
    joystickBox!.y + 10,
  );
  await expect.poll(() => lastDriveDirection).toBe('forward');
  await expect.poll(() => lastDriveSteering).toBe(0);
  await page.mouse.up();
  const trim = page.getByRole('slider', { name: 'Trim direction' });
  await expect(trim).toHaveValue('0');
  await trim.fill('-5');
  await expect(trim).toHaveValue('-5');
  await expect(page.getByText('-5', { exact: true })).toBeVisible();
  await expect.poll(() => steeringTrimPercent).toBe(-5);
  const panoramaPulse = page.getByLabel('Durée impulsion panorama 360 degrés');
  await expect(panoramaPulse).toHaveValue('220');
  await panoramaPulse.fill('340');
  await expect.poll(() => panoramaPulseMs).toBe(340);
  lastDriveDirection = null;
  lastDriveSteering = null;
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width / 2,
    joystickBox!.y + joystickBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width / 2,
    joystickBox!.y + 10,
  );
  await expect.poll(() => lastDriveDirection).toBe('forward');
  await expect.poll(() => lastDriveSteering).toBe(-0.05);
  await page.mouse.up();
  lastDriveDirection = null;
  lastDriveSteering = null;
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width / 2,
    joystickBox!.y + joystickBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    joystickBox!.x + joystickBox!.width - 10,
    joystickBox!.y + joystickBox!.height / 2,
  );
  await expect.poll(() => lastDriveDirection).toBe('right');
  await expect.poll(() => lastDriveSteering).toBe(0);
  await page.mouse.up();
  expect(
    await camera.evaluate((image) => getComputedStyle(image).opacity),
  ).toBe('1');
  await page.getByRole('button', { name: 'Autonome' }).click();
  await expect(page.getByRole('button', { name: 'Récup' })).toBeVisible();
  await page.getByRole('button', { name: 'Récup' }).click();
  await expect(
    page.getByRole('button', { name: 'Rendre la main' }),
  ).toBeVisible();
  await expect(page.getByText(/recovering/u)).toBeVisible();
  if (process.env.FRIDAY_VISUAL_CAPTURE === '1') {
    await page.screenshot({
      path: 'output/playwright/robot-compact-360.png',
      fullPage: true,
    });
  }
});
