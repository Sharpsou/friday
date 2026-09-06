import { describe, expect, it } from 'vitest';
import { OllamaClient } from '../src/ollama.js';

describe('bounded inference', () => {
  it('cancels a queued call before the active inference completes', async () => {
    let release!: () => void;
    let started!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    const client = new OllamaClient({
      fetchImplementation: async () => {
        calls++;
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new Response(JSON.stringify({ response: 'ok', done: true }));
      },
    });
    const first = client.generate({
      model: 'test',
      prompt: 'Premier',
      seed: 1,
    });
    await active;
    const controller = new AbortController();
    const queued = client.generate({
      model: 'test',
      prompt: 'Second',
      seed: 1,
      signal: controller.signal,
    });
    controller.abort();
    await expect(queued).rejects.toThrow();
    expect(calls).toBe(1);
    release();
    await first;
  });
  it('rejects truncated output and input that cannot fit the selected context', async () => {
    const client = new OllamaClient({
      fetchImplementation: async () =>
        new Response(
          JSON.stringify({
            response: 'Phrase inachevée',
            done: true,
            done_reason: 'length',
          }),
        ),
    });
    await expect(
      client.generate({ model: 'test', prompt: 'Une question', seed: 1 }),
    ).rejects.toThrow('OLLAMA_OUTPUT_TRUNCATED');
    await expect(
      client.generate({
        model: 'test',
        prompt: 'x'.repeat(8000),
        contextTokens: 8192,
        maxTokens: 2000,
        seed: 1,
      }),
    ).rejects.toThrow('OLLAMA_CONTEXT_BUDGET_EXCEEDED');
  });
});
