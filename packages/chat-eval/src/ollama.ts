export interface OllamaClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxConcurrency?: number;
  maxQueueSize?: number;
  fetchImplementation?: typeof fetch;
}

export interface GenerateRequest {
  model: string;
  prompt: string;
  seed: number;
  format?: object | 'json';
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  response: string;
  durationMs: number;
  promptTokens?: number;
  outputTokens?: number;
}

class BoundedGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxQueueSize: number,
  ) {}

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    if (this.waiting.length >= this.maxQueueSize) {
      throw new Error('OLLAMA_QUEUE_FULL');
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }
}

function validatedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('OLLAMA_BASE_URL_MUST_BE_LOCAL');
  }
  return url;
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength > maxBytes) throw new Error('OLLAMA_RESPONSE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('OLLAMA_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function positiveInteger(
  value: number,
  minimum: number,
  maximum: number,
  code: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(code);
  }
  return value;
}

export class OllamaClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly gate: BoundedGate;

  constructor(options: OllamaClientOptions = {}) {
    this.baseUrl = validatedBaseUrl(
      options.baseUrl ?? 'http://127.0.0.1:11434',
    );
    this.timeoutMs = positiveInteger(
      options.timeoutMs ?? 120_000,
      100,
      600_000,
      'INVALID_OLLAMA_TIMEOUT',
    );
    this.maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? 1_000_000,
      1_024,
      10_000_000,
      'INVALID_OLLAMA_RESPONSE_LIMIT',
    );
    const concurrency = positiveInteger(
      options.maxConcurrency ?? 1,
      1,
      4,
      'INVALID_OLLAMA_CONCURRENCY',
    );
    const maxQueueSize = positiveInteger(
      options.maxQueueSize ?? 8,
      1,
      100,
      'INVALID_OLLAMA_QUEUE_LIMIT',
    );
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.gate = new BoundedGate(concurrency, maxQueueSize);
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u.test(request.model)) {
      throw new Error('INVALID_MODEL_NAME');
    }
    if (request.prompt.length < 1 || request.prompt.length > 200_000) {
      throw new Error('INVALID_PROMPT_SIZE');
    }
    const maxTokens = positiveInteger(
      request.maxTokens ?? 4_096,
      1,
      16_384,
      'INVALID_TOKEN_LIMIT',
    );
    return this.gate.run(async () => {
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeoutSignal])
        : timeoutSignal;
      const startedAt = performance.now();
      let response: Response;
      try {
        response = await this.fetchImplementation(
          new URL('/api/generate', this.baseUrl),
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              model: request.model,
              prompt: request.prompt,
              stream: false,
              ...(request.format === undefined
                ? {}
                : { format: request.format }),
              options: {
                seed: request.seed,
                temperature: request.temperature ?? 0,
                num_predict: maxTokens,
              },
            }),
            signal,
          },
        );
      } catch (error) {
        if (signal.aborted) {
          throw new Error('OLLAMA_TIMEOUT_OR_CANCELLED', { cause: error });
        }
        throw new Error('OLLAMA_UNAVAILABLE', { cause: error });
      }
      let raw: string;
      try {
        raw = await readBounded(response, this.maxResponseBytes);
      } catch (error) {
        if (signal.aborted) {
          throw new Error('OLLAMA_TIMEOUT_OR_CANCELLED', { cause: error });
        }
        throw error;
      }
      if (!response.ok)
        throw new Error(`OLLAMA_HTTP_${response.status.toString()}`);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error('OLLAMA_INVALID_ENVELOPE');
      }
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('response' in payload) ||
        typeof payload.response !== 'string'
      ) {
        throw new Error('OLLAMA_INVALID_ENVELOPE');
      }
      return {
        response: payload.response,
        durationMs: Math.round(performance.now() - startedAt),
        ...('prompt_eval_count' in payload &&
        typeof payload.prompt_eval_count === 'number'
          ? { promptTokens: payload.prompt_eval_count }
          : {}),
        ...('eval_count' in payload && typeof payload.eval_count === 'number'
          ? { outputTokens: payload.eval_count }
          : {}),
      };
    });
  }
}
