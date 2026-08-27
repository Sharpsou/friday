import {
  RobotAutonomyResponseSchema,
  RobotAutonomyStatusSchema,
  RobotCameraBandwidthStatusSchema,
  RobotCommandResponseSchema,
  RobotControlPreferencesSchema,
  RobotDisplayPreferencesSchema,
  RobotPanoramaPreferencesSchema,
  RobotStateSchema,
  RobotVisualGraphSchema,
  RobotVisualMemoryPurgeResponseSchema,
  type RobotActuatorsRequest,
  type RobotCameraLookRequest,
  type RobotCameraBandwidthProfile,
  type RobotCameraBandwidthStatus,
  type RobotControlPreferences,
  type RobotDirection,
  type RobotDisplayPreferences,
  type RobotDriveRequest,
  type RobotOperatingMode,
  type RobotPanoramaPreferences,
  type RobotState,
  type RobotVisualGraph,
  type RobotVisualMemoryPurgeScope,
} from '@friday/contracts';

export const ROBOT_CAMERA_STREAM_URL = '/api/robot/camera/stream';

export class RobotClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchJson(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      ...(init.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorCode =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : null;
    const knownMessages: Record<string, string> = {
      robot_owner_required: 'Le contrôle du robot est réservé au propriétaire.',
      robot_rate_limited: 'Trop de commandes rapprochées. Attendez un instant.',
      untrusted_origin: 'Commande refusée depuis cette origine Friday.',
    };
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : errorCode
          ? (knownMessages[errorCode] ?? errorCode)
          : 'Commande Robot indisponible.';
    throw new RobotClientError(message, response.status);
  }
  return payload;
}

async function robotRequest(
  path: string,
  init: RequestInit = {},
): Promise<RobotState> {
  const payload = await fetchJson(path, init);
  return path.endsWith('/state')
    ? RobotStateSchema.parse(payload)
    : RobotCommandResponseSchema.parse(payload).state;
}

function expiringCommand(durationMs: number) {
  const now = Date.now();
  return {
    commandId: crypto.randomUUID(),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + durationMs).toISOString(),
  };
}

export function getRobotState(): Promise<RobotState> {
  return robotRequest('/api/robot/state');
}

export function sleepRobotNetwork(): Promise<RobotState> {
  return robotRequest('/api/robot/power/sleep', {
    method: 'POST',
    body: '{}',
  });
}

export function wakeRobotNetwork(): Promise<RobotState> {
  return robotRequest('/api/robot/power/wake', {
    method: 'POST',
    body: '{}',
  });
}

export async function getRobotGraph(): Promise<RobotVisualGraph> {
  return RobotVisualGraphSchema.parse(await fetchJson('/api/robot/graph'));
}

export async function getRobotCameraBandwidth(): Promise<RobotCameraBandwidthStatus> {
  return RobotCameraBandwidthStatusSchema.parse(
    await fetchJson('/api/robot/camera/bandwidth'),
  );
}

export async function getRobotDisplayPreferences(): Promise<RobotDisplayPreferences> {
  return RobotDisplayPreferencesSchema.parse(
    await fetchJson('/api/robot/display-preferences'),
  );
}

export async function setRobotDisplayPreferences(
  recognitionVisible: boolean,
): Promise<RobotDisplayPreferences> {
  return RobotDisplayPreferencesSchema.parse(
    await fetchJson('/api/robot/display-preferences', {
      method: 'PATCH',
      body: JSON.stringify({ recognitionVisible }),
    }),
  );
}

export async function getRobotControlPreferences(): Promise<RobotControlPreferences> {
  return RobotControlPreferencesSchema.parse(
    await fetchJson('/api/robot/control-preferences'),
  );
}

export async function setRobotControlPreferences(
  steeringTrimPercent: number,
): Promise<RobotControlPreferences> {
  return RobotControlPreferencesSchema.parse(
    await fetchJson('/api/robot/control-preferences', {
      method: 'PATCH',
      body: JSON.stringify({ steeringTrimPercent }),
    }),
  );
}

export async function getRobotPanoramaPreferences(): Promise<RobotPanoramaPreferences> {
  return RobotPanoramaPreferencesSchema.parse(
    await fetchJson('/api/robot/panorama-preferences'),
  );
}

export async function setRobotPanoramaPreferences(
  panoramaPulseMs: number,
): Promise<RobotPanoramaPreferences> {
  return RobotPanoramaPreferencesSchema.parse(
    await fetchJson('/api/robot/panorama-preferences', {
      method: 'PATCH',
      body: JSON.stringify({ panoramaPulseMs }),
    }),
  );
}

export async function setRobotCameraBandwidth(
  profile: RobotCameraBandwidthProfile,
): Promise<RobotCameraBandwidthStatus> {
  return RobotCameraBandwidthStatusSchema.parse(
    await fetchJson('/api/robot/camera/bandwidth', {
      method: 'POST',
      body: JSON.stringify({ profile }),
    }),
  );
}

export async function purgeRobotVisualMemory(
  scope: RobotVisualMemoryPurgeScope,
) {
  return RobotVisualMemoryPurgeResponseSchema.parse(
    await fetchJson('/api/robot/graph/purge', {
      method: 'POST',
      body: JSON.stringify({ scope }),
    }),
  );
}

export async function getRobotAutonomy() {
  return RobotAutonomyStatusSchema.parse(
    await fetchJson('/api/robot/autonomy'),
  );
}

export async function startRobotAutonomy(
  powerPercent: number,
  steeringTrimPercent: number,
  targetPlaceId?: string,
  allowCandidatePath = false,
) {
  return RobotAutonomyResponseSchema.parse(
    await fetchJson('/api/robot/autonomy/start', {
      method: 'POST',
      body: JSON.stringify({
        powerPercent,
        steeringTrimPercent,
        ...(targetPlaceId ? { targetPlaceId } : {}),
        ...(allowCandidatePath ? { allowCandidatePath: true } : {}),
      }),
    }),
  );
}

export async function setRobotAutonomyPower(powerPercent: number) {
  return RobotAutonomyStatusSchema.parse(
    await fetchJson('/api/robot/autonomy/power', {
      method: 'PATCH',
      body: JSON.stringify({ powerPercent }),
    }),
  );
}

async function autonomyMutation(path: string) {
  return RobotAutonomyResponseSchema.parse(
    await fetchJson(path, { method: 'POST', body: '{}' }),
  );
}

export function stopRobotAutonomy() {
  return autonomyMutation('/api/robot/autonomy/stop');
}

export function startRobotHumanRecovery() {
  return autonomyMutation('/api/robot/autonomy/recovery/start');
}

export function finishRobotHumanRecovery() {
  return autonomyMutation('/api/robot/autonomy/recovery/finish');
}

export async function renameRobotVisualObject(
  id: string,
  displayName: string,
): Promise<RobotVisualGraph> {
  return RobotVisualGraphSchema.parse(
    await fetchJson(`/api/robot/graph/objects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    }),
  );
}

export async function renameRobotVisualPlace(
  id: string,
  label: string,
): Promise<RobotVisualGraph> {
  return RobotVisualGraphSchema.parse(
    await fetchJson(`/api/robot/graph/places/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    }),
  );
}

export async function mergeRobotVisualPlaces(
  targetPlaceId: string,
  sourcePlaceId: string,
): Promise<RobotVisualGraph> {
  return RobotVisualGraphSchema.parse(
    await fetchJson(
      `/api/robot/graph/places/${encodeURIComponent(targetPlaceId)}/merge`,
      {
        method: 'POST',
        body: JSON.stringify({ sourcePlaceId }),
      },
    ),
  );
}

export async function deleteRobotVisualPlace(
  id: string,
): Promise<RobotVisualGraph> {
  return RobotVisualGraphSchema.parse(
    await fetchJson(`/api/robot/graph/places/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  );
}

export async function deleteRobotVisualObject(
  id: string,
): Promise<RobotVisualGraph> {
  return RobotVisualGraphSchema.parse(
    await fetchJson(`/api/robot/graph/objects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  );
}

export function armRobot(durationMs = 60_000): Promise<RobotState> {
  return robotRequest('/api/robot/arm', {
    method: 'POST',
    body: JSON.stringify({ durationMs }),
  });
}

export function driveRobot(
  direction: RobotDirection,
  intensity = 0.2,
  steering = 0,
  maxDurationMs = 350,
): Promise<RobotState> {
  const body: RobotDriveRequest = {
    ...expiringCommand(maxDurationMs),
    direction,
    intensity,
    steering,
    maxDurationMs,
  };
  return robotRequest('/api/robot/drive', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function lookRobotCamera(
  pan: number,
  tilt: number,
): Promise<RobotState> {
  const body: RobotCameraLookRequest = {
    ...expiringCommand(1_800),
    pan,
    tilt,
  };
  return robotRequest('/api/robot/camera/look', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function setRobotMode(mode: RobotOperatingMode): Promise<RobotState> {
  return robotRequest('/api/robot/mode', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export function setRobotActuators(actuators: RobotActuatorsRequest) {
  return robotRequest('/api/robot/actuators', {
    method: 'POST',
    body: JSON.stringify(actuators),
  });
}

export function stopRobot(): Promise<RobotState> {
  return robotRequest('/api/robot/stop', {
    method: 'POST',
    body: '{}',
    keepalive: true,
  });
}

export function haltRobot(): Promise<RobotState> {
  return robotRequest('/api/robot/halt', {
    method: 'POST',
    body: '{}',
    keepalive: true,
  });
}

export function stopRobotOnPageExit(): void {
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      '/api/robot/stop',
      new Blob(['{}'], { type: 'application/json' }),
    );
  } else void stopRobot();
}
