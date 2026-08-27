import {
  RobotPowerStatusSchema,
  type RobotActuatorsRequest,
  type RobotCameraBandwidthProfile,
  type RobotCameraBandwidthStatus,
  type RobotCameraLookRequest,
  type RobotDriveRequest,
  type RobotOperatingMode,
  type RobotPowerStatus,
  type RobotState,
} from '@friday/contracts';

import {
  parseRobotBaseUrl,
  RobotCommandRejectedError,
  RobotUnavailableError,
  type RobotCameraStream,
  type RobotController,
  type RobotVisionKeyframe,
} from './robot-controller.js';

export interface VisionLifecycle {
  pause(): Promise<void>;
  resume(): void;
}

export interface RobotPowerClient {
  status(): Promise<RobotPowerStatus>;
  sleep(): Promise<RobotPowerStatus>;
  wake(): Promise<RobotPowerStatus>;
}

export class HttpRobotPowerClient {
  readonly #baseUrl: URL;
  readonly #token: string;

  constructor(baseUrl: string, token: string) {
    try {
      this.#baseUrl = parseRobotBaseUrl(baseUrl);
    } catch {
      throw new Error(
        'FRIDAY_ROBOT_WAKE_URL doit être une URL HTTP(S) vers une adresse IPv4 privée littérale.',
      );
    }
    if (token.length < 32)
      throw new Error(
        'FRIDAY_ROBOT_WAKE_TOKEN doit contenir au moins 32 caractères.',
      );
    this.#token = token;
  }

  status(): Promise<RobotPowerStatus> {
    return this.#request('/state', 'GET');
  }
  sleep(): Promise<RobotPowerStatus> {
    return this.#request('/sleep', 'POST');
  }
  wake(): Promise<RobotPowerStatus> {
    return this.#request('/wake', 'POST');
  }

  async #request(
    path: string,
    method: 'GET' | 'POST',
  ): Promise<RobotPowerStatus> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      method === 'GET' ? 2_000 : 22_000,
    );
    try {
      const response = await fetch(
        new URL(path.replace(/^\//u, ''), this.#baseUrl),
        {
          method,
          headers: { authorization: `Bearer ${this.#token}` },
          ...(method === 'POST'
            ? {
                body: '{}',
                headers: {
                  authorization: `Bearer ${this.#token}`,
                  'content-type': 'application/json',
                },
              }
            : {}),
          redirect: 'error',
          signal: controller.signal,
        },
      );
      if (!response.ok)
        throw new RobotUnavailableError(
          `Agent de réveil indisponible (${response.status.toString()}).`,
        );
      return RobotPowerStatusSchema.parse(await response.json());
    } catch (error) {
      if (error instanceof RobotUnavailableError) throw error;
      throw new RobotUnavailableError('Agent de réveil injoignable.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class NetworkStandbyRobotController implements RobotController {
  readonly #base: RobotController;
  readonly #power: RobotPowerClient;
  readonly #vision: VisionLifecycle | undefined;
  #transition: Promise<RobotState> | null = null;
  #lastStatus: RobotPowerStatus | null = null;

  constructor(
    base: RobotController,
    power: RobotPowerClient,
    vision?: VisionLifecycle,
  ) {
    this.#base = base;
    this.#power = power;
    this.#vision = vision;
  }

  async initialize(): Promise<void> {
    try {
      const status = await this.powerStatus();
      if (status.powerState === 'awake') this.#vision?.resume();
      else await this.#vision?.pause();
    } catch {
      await this.#vision?.pause();
    }
  }

  async powerStatus(): Promise<RobotPowerStatus> {
    try {
      this.#lastStatus = await this.#power.status();
      return this.#lastStatus;
    } catch (error) {
      this.#lastStatus = {
        powerState: 'unavailable',
        robotService: 'unknown',
        cameraService: 'unknown',
        updatedAt: new Date().toISOString(),
        message:
          error instanceof Error
            ? error.message
            : 'Agent de réveil injoignable.',
      };
      return this.#lastStatus;
    }
  }

  async state(): Promise<RobotState> {
    const status = await this.powerStatus();
    if (status.powerState !== 'awake') {
      await this.#vision?.pause();
      return this.#sleepingState(status);
    }
    this.#vision?.resume();
    try {
      return this.#awake(await this.#base.state());
    } catch (error) {
      return this.#sleepingState({
        ...status,
        powerState: 'degraded',
        message: error instanceof Error ? error.message : 'Robot injoignable.',
      });
    }
  }

  sleepNetwork(): Promise<RobotState> {
    if (this.#transition) return this.#transition;
    const operation = this.#sleep().finally(() => {
      if (this.#transition === operation) this.#transition = null;
    });
    this.#transition = operation;
    return operation;
  }

  wakeNetwork(): Promise<RobotState> {
    if (this.#transition) return this.#transition;
    const operation = this.#wake().finally(() => {
      if (this.#transition === operation) this.#transition = null;
    });
    this.#transition = operation;
    return operation;
  }

  async #sleep(): Promise<RobotState> {
    try {
      await this.#base.stop();
    } catch {
      // L'agent systemd reste l'autorité finale si le runtime est déjà absent.
    }
    try {
      await this.#base.setMode('manual');
    } catch {
      // Continuer vers l'arrêt des services même si le changement de mode échoue.
    }
    try {
      await this.#base.setActuators({
        wheelsEnabled: false,
        cameraServosEnabled: false,
      });
    } catch {
      // Les services seront arrêtés ensuite; ne pas bloquer la veille ici.
    }
    await this.#vision?.pause();
    try {
      const status = await this.#power.sleep();
      this.#lastStatus = status;
      return this.#sleepingState(status);
    } catch (error) {
      const status = await this.powerStatus();
      if (status.powerState === 'awake') this.#vision?.resume();
      throw error;
    }
  }

  async #wake(): Promise<RobotState> {
    const status = await this.#power.wake();
    this.#lastStatus = status;
    const deadline = Date.now() + 20_000;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        const state = await this.#base.state();
        await this.#base.setMode('manual');
        const safe = await this.#base.setActuators({
          wheelsEnabled: false,
          cameraServosEnabled: false,
        });
        this.#vision?.resume();
        return this.#awake(safe ?? state);
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new RobotUnavailableError(
      lastError instanceof Error
        ? `Réveil incomplet : ${lastError.message}`
        : 'Réveil incomplet après 20 secondes.',
    );
  }

  #ensureAwake(): void {
    if (this.#transition || this.#lastStatus?.powerState !== 'awake')
      throw new RobotCommandRejectedError(
        'Le robot est en veille ou en transition.',
      );
  }
  #awake(state: RobotState): RobotState {
    return {
      ...state,
      powerState: 'awake',
      capabilities: [
        ...new Set([...state.capabilities, 'network_standby' as const]),
      ],
    };
  }
  #sleepingState(status: RobotPowerStatus): RobotState {
    return {
      powerState: status.powerState,
      available: false,
      connected: status.powerState !== 'unavailable',
      armed: false,
      mode: 'alphabot2',
      cameraAvailable: false,
      actuators: { wheelsEnabled: false, cameraServosEnabled: false },
      moving: false,
      lastSeenAt: status.updatedAt,
      warning: status.message,
      capabilities: ['network_standby'],
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
  }

  async arm(durationMs: number) {
    this.#ensureAwake();
    return this.#awake(await this.#base.arm(durationMs));
  }
  async drive(command: RobotDriveRequest) {
    this.#ensureAwake();
    return this.#awake(await this.#base.drive(command));
  }
  async look(command: RobotCameraLookRequest) {
    this.#ensureAwake();
    return this.#awake(await this.#base.look(command));
  }
  async setActuators(value: RobotActuatorsRequest) {
    this.#ensureAwake();
    return this.#awake(await this.#base.setActuators(value));
  }
  async setMode(mode: RobotOperatingMode) {
    this.#ensureAwake();
    return this.#awake(await this.#base.setMode(mode));
  }
  async halt() {
    if (this.#lastStatus?.powerState !== 'awake') return this.state();
    return this.#awake(await this.#base.halt());
  }
  async stop() {
    if (this.#lastStatus?.powerState !== 'awake') return this.state();
    return this.#awake(await this.#base.stop());
  }
  cameraBandwidth(): Promise<RobotCameraBandwidthStatus> {
    return this.#base.cameraBandwidth();
  }
  setCameraBandwidth(
    profile: RobotCameraBandwidthProfile,
  ): Promise<RobotCameraBandwidthStatus> {
    this.#ensureAwake();
    return this.#base.setCameraBandwidth(profile);
  }
  openCameraStream(signal: AbortSignal): Promise<RobotCameraStream> {
    this.#ensureAwake();
    return this.#base.openCameraStream(signal);
  }
  visionKeyframe(frameId: number): RobotVisionKeyframe | null {
    return this.#base.visionKeyframe?.(frameId) ?? null;
  }
  async close(): Promise<void> {
    await this.#vision?.pause();
    await this.#base.close();
  }
}
