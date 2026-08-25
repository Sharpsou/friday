import { parentPort, workerData } from 'node:worker_threads';

import { z } from 'zod';

import { Yolo26VisionEngine } from './robot-vision.js';

const WorkerOptionsSchema = z
  .object({
    manifestPath: z.string().min(1),
    maxDetections: z.number().int().min(1).max(100).optional(),
    minConfidence: z.number().min(0.1).max(0.95).optional(),
  })
  .strict();
const WorkerRequestSchema = z
  .object({
    id: z.number().int().positive(),
    image: z.instanceof(Uint8Array),
  })
  .strict();

if (!parentPort) throw new Error('Worker YOLO26s lancé sans port parent.');
const port = parentPort;
const options = WorkerOptionsSchema.parse(workerData);
const engine = new Yolo26VisionEngine({
  manifestPath: options.manifestPath,
  ...(options.maxDetections === undefined
    ? {}
    : { maxDetections: options.maxDetections }),
  ...(options.minConfidence === undefined
    ? {}
    : { minConfidence: options.minConfidence }),
});
let queue = Promise.resolve();

port.on('message', (payload: unknown) => {
  queue = queue.then(async () => {
    const request = WorkerRequestSchema.parse(payload);
    try {
      const detections = await engine.detect(
        Buffer.from(request.image),
        new AbortController().signal,
      );
      port.postMessage({ id: request.id, detections });
    } catch (error) {
      port.postMessage({
        id: request.id,
        error:
          error instanceof Error
            ? error.message
            : 'Erreur inconnue du worker YOLO26s.',
      });
    }
  });
});
