import {
  RobotCommandResponseSchema,
  RobotStateSchema,
  type RobotCameraLookRequest,
  type RobotDirection,
  type RobotDriveRequest,
  type RobotOperatingMode,
  type RobotState,
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
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
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

export function armRobot(durationMs = 60_000): Promise<RobotState> {
  return robotRequest('/api/robot/arm', {
    method: 'POST',
    body: JSON.stringify({ durationMs }),
  });
}

export function driveRobot(
  direction: RobotDirection,
  intensity = 0.2,
  maxDurationMs = 350,
): Promise<RobotState> {
  const body: RobotDriveRequest = {
    ...expiringCommand(maxDurationMs),
    direction,
    intensity,
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
    ...expiringCommand(800),
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

export function stopRobot(): Promise<RobotState> {
  return robotRequest('/api/robot/stop', {
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
