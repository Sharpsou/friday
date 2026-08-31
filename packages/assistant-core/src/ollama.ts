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

export interface EmbedRequest {
  model: string;
  input: string[];
  signal?: AbortSignal;
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
    if (this.waiting.length >= this.maxQueueSize)
      throw new Error('OLLAMA_QUEUE_FULL');
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
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('OLLAMA_BASE_URL_MUST_BE_LOCAL');
  }
  return url;
}

function positiveInteger(
  value: number,
  minimum: number,
  maximum: number,
  code: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(code);
  return value;
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new Error('OLLAMA_RESPONSE_TOO_LARGE');
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
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.gate = new BoundedGate(
      positiveInteger(
        options.maxConcurrency ?? 1,
        1,
        4,
        'INVALID_OLLAMA_CONCURRENCY',
      ),
      positiveInteger(
        options.maxQueueSize ?? 8,
        1,
        100,
        'INVALID_OLLAMA_QUEUE_LIMIT',
      ),
    );
  }

  private async post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<{ raw: string; durationMs: number }> {
    return this.gate.run(async () => {
      const combinedSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
        : AbortSignal.timeout(this.timeoutMs);
      const startedAt = performance.now();
      let response: Response;
      try {
        response = await this.fetchImplementation(new URL(path, this.baseUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
      } catch (error) {
        throw new Error(
          combinedSignal.aborted
            ? 'OLLAMA_TIMEOUT_OR_CANCELLED'
            : 'OLLAMA_UNAVAILABLE',
          { cause: error },
        );
      }
      const raw = await readBounded(response, this.maxResponseBytes);
      if (!response.ok)
        throw new Error(`OLLAMA_HTTP_${response.status.toString()}`);
      return { raw, durationMs: Math.round(performance.now() - startedAt) };
    });
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u.test(request.model))
      throw new Error('INVALID_MODEL_NAME');
    if (request.prompt.length < 1 || request.prompt.length > 200_000)
      throw new Error('INVALID_PROMPT_SIZE');
    const maxTokens = positiveInteger(
      request.maxTokens ?? 4_096,
      1,
      16_384,
      'INVALID_TOKEN_LIMIT',
    );
    const result = await this.post(
      '/api/generate',
      {
        model: request.model,
        prompt: request.prompt,
        stream: false,
        think: false,
        ...(request.format === undefined ? {} : { format: request.format }),
        options: {
          seed: request.seed,
          temperature: request.temperature ?? 0,
          num_predict: maxTokens,
        },
      },
      request.signal,
    );
    let payload: unknown;
    try {
      payload = JSON.parse(result.raw);
    } catch {
      throw new Error('OLLAMA_INVALID_ENVELOPE');
    }
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('response' in payload) ||
      typeof payload.response !== 'string'
    )
      throw new Error('OLLAMA_INVALID_ENVELOPE');
    return {
      response: payload.response,
      durationMs: result.durationMs,
      ...('prompt_eval_count' in payload &&
      typeof payload.prompt_eval_count === 'number'
        ? { promptTokens: payload.prompt_eval_count }
        : {}),
      ...('eval_count' in payload && typeof payload.eval_count === 'number'
        ? { outputTokens: payload.eval_count }
        : {}),
    };
  }

  async embed(request: EmbedRequest): Promise<number[][]> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u.test(request.model))
      throw new Error('INVALID_MODEL_NAME');
    if (
      request.input.length < 1 ||
      request.input.length > 100 ||
      request.input.some((value) => value.length < 1 || value.length > 8_000)
    )
      throw new Error('INVALID_EMBED_INPUT');
    const result = await this.post(
      '/api/embed',
      { model: request.model, input: request.input, truncate: true },
      request.signal,
    );
    let payload: unknown;
    try {
      payload = JSON.parse(result.raw);
    } catch {
      throw new Error('OLLAMA_INVALID_ENVELOPE');
    }
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('embeddings' in payload) ||
      !Array.isArray(payload.embeddings)
    )
      throw new Error('OLLAMA_INVALID_EMBEDDINGS');
    const embeddings = payload.embeddings;
    if (
      embeddings.length !== request.input.length ||
      embeddings.some(
        (vector) =>
          !Array.isArray(vector) ||
          vector.length === 0 ||
          vector.some(
            (value) => typeof value !== 'number' || !Number.isFinite(value),
          ),
      )
    )
      throw new Error('OLLAMA_INVALID_EMBEDDINGS');
    return embeddings as number[][];
  }
}
