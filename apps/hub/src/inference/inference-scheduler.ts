import { OllamaClient } from '@friday/assistant-core';
type OllamaClientOptions = ConstructorParameters<typeof OllamaClient>[0];
type GenerateRequest = Parameters<OllamaClient['generate']>[0];
type EmbedRequest = Parameters<OllamaClient['embed']>[0];

export type InferenceKind =
  'chat' | 'menus' | 'watch' | 'classification' | 'photo';
type Ticket = {
  kind: InferenceKind;
  signal: AbortSignal | undefined;
  resolve: () => void;
  reject: (error: Error) => void;
  abort: () => void;
};
/** One Hub-wide lease, held until the complete response has been consumed. */
export class InferenceScheduler {
  private active: { kind: InferenceKind; startedAt: string } | null = null;
  private readonly waiting: Ticket[] = [];
  constructor(private readonly capacity = 64) {}
  status() {
    const queued = { chat: 0, menus: 0, watch: 0, classification: 0, photo: 0 };
    for (const ticket of this.waiting) queued[ticket.kind] += 1;
    return { active: this.active, queued };
  }
  async run<T>(
    kind: InferenceKind,
    signal: AbortSignal | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (this.active) {
      if (this.waiting.length >= this.capacity)
        throw new Error('INFERENCE_QUEUE_FULL');
      await new Promise<void>((resolve, reject) => {
        const ticket: Ticket = {
          kind,
          signal,
          resolve,
          reject,
          abort: () => {
            const index = this.waiting.indexOf(ticket);
            if (index >= 0) this.waiting.splice(index, 1);
            reject(new DOMException('Aborted', 'AbortError'));
          },
        };
        this.waiting.push(ticket);
        signal?.addEventListener('abort', ticket.abort, { once: true });
      });
    } else this.active = { kind, startedAt: new Date().toISOString() };
    try {
      signal?.throwIfAborted();
      return await action();
    } finally {
      const next = this.waiting.shift();
      if (next) {
        next.signal?.removeEventListener('abort', next.abort);
        this.active = { kind: next.kind, startedAt: new Date().toISOString() };
        next.resolve();
      } else this.active = null;
    }
  }
}
export class ScheduledOllamaClient extends OllamaClient {
  constructor(
    private readonly scheduler: InferenceScheduler,
    private readonly kind: InferenceKind,
    options: OllamaClientOptions = {},
  ) {
    super(options);
  }
  override generate(request: GenerateRequest) {
    return this.scheduler.run(this.kind, request.signal, () =>
      super.generate(request),
    );
  }
  override embed(request: EmbedRequest) {
    return this.scheduler.run(this.kind, request.signal, () =>
      super.embed(request),
    );
  }
}
