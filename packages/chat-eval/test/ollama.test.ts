import { describe, expect, it, vi } from 'vitest';

import { OllamaClient } from '../src/ollama.js';

describe('OllamaClient', () => {
  it('rejects every non-local endpoint', () => {
    expect(
      () => new OllamaClient({ baseUrl: 'https://ollama.example' }),
    ).toThrow('OLLAMA_BASE_URL_MUST_BE_LOCAL');
    expect(
      () => new OllamaClient({ baseUrl: 'http://user:pass@localhost:11434' }),
    ).toThrow('OLLAMA_BASE_URL_MUST_BE_LOCAL');
  });

  it('sends structured output through format without copying it into the prompt', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.prompt).toBe('audit bref');
      expect(body.format).toEqual({ type: 'object' });
      return new Response(
        JSON.stringify({ response: '{"units":[]}', eval_count: 4 }),
        { status: 200 },
      );
    });
    const client = new OllamaClient({ fetchImplementation });
    await expect(
      client.generate({
        model: 'qwen3.5:9b-q4_K_M',
        prompt: 'audit bref',
        seed: 1,
        format: { type: 'object' },
      }),
    ).resolves.toMatchObject({ response: '{"units":[]}', outputTokens: 4 });
  });

  it('rejects oversized and malformed responses without repair recursion', async () => {
    const tooLarge = new OllamaClient({
      maxResponseBytes: 1_024,
      fetchImplementation: async () =>
        new Response('x'.repeat(1_025), { status: 200 }),
    });
    await expect(
      tooLarge.generate({ model: 'gemma4:e4b', prompt: 'p', seed: 1 }),
    ).rejects.toThrow('OLLAMA_RESPONSE_TOO_LARGE');

    const malformed = new OllamaClient({
      fetchImplementation: async () => new Response('{no', { status: 200 }),
    });
    await expect(
      malformed.generate({ model: 'gemma4:e4b', prompt: 'p', seed: 1 }),
    ).rejects.toThrow('OLLAMA_INVALID_ENVELOPE');
  });

  it('never exceeds its configured concurrency during queue handoff', async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const client = new OllamaClient({
      maxConcurrency: 1,
      fetchImplementation: async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return new Response(JSON.stringify({ response: 'ok' }), {
          status: 200,
        });
      },
    });
    const first = client.generate({ model: 'model', prompt: 'one', seed: 1 });
    const second = client.generate({ model: 'model', prompt: 'two', seed: 2 });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await Promise.all([first, second]);
    expect(maximum).toBe(1);
  });
});
