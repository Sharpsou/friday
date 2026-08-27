import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface RobotVisualMask {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface RobotPlaceSignatureFeatures {
  descriptors: string;
  featureCount: number;
  keypoints: Array<[number, number, number]>;
  luminance: number;
  perceptualHash: string;
  quality: number;
}

export interface RobotPlaceCandidate extends RobotPlaceSignatureFeatures {
  id: string;
}

export interface RobotPlaceMatch {
  candidateId: string;
  coverage: number;
  inlierRatio: number;
  inliers: number;
  rawMatches: number;
  rotationRad: number;
  score: number;
}

export interface RobotVisualMotionFeatures {
  coherence: number;
  medianFlowPx: number;
  rotationRad: number;
  scaleDelta: number;
  trackCount: number;
}

export interface RobotPlaceRecognitionEngine {
  close(): Promise<void>;
  extract(
    image: Buffer,
    masks: RobotVisualMask[],
    signal?: AbortSignal,
  ): Promise<RobotPlaceSignatureFeatures>;
  match(
    probe: RobotPlaceSignatureFeatures,
    candidates: RobotPlaceCandidate[],
    signal?: AbortSignal,
  ): Promise<RobotPlaceMatch[]>;
  motion(
    previousImage: Buffer,
    currentImage: Buffer,
    signal?: AbortSignal,
  ): Promise<RobotVisualMotionFeatures>;
}

interface PendingRequest {
  reject: (reason: unknown) => void;
  resolve: (value: unknown) => void;
  timer: NodeJS.Timeout;
}

interface WorkerResponse {
  error?: string;
  id: number | null;
  result?: unknown;
}

export class OpenCvPlaceRecognitionEngine implements RobotPlaceRecognitionEngine {
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 0;
  private closed = false;

  constructor(
    private readonly workerPath: string,
    private readonly pythonPath = 'python',
    private readonly timeoutMs = 3_500,
  ) {}

  async extract(
    image: Buffer,
    masks: RobotVisualMask[],
    signal?: AbortSignal,
  ): Promise<RobotPlaceSignatureFeatures> {
    return (await this.request(
      {
        operation: 'extract',
        image: image.toString('base64'),
        masks,
      },
      signal,
    )) as RobotPlaceSignatureFeatures;
  }

  async match(
    probe: RobotPlaceSignatureFeatures,
    candidates: RobotPlaceCandidate[],
    signal?: AbortSignal,
  ): Promise<RobotPlaceMatch[]> {
    const result = (await this.request(
      { operation: 'match', probe, candidates },
      signal,
    )) as { matches: RobotPlaceMatch[] };
    return result.matches;
  }

  async motion(
    previousImage: Buffer,
    currentImage: Buffer,
    signal?: AbortSignal,
  ): Promise<RobotVisualMotionFeatures> {
    return (await this.request(
      {
        operation: 'motion',
        previousImage: previousImage.toString('base64'),
        currentImage: currentImage.toString('base64'),
      },
      signal,
    )) as RobotVisualMotionFeatures;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.fail(new Error('Worker de reconnaissance visuelle fermé.'));
    const process = this.process;
    this.process = null;
    if (!process || process.killed) return;
    process.kill();
    await new Promise<void>((resolve) => {
      process.once('exit', () => resolve());
      setTimeout(resolve, 500).unref();
    });
  }

  private request(payload: object, signal?: AbortSignal): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new Error('Worker de localisation fermé.'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const process = this.ensureProcess();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const abort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        signal?.removeEventListener('abort', abort);
        reject(
          new Error('Délai du worker de reconnaissance visuelle dépassé.'),
        );
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve(value) {
          signal?.removeEventListener('abort', abort);
          resolve(value);
        },
        reject(reason) {
          signal?.removeEventListener('abort', abort);
          reject(reason);
        },
        timer,
      });
      signal?.addEventListener('abort', abort, { once: true });
      process.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
    });
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) return this.process;
    const process = spawn(this.pythonPath, ['-u', this.workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.process = process;
    const lines = createInterface({ input: process.stdout });
    lines.on('line', (line) => this.handleLine(line));
    let stderr = '';
    process.stderr.setEncoding('utf8');
    process.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-1_000);
    });
    process.once('error', (error) => this.fail(error));
    process.once('exit', (code) => {
      if (this.process === process) this.process = null;
      if (!this.closed)
        this.fail(
          new Error(
            `Worker de localisation arrêté (${code?.toString() ?? 'signal'}): ${stderr.trim()}`,
          ),
        );
    });
    return process;
  }

  private handleLine(line: string): void {
    let response: WorkerResponse;
    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch {
      this.fail(
        new Error('Réponse invalide du worker de reconnaissance visuelle.'),
      );
      return;
    }
    if (response.id === null) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.error) pending.reject(new Error(response.error));
    else pending.resolve(response.result);
  }

  private fail(error: unknown): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
