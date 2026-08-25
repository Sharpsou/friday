import {
  RobotCommandResponseSchema,
  RobotMemorySummarySchema,
  RobotStateSchema,
  type RobotCameraLookRequest,
  type RobotActuatorsRequest,
  type RobotDirection,
  type RobotDriveRequest,
  type RobotOperatingMode,
  type RobotState,
  type RobotMemorySummary,
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

async function robotRequest(
  path: string,
  init: RequestInit = {},
): Promise<RobotState> {
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
    const errorMessages: Record<string, string> = {
      invalid_robot_camera_look: 'Commande caméra expirée. Réessayez.',
      invalid_robot_drive: 'Commande de déplacement expirée. Réessayez.',
      robot_owner_required: 'Le contrôle du robot est réservé au propriétaire.',
      robot_rate_limited: 'Trop de commandes rapprochées. Attendez un instant.',
      untrusted_origin: 'Commande refusée depuis cette origine Friday.',
    };
    const errorCode =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : null;
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : errorCode
          ? (errorMessages[errorCode] ?? errorCode)
          : 'Commande Robot indisponible.';
    throw new RobotClientError(message, response.status);
  }
  if (path.endsWith('/state')) return RobotStateSchema.parse(payload);
  return RobotCommandResponseSchema.parse(payload).state;
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

export async function getRobotMemory(): Promise<RobotMemorySummary> {
  const response = await fetch('/api/robot/memory', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new RobotClientError('Mémoire Robot indisponible.', response.status);
  return RobotMemorySummarySchema.parse(payload);
}

export async function renameRobotMemoryEntity(
  id: string,
  displayName: string,
): Promise<RobotMemorySummary> {
  const response = await fetch(
    `/api/robot/memory/entities/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName }),
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new RobotClientError(
      response.status === 403
        ? 'Le renommage est réservé au propriétaire.'
        : 'Impossible de renommer cet objet.',
      response.status,
    );
  return RobotMemorySummarySchema.parse(payload);
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

export function setRobotActuators(
  actuators: RobotActuatorsRequest,
): Promise<RobotState> {
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
    return;
  }
  void stopRobot();
}
