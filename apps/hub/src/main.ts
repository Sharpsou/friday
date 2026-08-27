import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHub } from './app.js';
import {
  DisabledRobotController,
  HttpRobotController,
  type RobotController,
} from './robot/robot-controller.js';
import { VisionRobotController } from './robot/robot-vision.js';
import {
  HttpRobotPowerClient,
  NetworkStandbyRobotController,
} from './robot/robot-power.js';
import { WorkerRobotVisionEngine } from './robot/robot-vision-worker-client.js';
import { OpenCvPlaceRecognitionEngine } from './robot/robot-place-recognition.js';

process.on('uncaughtExceptionMonitor', (error, origin) => {
  console.error('Friday Hub uncaught exception:', origin, error);
});
process.once('exit', (code) => {
  console.error(`Friday Hub process exit: ${code.toString()}`);
});

const host = process.env.FRIDAY_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.FRIDAY_PORT ?? '8443', 10);
const defaultDataDirectory = process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, 'Friday')
  : resolve('data');
const databasePath =
  process.env.FRIDAY_DATABASE_PATH ??
  resolve(process.env.FRIDAY_DATA_DIR ?? defaultDataDirectory, 'friday.sqlite');
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));

const certPath = process.env.FRIDAY_TLS_CERT_PATH;
const keyPath = process.env.FRIDAY_TLS_KEY_PATH;
const tlsConfigured = Boolean(certPath && keyPath);
const publicOrigin =
  process.env.FRIDAY_PUBLIC_ORIGIN ??
  `${tlsConfigured ? 'https' : 'http'}://${host}:${port.toString()}`;
const authTrustedOrigins = process.env.FRIDAY_TRUSTED_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
const authAttemptLimitRaw = process.env.FRIDAY_AUTH_ATTEMPT_LIMIT;
const authAttemptLimit = authAttemptLimitRaw
  ? Number.parseInt(authAttemptLimitRaw, 10)
  : undefined;
const ollamaTimeoutRaw = process.env.FRIDAY_GROCERY_CLASSIFICATION_TIMEOUT_MS;
const ollamaTimeoutMs = ollamaTimeoutRaw
  ? Number.parseInt(ollamaTimeoutRaw, 10)
  : undefined;
const photoTranscriptionTimeoutRaw =
  process.env.FRIDAY_GROCERY_PHOTO_TIMEOUT_MS;
const photoTranscriptionTimeoutMs = photoTranscriptionTimeoutRaw
  ? Number.parseInt(photoTranscriptionTimeoutRaw, 10)
  : undefined;
const robotMode = process.env.FRIDAY_ROBOT_MODE ?? 'disabled';

if (!['disabled', 'alphabot2'].includes(robotMode)) {
  throw new Error('FRIDAY_ROBOT_MODE doit valoir disabled ou alphabot2.');
}

if (
  robotMode === 'alphabot2' &&
  (!process.env.FRIDAY_ROBOT_URL || !process.env.FRIDAY_ROBOT_TOKEN)
) {
  throw new Error(
    'FRIDAY_ROBOT_URL et FRIDAY_ROBOT_TOKEN sont requis en mode alphabot2.',
  );
}

const robotVisionEnabled =
  robotMode === 'alphabot2' &&
  process.env.FRIDAY_ROBOT_VISION_ENABLED !== 'false';
const robotPlaceRecognitionEnabled =
  robotVisionEnabled &&
  process.env.FRIDAY_ROBOT_PLACE_RECOGNITION_ENABLED !== 'false';
const robotVisionFrameStrideRaw = process.env.FRIDAY_ROBOT_VISION_FRAME_STRIDE;
const robotVisionFrameStride = Number.parseInt(
  robotVisionFrameStrideRaw ?? '2',
  10,
);
const robotVisionConfidenceRaw = process.env.FRIDAY_ROBOT_VISION_CONFIDENCE;
const robotVisionConfidence = Number.parseFloat(
  robotVisionConfidenceRaw ?? '0.30',
);
if (
  !Number.isSafeInteger(robotVisionFrameStride) ||
  robotVisionFrameStride < 1 ||
  robotVisionFrameStride > 30
) {
  throw new Error(
    'FRIDAY_ROBOT_VISION_FRAME_STRIDE doit être un entier entre 1 et 30.',
  );
}
if (
  !Number.isFinite(robotVisionConfidence) ||
  robotVisionConfidence < 0.1 ||
  robotVisionConfidence > 0.95
) {
  throw new Error(
    'FRIDAY_ROBOT_VISION_CONFIDENCE doit être compris entre 0.1 et 0.95.',
  );
}
const wakeUrl = process.env.FRIDAY_ROBOT_WAKE_URL;
const wakeToken = process.env.FRIDAY_ROBOT_WAKE_TOKEN;
if (Boolean(wakeUrl) !== Boolean(wakeToken))
  throw new Error(
    'FRIDAY_ROBOT_WAKE_URL et FRIDAY_ROBOT_WAKE_TOKEN doivent être configurés ensemble.',
  );
const baseRobotController =
  robotMode === 'alphabot2'
    ? new HttpRobotController(
        process.env.FRIDAY_ROBOT_URL!,
        process.env.FRIDAY_ROBOT_TOKEN!,
      )
    : new DisabledRobotController();
const visionRobotController = robotVisionEnabled
  ? new VisionRobotController(
      baseRobotController,
      new WorkerRobotVisionEngine({
        manifestPath:
          process.env.FRIDAY_ROBOT_VISION_MANIFEST_PATH ??
          resolve(
            process.env.FRIDAY_DATA_DIR ?? defaultDataDirectory,
            'robot',
            'models',
            'manifest.json',
          ),
        minConfidence: robotVisionConfidence,
      }),
      {
        frameStride: robotVisionFrameStride,
        startImmediately: !wakeUrl,
        onError(error) {
          console.warn(
            'Reconnaissance robot temporairement indisponible:',
            error instanceof Error ? error.message : error,
          );
        },
      },
    )
  : baseRobotController;
let robotController: RobotController = visionRobotController;
if (wakeUrl && wakeToken) {
  const standby = new NetworkStandbyRobotController(
    visionRobotController,
    new HttpRobotPowerClient(wakeUrl, wakeToken),
    visionRobotController instanceof VisionRobotController
      ? visionRobotController
      : undefined,
  );
  await standby.initialize();
  robotController = standby;
}
const robotPlaceRecognition = robotPlaceRecognitionEnabled
  ? new OpenCvPlaceRecognitionEngine(
      process.env.FRIDAY_ROBOT_PLACE_RECOGNITION_WORKER_PATH ??
        resolve('tools', 'robot-localization', 'place-worker.py'),
      process.env.FRIDAY_ROBOT_PLACE_RECOGNITION_PYTHON ?? 'python',
    )
  : undefined;

if (
  ollamaTimeoutRaw &&
  (!Number.isSafeInteger(ollamaTimeoutMs) || (ollamaTimeoutMs ?? 0) < 1_000)
) {
  throw new Error(
    'FRIDAY_GROCERY_CLASSIFICATION_TIMEOUT_MS doit être un entier supérieur ou égal à 1000.',
  );
}

if (
  photoTranscriptionTimeoutRaw &&
  (!Number.isSafeInteger(photoTranscriptionTimeoutMs) ||
    (photoTranscriptionTimeoutMs ?? 0) < 1_000)
) {
  throw new Error(
    'FRIDAY_GROCERY_PHOTO_TIMEOUT_MS doit être un entier supérieur ou égal à 1000.',
  );
}

if (
  authAttemptLimit !== undefined &&
  (!Number.isInteger(authAttemptLimit) || authAttemptLimit <= 0)
) {
  throw new Error('FRIDAY_AUTH_ATTEMPT_LIMIT doit être un entier positif.');
}

if (host !== '127.0.0.1' && host !== 'localhost' && !tlsConfigured) {
  throw new Error(
    'Friday refuse une écoute LAN sans FRIDAY_TLS_CERT_PATH et FRIDAY_TLS_KEY_PATH.',
  );
}

const https =
  tlsConfigured && certPath && keyPath
    ? {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
      }
    : undefined;
const app = await buildHub({
  ...(authAttemptLimit !== undefined ? { authAttemptLimit } : {}),
  ...(authTrustedOrigins ? { authTrustedOrigins } : {}),
  ...(process.env.FRIDAY_AUTH_SECRET
    ? { authSecret: process.env.FRIDAY_AUTH_SECRET }
    : {}),
  databasePath,
  ...(https ? { https } : {}),
  logger: true,
  ...(process.env.FRIDAY_OLLAMA_URL
    ? { ollamaBaseUrl: process.env.FRIDAY_OLLAMA_URL }
    : {}),
  ...(process.env.FRIDAY_GROCERY_CLASSIFICATION_MODEL
    ? { ollamaModel: process.env.FRIDAY_GROCERY_CLASSIFICATION_MODEL }
    : {}),
  ...(ollamaTimeoutMs ? { ollamaTimeoutMs } : {}),
  ...(process.env.FRIDAY_GROCERY_PHOTO_MODEL
    ? { photoTranscriptionModel: process.env.FRIDAY_GROCERY_PHOTO_MODEL }
    : {}),
  ...(photoTranscriptionTimeoutMs ? { photoTranscriptionTimeoutMs } : {}),
  publicOrigin,
  robotController,
  ...(robotPlaceRecognition ? { robotPlaceRecognition } : {}),
  webRoot,
});

await app.listen({ host, port });
