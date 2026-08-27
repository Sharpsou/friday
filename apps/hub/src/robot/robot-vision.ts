import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import {
  RobotVisionFrameSchema,
  type RobotActuatorsRequest,
  type RobotCameraBandwidthProfile,
  type RobotCameraBandwidthStatus,
  type RobotCameraLookRequest,
  type RobotDriveRequest,
  type RobotOperatingMode,
  type RobotState,
  type RobotVisionFrame,
} from '@friday/contracts';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { z } from 'zod';

import type {
  RobotCameraStream,
  RobotController,
  RobotVisionKeyframe,
} from './robot-controller.js';

const SsdDetectorManifestSchema = z
  .object({
    version: z.literal(1),
    models: z
      .array(
        z
          .object({
            name: z.literal('ssd-mobilenet-v1-12-int8'),
            task: z.literal('object_detection'),
            file: z
              .string()
              .trim()
              .regex(/^[^/\\]+$/u),
            sha256: z.string().regex(/^[0-9a-f]{64}$/u),
            license: z.literal('Apache-2.0'),
            source: z.string().url(),
            labels: z.literal('coco-2017'),
          })
          .strict(),
      )
      .length(1),
  })
  .strict();

const Yolo26DetectorManifestSchema = z
  .object({
    version: z.literal(1),
    models: z
      .array(
        z
          .object({
            name: z.literal('yolo26s'),
            task: z.literal('object_detection'),
            file: z
              .string()
              .trim()
              .regex(/^[^/\\]+$/u),
            sha256: z.string().regex(/^[0-9a-f]{64}$/u),
            license: z.literal('AGPL-3.0'),
            source: z.string().url(),
            labels: z.literal('coco-2017'),
            inputSize: z.literal(640),
          })
          .strict(),
      )
      .length(1),
  })
  .strict();

const COCO_LABELS = new Map<number, string>([
  [1, 'Personne'],
  [2, 'Vélo'],
  [3, 'Voiture'],
  [4, 'Moto'],
  [5, 'Avion'],
  [6, 'Bus'],
  [7, 'Train'],
  [8, 'Camion'],
  [9, 'Bateau'],
  [10, 'Feu de circulation'],
  [11, "Bouche d'incendie"],
  [13, 'Panneau stop'],
  [14, 'Horodateur'],
  [15, 'Banc'],
  [16, 'Oiseau'],
  [17, 'Chat'],
  [18, 'Chien'],
  [19, 'Cheval'],
  [20, 'Mouton'],
  [21, 'Vache'],
  [22, 'Éléphant'],
  [23, 'Ours'],
  [24, 'Zèbre'],
  [25, 'Girafe'],
  [27, 'Sac à dos'],
  [28, 'Parapluie'],
  [31, 'Sac à main'],
  [32, 'Cravate'],
  [33, 'Valise'],
  [34, 'Frisbee'],
  [35, 'Skis'],
  [36, 'Snowboard'],
  [37, 'Ballon'],
  [38, 'Cerf-volant'],
  [39, 'Batte'],
  [40, 'Gant'],
  [41, 'Skateboard'],
  [42, 'Planche de surf'],
  [43, 'Raquette'],
  [44, 'Bouteille'],
  [46, 'Verre'],
  [47, 'Tasse'],
  [48, 'Fourchette'],
  [49, 'Couteau'],
  [50, 'Cuillère'],
  [51, 'Bol'],
  [52, 'Banane'],
  [53, 'Pomme'],
  [54, 'Sandwich'],
  [55, 'Orange'],
  [56, 'Brocoli'],
  [57, 'Carotte'],
  [58, 'Hot-dog'],
  [59, 'Pizza'],
  [60, 'Donut'],
  [61, 'Gâteau'],
  [62, 'Chaise'],
  [63, 'Canapé'],
  [64, 'Plante'],
  [65, 'Lit'],
  [67, 'Table'],
  [70, 'Toilettes'],
  [72, 'Télévision'],
  [73, 'Ordinateur portable'],
  [74, 'Souris'],
  [75, 'Télécommande'],
  [76, 'Clavier'],
  [77, 'Téléphone'],
  [78, 'Micro-ondes'],
  [79, 'Four'],
  [80, 'Grille-pain'],
  [81, 'Évier'],
  [82, 'Réfrigérateur'],
  [84, 'Livre'],
  [85, 'Horloge'],
  [86, 'Vase'],
  [87, 'Ciseaux'],
  [88, 'Ours en peluche'],
  [89, 'Sèche-cheveux'],
  [90, 'Brosse à dents'],
]);

const YOLO_COCO_LABELS = [
  'Personne',
  'Vélo',
  'Voiture',
  'Moto',
  'Avion',
  'Bus',
  'Train',
  'Camion',
  'Bateau',
  'Feu de circulation',
  "Bouche d'incendie",
  'Panneau stop',
  'Horodateur',
  'Banc',
  'Oiseau',
  'Chat',
  'Chien',
  'Cheval',
  'Mouton',
  'Vache',
  'Éléphant',
  'Ours',
  'Zèbre',
  'Girafe',
  'Sac à dos',
  'Parapluie',
  'Sac à main',
  'Cravate',
  'Valise',
  'Frisbee',
  'Skis',
  'Snowboard',
  'Ballon',
  'Cerf-volant',
  'Batte',
  'Gant',
  'Skateboard',
  'Planche de surf',
  'Raquette',
  'Bouteille',
  'Verre',
  'Tasse',
  'Fourchette',
  'Couteau',
  'Cuillère',
  'Bol',
  'Banane',
  'Pomme',
  'Sandwich',
  'Orange',
  'Brocoli',
  'Carotte',
  'Hot-dog',
  'Pizza',
  'Donut',
  'Gâteau',
  'Chaise',
  'Canapé',
  'Plante',
  'Lit',
  'Table',
  'Toilettes',
  'Télévision',
  'Ordinateur portable',
  'Souris',
  'Télécommande',
  'Clavier',
  'Téléphone',
  'Micro-ondes',
  'Four',
  'Grille-pain',
  'Évier',
  'Réfrigérateur',
  'Livre',
  'Horloge',
  'Vase',
  'Ciseaux',
  'Ours en peluche',
  'Sèche-cheveux',
  'Brosse à dents',
] as const;

export interface RawRobotDetection {
  box: { height: number; width: number; x: number; y: number };
  confidence: number;
  kind: 'object' | 'person';
  label: string;
}

export interface RobotVisionEngine {
  close?(): Promise<void>;
  detect(image: Buffer, signal: AbortSignal): Promise<RawRobotDetection[]>;
}

interface Yolo26VisionEngineOptions {
  manifestPath: string;
  maxDetections?: number;
  minConfidence?: number;
}

export class Yolo26VisionEngine implements RobotVisionEngine {
  readonly #manifestPath: string;
  readonly #maxDetections: number;
  readonly #minConfidence: number;
  #session: Promise<ort.InferenceSession> | null = null;

  constructor(options: Yolo26VisionEngineOptions) {
    this.#manifestPath = resolve(options.manifestPath);
    this.#maxDetections = options.maxDetections ?? 20;
    this.#minConfidence = options.minConfidence ?? 0.3;
  }

  async detect(
    image: Buffer,
    signal: AbortSignal,
  ): Promise<RawRobotDetection[]> {
    if (signal.aborted) throw signal.reason;
    const session = await (this.#session ??= this.#loadSession());
    const metadata = await sharp(image).metadata();
    const imageWidth = metadata.width ?? 0;
    const imageHeight = metadata.height ?? 0;
    if (imageWidth < 1 || imageHeight < 1)
      throw new Error('Dimensions de l’image caméra invalides.');
    const inputSize = 640;
    const scale = Math.min(inputSize / imageWidth, inputSize / imageHeight);
    const resizedWidth = Math.round(imageWidth * scale);
    const resizedHeight = Math.round(imageHeight * scale);
    const padX = Math.floor((inputSize - resizedWidth) / 2);
    const padY = Math.floor((inputSize - resizedHeight) / 2);
    const { data, info } = await sharp(image)
      .resize(inputSize, inputSize, {
        background: { r: 114, g: 114, b: 114 },
        fit: 'contain',
        position: 'centre',
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3 || data.length !== inputSize * inputSize * 3)
      throw new Error('Image RGB inattendue après redimensionnement YOLO26.');
    if (signal.aborted) throw signal.reason;
    const planeSize = inputSize * inputSize;
    const tensorData = new Float32Array(planeSize * 3);
    for (let pixel = 0; pixel < planeSize; pixel += 1) {
      const source = pixel * 3;
      tensorData[pixel] = (data[source] ?? 0) / 255;
      tensorData[planeSize + pixel] = (data[source + 1] ?? 0) / 255;
      tensorData[planeSize * 2 + pixel] = (data[source + 2] ?? 0) / 255;
    }
    const output = await session.run({
      [session.inputNames[0]!]: new ort.Tensor('float32', tensorData, [
        1,
        3,
        inputSize,
        inputSize,
      ]),
    });
    if (signal.aborted) throw signal.reason;
    const result = output[session.outputNames[0]!];
    if (!result || result.dims.at(-1) !== 6)
      throw new Error('Sortie YOLO26s inattendue.');
    return decodeYolo26Detections(
      result.data as Float32Array,
      {
        imageHeight,
        imageWidth,
        padX,
        padY,
        scale,
      },
      this.#minConfidence,
      this.#maxDetections,
    );
  }

  async #loadSession(): Promise<ort.InferenceSession> {
    const manifest = Yolo26DetectorManifestSchema.parse(
      JSON.parse(await readFile(this.#manifestPath, 'utf8')) as unknown,
    );
    const artifact = manifest.models[0]!;
    const root = dirname(this.#manifestPath);
    const modelPath = resolve(root, artifact.file);
    if (dirname(modelPath) !== root)
      throw new Error('Le modèle doit rester à côté de son manifeste.');
    const model = await readFile(modelPath);
    const digest = createHash('sha256').update(model).digest('hex');
    if (digest !== artifact.sha256)
      throw new Error('Empreinte YOLO26s invalide.');
    const cpuCount = Number.parseInt(
      process.env.NUMBER_OF_PROCESSORS ?? '2',
      10,
    );
    return ort.InferenceSession.create(model, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      interOpNumThreads: 1,
      intraOpNumThreads: Math.max(1, Math.min(4, (cpuCount || 2) - 1)),
    });
  }
}

export function decodeYolo26Detections(
  output: Float32Array,
  geometry: {
    imageHeight: number;
    imageWidth: number;
    padX: number;
    padY: number;
    scale: number;
  },
  minConfidence: number,
  maxDetections: number,
): RawRobotDetection[] {
  const detections: RawRobotDetection[] = [];
  for (
    let offset = 0;
    offset + 5 < output.length && detections.length < maxDetections;
    offset += 6
  ) {
    const confidence = output[offset + 4] ?? 0;
    const classId = Math.round(output[offset + 5] ?? -1);
    const label = YOLO_COCO_LABELS[classId];
    if (confidence < minConfidence || !label) continue;
    const xMin = clamp01(
      ((output[offset] ?? 0) - geometry.padX) /
        geometry.scale /
        geometry.imageWidth,
    );
    const yMin = clamp01(
      ((output[offset + 1] ?? 0) - geometry.padY) /
        geometry.scale /
        geometry.imageHeight,
    );
    const xMax = clamp01(
      ((output[offset + 2] ?? 0) - geometry.padX) /
        geometry.scale /
        geometry.imageWidth,
    );
    const yMax = clamp01(
      ((output[offset + 3] ?? 0) - geometry.padY) /
        geometry.scale /
        geometry.imageHeight,
    );
    if (xMax <= xMin || yMax <= yMin) continue;
    detections.push({
      kind: classId === 0 ? 'person' : 'object',
      label,
      confidence,
      box: { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin },
    });
  }
  return detections;
}

interface MobileNetSsdVisionEngineOptions {
  manifestPath: string;
  maxDetections?: number;
  minConfidence?: number;
}

export class MobileNetSsdVisionEngine implements RobotVisionEngine {
  readonly #manifestPath: string;
  readonly #maxDetections: number;
  readonly #minConfidence: number;
  #session: Promise<ort.InferenceSession> | null = null;

  constructor(options: MobileNetSsdVisionEngineOptions) {
    this.#manifestPath = resolve(options.manifestPath);
    this.#maxDetections = options.maxDetections ?? 20;
    this.#minConfidence = options.minConfidence ?? 0.45;
  }

  async detect(
    image: Buffer,
    signal: AbortSignal,
  ): Promise<RawRobotDetection[]> {
    if (signal.aborted) throw signal.reason;
    const session = await (this.#session ??= this.#loadSession());
    const { data, info } = await sharp(image)
      .resize(300, 300, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3 || data.length !== 300 * 300 * 3)
      throw new Error('Image RGB inattendue après redimensionnement.');
    if (signal.aborted) throw signal.reason;
    const input = new ort.Tensor(
      'uint8',
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      [1, 300, 300, 3],
    );
    const output = await session.run({ inputs: input });
    if (signal.aborted) throw signal.reason;
    const boxes = output.detection_boxes?.data as Float32Array | undefined;
    const classes = output.detection_classes?.data as Float32Array | undefined;
    const scores = output.detection_scores?.data as Float32Array | undefined;
    const counts = output.num_detections?.data as Float32Array | undefined;
    if (!boxes || !classes || !scores || !counts)
      throw new Error('Sortie SSD-MobileNet incomplète.');

    const detections: RawRobotDetection[] = [];
    const count = Math.min(
      Math.floor(counts[0] ?? 0),
      scores.length,
      this.#maxDetections,
    );
    for (let index = 0; index < count; index += 1) {
      const confidence = scores[index] ?? 0;
      const classId = Math.round(classes[index] ?? 0);
      const label = COCO_LABELS.get(classId);
      if (confidence < this.#minConfidence || !label) continue;
      const offset = index * 4;
      const yMin = clamp01(boxes[offset] ?? 0);
      const xMin = clamp01(boxes[offset + 1] ?? 0);
      const yMax = clamp01(boxes[offset + 2] ?? 0);
      const xMax = clamp01(boxes[offset + 3] ?? 0);
      if (xMax <= xMin || yMax <= yMin) continue;
      detections.push({
        kind: classId === 1 ? 'person' : 'object',
        label: classId === 1 ? 'Personne' : label,
        confidence,
        box: { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin },
      });
    }
    return detections;
  }

  async #loadSession(): Promise<ort.InferenceSession> {
    const manifest = SsdDetectorManifestSchema.parse(
      JSON.parse(await readFile(this.#manifestPath, 'utf8')) as unknown,
    );
    const artifact = manifest.models[0]!;
    const root = dirname(this.#manifestPath);
    const modelPath = resolve(root, artifact.file);
    if (dirname(modelPath) !== root)
      throw new Error('Le modèle doit rester à côté de son manifeste.');
    const model = await readFile(modelPath);
    const digest = createHash('sha256').update(model).digest('hex');
    if (digest !== artifact.sha256)
      throw new Error('Empreinte SSD-MobileNet invalide.');
    const cpuCount = Number.parseInt(
      process.env.NUMBER_OF_PROCESSORS ?? '2',
      10,
    );
    return ort.InferenceSession.create(model, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      interOpNumThreads: 1,
      intraOpNumThreads: Math.max(1, Math.min(4, (cpuCount || 2) - 1)),
    });
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export async function* iterateJpegFrames(
  stream: Readable,
  signal: AbortSignal,
  maxBytes = 512 * 1024,
): AsyncGenerator<Buffer> {
  let buffered = Buffer.alloc(0);
  const onAbort = () => stream.destroy(signal.reason as Error | undefined);
  if (signal.aborted) onAbort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for await (const value of stream) {
      buffered = Buffer.concat([
        buffered,
        Buffer.isBuffer(value) ? value : Buffer.from(value),
      ]);
      while (true) {
        const start = buffered.indexOf(Buffer.from([0xff, 0xd8]));
        if (start < 0) {
          if (buffered.length > 1)
            buffered = buffered.subarray(buffered.length - 1);
          break;
        }
        if (start > 0) buffered = buffered.subarray(start);
        const end = buffered.indexOf(Buffer.from([0xff, 0xd9]), 2);
        if (end < 0) break;
        yield Buffer.from(buffered.subarray(0, end + 2));
        buffered = buffered.subarray(end + 2);
      }
      if (buffered.length > maxBytes)
        throw new Error('Image caméra trop volumineuse.');
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export async function captureJpegFrame(
  stream: Readable,
  signal: AbortSignal,
  maxBytes?: number,
): Promise<Buffer> {
  for await (const frame of iterateJpegFrames(stream, signal, maxBytes))
    return frame;
  throw new Error('Aucune image JPEG complète reçue.');
}

interface VisionRobotControllerOptions {
  captureTimeoutMs?: number;
  frameStride?: number;
  imageHeight?: number;
  imageWidth?: number;
  observationTtlMs?: number;
  onError?: (error: unknown) => void;
  reconnectDelayMs?: number;
  startImmediately?: boolean;
}

export class VisionRobotController implements RobotController {
  readonly #base: RobotController;
  #captureAbort = new AbortController();
  readonly #engine: RobotVisionEngine;
  readonly #options: Required<
    Omit<VisionRobotControllerOptions, 'onError' | 'startImmediately'>
  > &
    Pick<VisionRobotControllerOptions, 'onError'>;
  #captureTask: Promise<void> | null = null;
  #closed = false;
  #paused = false;
  #frameId = 0;
  #inference: Promise<void> | null = null;
  #latest: RobotVisionFrame | null = null;
  #latestKeyframe: RobotVisionKeyframe | null = null;
  #lastErrorAt = 0;
  #activeCameraStream: RobotCameraStream | null = null;
  readonly #cameraSubscribers = new Set<PassThrough>();

  constructor(
    base: RobotController,
    engine: RobotVisionEngine,
    options: VisionRobotControllerOptions = {},
  ) {
    this.#base = base;
    this.#engine = engine;
    this.#options = {
      captureTimeoutMs: options.captureTimeoutMs ?? 5_000,
      frameStride: options.frameStride ?? 2,
      imageHeight: options.imageHeight ?? 480,
      imageWidth: options.imageWidth ?? 640,
      observationTtlMs: options.observationTtlMs ?? 2_000,
      reconnectDelayMs: options.reconnectDelayMs ?? 1_000,
      ...(options.onError ? { onError: options.onError } : {}),
    };
    if (options.startImmediately !== false) queueMicrotask(() => this.start());
  }

  start(): void {
    this.resume();
  }

  resume(): void {
    if (
      this.#closed ||
      this.#captureTask ||
      (!this.#paused && this.#frameId > 0)
    )
      return;
    this.#paused = false;
    if (this.#captureAbort.signal.aborted)
      this.#captureAbort = new AbortController();
    const task = this.#captureLoop().finally(() => {
      if (this.#captureTask === task) this.#captureTask = null;
    });
    this.#captureTask = task;
  }

  async pause(): Promise<void> {
    if (this.#closed || this.#paused) return;
    this.#paused = true;
    this.#captureAbort.abort(new Error('Reconnaissance mise en veille.'));
    this.#activeCameraStream?.body.destroy();
    for (const subscriber of this.#cameraSubscribers) subscriber.destroy();
    this.#cameraSubscribers.clear();
    await Promise.allSettled(
      [this.#captureTask, this.#inference].filter(
        (task): task is Promise<void> => task !== null,
      ),
    );
    this.#latest = null;
    this.#latestKeyframe = null;
  }

  async refresh(): Promise<void> {
    if (this.#closed || this.#inference) return;
    const capture = new AbortController();
    const timeout = setTimeout(
      () => capture.abort(new Error('Délai de capture dépassé.')),
      this.#options.captureTimeoutMs,
    );
    let stream: RobotCameraStream | null = null;
    try {
      stream = await this.#base.openCameraStream(capture.signal);
      const frame = await captureJpegFrame(stream.body, capture.signal);
      await this.#analyzeFrame(frame, new Date());
    } finally {
      clearTimeout(timeout);
      stream?.body.destroy();
    }
  }

  async state(): Promise<RobotState> {
    return this.#withVision(await this.#base.state());
  }
  async arm(durationMs: number): Promise<RobotState> {
    return this.#withVision(await this.#base.arm(durationMs));
  }
  async drive(command: RobotDriveRequest): Promise<RobotState> {
    return this.#withVision(await this.#base.drive(command));
  }
  async look(command: RobotCameraLookRequest): Promise<RobotState> {
    return this.#withVision(await this.#base.look(command));
  }
  async setActuators(actuators: RobotActuatorsRequest): Promise<RobotState> {
    return this.#withVision(await this.#base.setActuators(actuators));
  }
  async setMode(mode: RobotOperatingMode): Promise<RobotState> {
    return this.#withVision(await this.#base.setMode(mode));
  }
  async halt(): Promise<RobotState> {
    return this.#withVision(await this.#base.halt());
  }
  async stop(): Promise<RobotState> {
    return this.#withVision(await this.#base.stop());
  }
  cameraBandwidth(): Promise<RobotCameraBandwidthStatus> {
    return this.#base.cameraBandwidth();
  }
  async setCameraBandwidth(
    profile: RobotCameraBandwidthProfile,
  ): Promise<RobotCameraBandwidthStatus> {
    const status = await this.#base.setCameraBandwidth(profile);
    // Fermer seulement la connexion Pi en cours : la boucle se reconnecte
    // avec le nouveau profil sans couper les abonnés caméra de l'interface.
    this.#activeCameraStream?.body.destroy();
    return status;
  }
  async openCameraStream(signal: AbortSignal): Promise<RobotCameraStream> {
    const body = new PassThrough({ highWaterMark: 512 * 1024 });
    const close = () => body.destroy();
    const detach = () => {
      this.#cameraSubscribers.delete(body);
      signal.removeEventListener('abort', close);
    };
    body.once('close', detach);
    if (signal.aborted) close();
    else {
      signal.addEventListener('abort', close, { once: true });
      this.#cameraSubscribers.add(body);
      this.start();
    }
    return {
      body,
      contentType: 'multipart/x-mixed-replace; boundary=FRAME',
    };
  }

  visionKeyframe(frameId: number): RobotVisionKeyframe | null {
    if (this.#latestKeyframe?.frameId !== frameId) return null;
    return {
      ...this.#latestKeyframe,
      image: Buffer.from(this.#latestKeyframe.image),
    };
  }

  async close(): Promise<void> {
    await this.pause();
    this.#closed = true;
    await this.#engine.close?.();
    await this.#base.close();
  }

  async #captureLoop(): Promise<void> {
    let cameraStream: RobotCameraStream | null = null;
    let cameraFrame = 0;
    while (!this.#closed && !this.#paused) {
      try {
        cameraStream = await this.#base.openCameraStream(
          this.#captureAbort.signal,
        );
        this.#activeCameraStream = cameraStream;
        for await (const frame of iterateJpegFrames(
          cameraStream.body,
          this.#captureAbort.signal,
        )) {
          cameraFrame += 1;
          this.#broadcastFrame(frame);
          if (cameraFrame % this.#options.frameStride === 0 && !this.#inference)
            void this.#analyzeFrame(frame, new Date());
        }
      } catch (error) {
        if (!this.#closed && !this.#paused) this.#reportError(error);
      } finally {
        cameraStream?.body.destroy();
        if (this.#activeCameraStream === cameraStream)
          this.#activeCameraStream = null;
        cameraStream = null;
      }
      if (!this.#closed && !this.#paused)
        await abortableDelay(
          this.#options.reconnectDelayMs,
          this.#captureAbort.signal,
        ).catch(() => undefined);
    }
  }

  #broadcastFrame(frame: Buffer): void {
    if (this.#cameraSubscribers.size === 0) return;
    const chunk = Buffer.concat([
      Buffer.from(
        `--FRAME\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.byteLength.toString()}\r\n\r\n`,
      ),
      frame,
      Buffer.from('\r\n'),
    ]);
    for (const subscriber of this.#cameraSubscribers) {
      if (subscriber.destroyed || subscriber.writableNeedDrain) continue;
      subscriber.write(chunk);
    }
  }

  async #analyzeFrame(frame: Buffer, observedAt: Date): Promise<void> {
    if (this.#closed || this.#paused || this.#inference) return;
    const startedAt = Date.now();
    const operation = this.#engine
      .detect(frame, this.#captureAbort.signal)
      .then((detections) => {
        if (this.#closed || this.#paused) return;
        const frameId = ++this.#frameId;
        this.#latest = RobotVisionFrameSchema.parse({
          frameId,
          observedAt: observedAt.toISOString(),
          expiresAt: new Date(
            Date.now() + this.#options.observationTtlMs,
          ).toISOString(),
          imageWidth: this.#options.imageWidth,
          imageHeight: this.#options.imageHeight,
          processingMs: Date.now() - startedAt,
          detections: detections.map((detection, index) => ({
            id: `${frameId.toString()}-${index.toString()}-${detection.kind}`,
            kind: detection.kind,
            label: detection.kind === 'person' ? 'Personne' : detection.label,
            confidence: detection.confidence,
            x: detection.box.x,
            y: detection.box.y,
            width: detection.box.width,
            height: detection.box.height,
            trackId: null,
          })),
        });
        this.#latestKeyframe = {
          frameId,
          image: Buffer.from(frame),
          observedAt: observedAt.toISOString(),
        };
      })
      .catch((error: unknown) => {
        if (!this.#closed && !this.#paused) this.#reportError(error);
      })
      .finally(() => {
        if (this.#inference === operation) this.#inference = null;
      });
    this.#inference = operation;
    await operation;
  }

  #reportError(error: unknown): void {
    const now = Date.now();
    if (now - this.#lastErrorAt < 10_000) return;
    this.#lastErrorAt = now;
    this.#options.onError?.(error);
  }

  #withVision(state: RobotState): RobotState {
    const vision =
      this.#latest && Date.parse(this.#latest.expiresAt) > Date.now()
        ? this.#latest
        : null;
    const capabilities: RobotState['capabilities'] = [
      ...new Set([
        ...state.capabilities,
        'vision_objects',
        'vision_people',
      ] as const),
    ];
    return { ...state, capabilities, vision };
  }
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolveDelay, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolveDelay();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
