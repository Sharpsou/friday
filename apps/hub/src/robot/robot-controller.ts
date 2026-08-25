import { Readable } from 'node:stream';

import {
  RobotCommandResponseSchema,
  RobotStateSchema,
  type RobotActuatorsRequest,
  type RobotCameraLookRequest,
  type RobotDriveRequest,
  type RobotOperatingMode,
  type RobotState,
} from '@friday/contracts';
import { request } from 'undici';

export class RobotUnavailableError extends Error {}
export class RobotCommandRejectedError extends Error {}

export interface RobotCameraStream {
  body: Readable;
  contentType: string;
}

export interface RobotController {
  state(): Promise<RobotState>;
  arm(durationMs: number): Promise<RobotState>;
  drive(command: RobotDriveRequest): Promise<RobotState>;
  look(command: RobotCameraLookRequest): Promise<RobotState>;
  setActuators(actuators: RobotActuatorsRequest): Promise<RobotState>;
  setMode(mode: RobotOperatingMode): Promise<RobotState>;
  halt(): Promise<RobotState>;
  stop(): Promise<RobotState>;
  openCameraStream(signal: AbortSignal): Promise<RobotCameraStream>;
  close(): Promise<void>;
}

const DISABLED_STATE: RobotState = {
  available: false,
  connected: false,
  armed: false,
  mode: 'disabled',
  cameraAvailable: false,
  actuators: { wheelsEnabled: false, cameraServosEnabled: false },
  moving: false,
  lastSeenAt: null,
  warning: 'Robot non configuré.',
  capabilities: [],
  operatingMode: 'manual',
  controlExpiresAt: null,
  cameraPose: { pan: 0, tilt: 0 },
  telemetry: {
    temperatureC: null,
    throttledCode: null,
    underVoltageActive: false,
    underVoltageOccurred: false,
    irLeftClear: null,
    irRightClear: null,
    lineSensors: [0, 0, 0, 0, 0],
    cameraFps: null,
    commandLatencyMs: null,
  },
  vision: null,
};

export class DisabledRobotController implements RobotController {
  async state(): Promise<RobotState> {
    return DISABLED_STATE;
  }

  async arm(): Promise<RobotState> {
    throw new RobotUnavailableError('Robot non configuré.');
  }

  async drive(): Promise<RobotState> {
    throw new RobotUnavailableError('Robot non configuré.');
  }

  async look(): Promise<RobotState> {
    throw new RobotUnavailableError('Robot non configuré.');
  }

  async setActuators(): Promise<RobotState> {
    throw new RobotUnavailableError('Robot non configuré.');
  }

  async setMode(): Promise<RobotState> {
    throw new RobotUnavailableError('Robot non configuré.');
  }

  async halt(): Promise<RobotState> {
    return DISABLED_STATE;
  }

  async stop(): Promise<RobotState> {
    return DISABLED_STATE;
  }

  async openCameraStream(): Promise<RobotCameraStream> {
    throw new RobotUnavailableError('Caméra robot non configurée.');
  }

  async close(): Promise<void> {}
}

const SIMULATED_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  'base64',
);

export class SimulatedRobotController implements RobotController {
  #armedUntil = 0;
  #movingUntil = 0;
  #closed = false;
  #operatingMode: RobotOperatingMode = 'manual';
  #cameraPose = { pan: 0, tilt: 0 };
  #actuators = { wheelsEnabled: false, cameraServosEnabled: false };
  readonly #watchdog: NodeJS.Timeout;

  constructor() {
    this.#watchdog = setInterval(() => this.#expire(), 50);
    this.#watchdog.unref();
  }

  async state(): Promise<RobotState> {
    this.#expire();
    return this.#snapshot();
  }

  async arm(durationMs: number): Promise<RobotState> {
    this.#assertOpen();
    if (!this.#actuators.wheelsEnabled)
      throw new RobotCommandRejectedError('Roues désactivées.');
    this.#armedUntil = Date.now() + Math.min(durationMs, 60_000);
    return this.#snapshot();
  }

  async drive(command: RobotDriveRequest): Promise<RobotState> {
    this.#assertOpen();
    this.#expire();
    if (!validateRobotCommandTiming(command, Date.now(), 2_000))
      throw new RobotCommandRejectedError('Commande expirée.');
    if (!this.#actuators.wheelsEnabled)
      throw new RobotCommandRejectedError('Roues désactivées.');
    if (this.#armedUntil <= Date.now())
      throw new RobotCommandRejectedError('Conduite non armée.');
    if (!['manual', 'calibration'].includes(this.#operatingMode))
      throw new RobotCommandRejectedError(
        'La téléopération est interdite dans ce mode.',
      );
    this.#movingUntil = Math.min(
      Date.parse(command.expiresAt),
      Date.now() + command.maxDurationMs,
    );
    return this.#snapshot();
  }

  async look(command: RobotCameraLookRequest): Promise<RobotState> {
    this.#assertOpen();
    if (!this.#actuators.cameraServosEnabled)
      throw new RobotCommandRejectedError('Servos caméra désactivés.');
    if (!validateRobotCommandTiming(command, Date.now(), 2_000))
      throw new RobotCommandRejectedError('Commande caméra expirée.');
    this.#cameraPose = { pan: command.pan, tilt: command.tilt };
    return this.#snapshot();
  }

  async setActuators(actuators: RobotActuatorsRequest): Promise<RobotState> {
    this.#assertOpen();
    if (!actuators.wheelsEnabled) {
      this.#movingUntil = 0;
      this.#armedUntil = 0;
    }
    this.#actuators = { ...actuators };
    return this.#snapshot();
  }

  async setMode(mode: RobotOperatingMode): Promise<RobotState> {
    this.#assertOpen();
    this.#movingUntil = 0;
    this.#armedUntil = 0;
    this.#operatingMode = mode;
    return this.#snapshot();
  }

  async halt(): Promise<RobotState> {
    this.#movingUntil = 0;
    return this.#snapshot();
  }

  async stop(): Promise<RobotState> {
    this.#movingUntil = 0;
    this.#armedUntil = 0;
    return this.#snapshot();
  }

  async openCameraStream(): Promise<RobotCameraStream> {
    this.#assertOpen();
    return {
      body: Readable.from(SIMULATED_GIF),
      contentType: 'image/gif',
    };
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#movingUntil = 0;
    this.#armedUntil = 0;
    clearInterval(this.#watchdog);
  }

  #assertOpen(): void {
    if (this.#closed) throw new RobotUnavailableError('Simulateur arrêté.');
  }

  #expire(): void {
    const now = Date.now();
    if (this.#armedUntil <= now) this.#armedUntil = 0;
    if (this.#movingUntil <= now || this.#armedUntil === 0)
      this.#movingUntil = 0;
  }

  #snapshot(): RobotState {
    const now = new Date();
    const moving = this.#movingUntil > now.getTime();
    return {
      available: true,
      connected: !this.#closed,
      armed: this.#armedUntil > now.getTime(),
      mode: 'simulated',
      cameraAvailable: !this.#closed,
      actuators: { ...this.#actuators },
      moving,
      lastSeenAt: now.toISOString(),
      warning: 'Simulation : aucune sortie GPIO.',
      capabilities: [
        'teleop',
        'camera_look',
        'camera_stream',
        'line_follow',
        'vision_objects',
        'vision_people',
        'vision_markers',
        'signal_buzzer',
        'signal_lights',
      ],
      operatingMode: this.#operatingMode,
      controlExpiresAt:
        this.#armedUntil > now.getTime()
          ? new Date(this.#armedUntil).toISOString()
          : null,
      cameraPose: { ...this.#cameraPose },
      telemetry: {
        temperatureC: 48.5,
        throttledCode: '0x0',
        underVoltageActive: false,
        underVoltageOccurred: false,
        irLeftClear: true,
        irRightClear: true,
        lineSensors: [562, 548, 914, 770, 731],
        cameraFps: 10,
        commandLatencyMs: 18,
      },
      vision: {
        frameId: Math.floor(now.getTime() / 100),
        observedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 1_000).toISOString(),
        imageWidth: 640,
        imageHeight: 360,
        processingMs: 42,
        detections: [
          {
            id: 'sim-person-1',
            kind: 'person',
            label: 'Personne',
            confidence: 0.94,
            x: 0.35,
            y: 0.12,
            width: 0.28,
            height: 0.76,
            trackId: 'personne-1',
          },
          {
            id: 'sim-object-1',
            kind: 'object',
            label: 'Chaise',
            confidence: 0.86,
            x: 0.05,
            y: 0.48,
            width: 0.25,
            height: 0.43,
            trackId: 'objet-1',
          },
        ],
      },
    };
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        hostname.split('.')[index] !== octet.toString(),
    )
  )
    return false;
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function parseRobotBaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !isPrivateIpv4(url.hostname)
  ) {
    throw new Error(
      'FRIDAY_ROBOT_URL doit être une URL HTTP(S) vers une adresse IPv4 privée littérale.',
    );
  }
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/`;
  return url;
}

export function validateRobotCommandTiming(
  command: Pick<RobotDriveRequest, 'issuedAt' | 'expiresAt'>,
  now = Date.now(),
  maxLifetimeMs = 1_000,
): boolean {
  const issuedAt = Date.parse(command.issuedAt);
  const expiresAt = Date.parse(command.expiresAt);
  return (
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    issuedAt >= now - 2_000 &&
    issuedAt <= now + 1_000 &&
    expiresAt > now &&
    expiresAt - issuedAt <= maxLifetimeMs
  );
}

export class HttpRobotController implements RobotController {
  readonly #baseUrl: URL;
  readonly #token: string;

  constructor(baseUrl: string, token: string) {
    this.#baseUrl = parseRobotBaseUrl(baseUrl);
    if (token.length < 32)
      throw new Error(
        'FRIDAY_ROBOT_TOKEN doit contenir au moins 32 caractères.',
      );
    this.#token = token;
  }

  state(): Promise<RobotState> {
    return this.#json('/state', 'GET');
  }

  arm(durationMs: number): Promise<RobotState> {
    return this.#json('/arm', 'POST', { durationMs });
  }

  drive(command: RobotDriveRequest): Promise<RobotState> {
    return this.#json('/drive', 'POST', command);
  }

  look(command: RobotCameraLookRequest): Promise<RobotState> {
    return this.#json('/camera/look', 'POST', command);
  }

  setActuators(actuators: RobotActuatorsRequest): Promise<RobotState> {
    return this.#json('/actuators', 'POST', actuators);
  }

  setMode(mode: RobotOperatingMode): Promise<RobotState> {
    return this.#json('/mode', 'POST', { mode });
  }

  halt(): Promise<RobotState> {
    return this.#json('/halt', 'POST', {});
  }

  stop(): Promise<RobotState> {
    return this.#json('/stop', 'POST', {});
  }

  async openCameraStream(signal: AbortSignal): Promise<RobotCameraStream> {
    const response = await request(new URL('camera/stream', this.#baseUrl), {
      method: 'GET',
      headers: { authorization: `Bearer ${this.#token}` },
      signal,
    });
    const rawContentType = response.headers['content-type'];
    const contentType = Array.isArray(rawContentType)
      ? (rawContentType[0] ?? '')
      : (rawContentType ?? '');
    if (
      response.statusCode !== 200 ||
      (!contentType.startsWith('multipart/x-mixed-replace') &&
        !contentType.startsWith('image/jpeg'))
    ) {
      response.body.destroy();
      throw new RobotUnavailableError('Flux caméra robot indisponible.');
    }
    return { body: response.body, contentType };
  }

  async close(): Promise<void> {
    try {
      await this.stop();
    } catch {
      // The adapter watchdog remains the final authority when the link is lost.
    }
  }

  async #json(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<RobotState> {
    const controller = new AbortController();
    // A smoothed pan move can legitimately take longer than an ordinary
    // command. Keep the motor pulse deadline strict, but allow its response
    // (which also contains telemetry) enough time to return.
    const timeoutMs = path === '/camera/look' ? 3_500 : 2_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        new URL(path.replace(/^\//u, ''), this.#baseUrl),
        {
          method,
          headers: {
            authorization: `Bearer ${this.#token}`,
            ...(body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'error',
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const detail =
          typeof payload === 'object' &&
          payload !== null &&
          'error' in payload &&
          typeof payload.error === 'string'
            ? payload.error
            : null;
        throw new RobotCommandRejectedError(
          detail ??
            `Le robot a refusé la commande (${response.status.toString()}).`,
        );
      }
      const payload: unknown = await response.json();
      const wrapped = RobotCommandResponseSchema.safeParse(payload);
      if (wrapped.success) return wrapped.data.state;
      const direct = RobotStateSchema.safeParse(payload);
      if (direct.success) return direct.data;
      throw new RobotUnavailableError('Réponse robot invalide.');
    } catch (error) {
      if (
        error instanceof RobotCommandRejectedError ||
        error instanceof RobotUnavailableError
      )
        throw error;
      throw new RobotUnavailableError('Robot injoignable.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
