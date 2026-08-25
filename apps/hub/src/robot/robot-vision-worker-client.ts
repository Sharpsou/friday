import { Worker } from 'node:worker_threads';

import type { RawRobotDetection, RobotVisionEngine } from './robot-vision.js';

interface WorkerRobotVisionEngineOptions {
  manifestPath: string;
  maxDetections?: number;
  minConfidence?: number;
}

interface WorkerResponse {
  detections?: RawRobotDetection[];
  error?: string;
  id: number;
}

interface PendingDetection {
  cleanup: () => void;
  reject: (error: unknown) => void;
  resolve: (detections: RawRobotDetection[]) => void;
}

export class WorkerRobotVisionEngine implements RobotVisionEngine {
  readonly #worker: Worker;
  readonly #pending = new Map<number, PendingDetection>();
  #closed = false;
  #nextId = 0;

  constructor(options: WorkerRobotVisionEngineOptions) {
    this.#worker = new Worker(
      new URL('./robot/robot-vision-worker.js', import.meta.url),
      { workerData: options },
    );
    this.#worker.on('message', (message: WorkerResponse) =>
      this.#handleMessage(message),
    );
    this.#worker.on('error', (error) => this.#fail(error));
    this.#worker.on('exit', (code) => {
      if (!this.#closed && code !== 0)
        this.#fail(
          new Error(
            `Le worker YOLO26s s’est arrêté avec le code ${code.toString()}.`,
          ),
        );
    });
  }

  detect(image: Buffer, signal: AbortSignal): Promise<RawRobotDetection[]> {
    if (this.#closed)
      return Promise.reject(new Error('Le worker YOLO26s est fermé.'));
    if (signal.aborted) return Promise.reject(signal.reason);
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.#pending.delete(id);
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      const cleanup = () => signal.removeEventListener('abort', abort);
      this.#pending.set(id, { cleanup, reject, resolve });
      signal.addEventListener('abort', abort, { once: true });
      const bytes = new Uint8Array(image.byteLength);
      bytes.set(image);
      this.#worker.postMessage({ id, image: bytes }, [
        bytes.buffer as ArrayBuffer,
      ]);
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#fail(new Error('Le worker YOLO26s est fermé.'));
    await this.#worker.terminate();
  }

  #handleMessage(message: WorkerResponse): void {
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    pending.cleanup();
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.detections ?? []);
  }

  #fail(error: unknown): void {
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
