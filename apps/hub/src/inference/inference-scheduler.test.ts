import { expect, it } from 'vitest';
import {
  InferenceScheduler,
  ScheduledOllamaClient,
} from './inference-scheduler.js';

it('serializes all inference kinds, preserves FIFO and removes cancelled waiters', async () => {
  const scheduler = new InferenceScheduler();
  const order: string[] = [];
  let release!: () => void;
  const first = scheduler.run('chat', undefined, async () => {
    order.push('chat');
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const cancelled = new AbortController();
  const second = scheduler.run('photo', cancelled.signal, async () => {
    order.push('photo');
  });
  const rejection = expect(second).rejects.toMatchObject({
    name: 'AbortError',
  });
  const third = scheduler.run('menus', undefined, async () => {
    order.push('menus');
  });
  const fourth = scheduler.run('classification', undefined, async () => {
    order.push('classification');
  });
  const fifth = scheduler.run('watch', undefined, async () => {
    order.push('watch');
  });
  expect(scheduler.status()).toMatchObject({
    active: { kind: 'chat' },
    queued: { photo: 1, menus: 1, watch: 1, classification: 1 },
  });
  cancelled.abort();
  await rejection;
  release();
  await Promise.all([first, third, fourth, fifth]);
  expect(order).toEqual(['chat', 'menus', 'classification', 'watch']);
  expect(scheduler.status().active).toBeNull();
});
it('bounds the queue and releases the next call after an inference error', async () => {
  const scheduler = new InferenceScheduler(1);
  let release!: () => void;
  const first = scheduler.run(
    'chat',
    undefined,
    async () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const second = scheduler.run('menus', undefined, async () => {
    throw new Error('failed');
  });
  const rejected = expect(second).rejects.toThrow('failed');
  await expect(
    scheduler.run('watch', undefined, async () => undefined),
  ).rejects.toThrow('INFERENCE_QUEUE_FULL');
  release();
  await first;
  await rejected;
  expect(scheduler.status().active).toBeNull();
});
it('holds the lease until response consumption and starts Ollama timeout after acquisition', async () => {
  const scheduler = new InferenceScheduler();
  let release!: () => void;
  const first = scheduler.run(
    'chat',
    undefined,
    async () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  let seenSignal: AbortSignal | null = null;
  const client = new ScheduledOllamaClient(scheduler, 'menus', {
    timeoutMs: 100,
    fetchImplementation: async (_url, init) => {
      seenSignal = init?.signal ?? null;
      return new Response(JSON.stringify({ response: 'ok' }));
    },
  });
  const waiting = client.generate({ model: 'test', prompt: 'recipe', seed: 1 });
  expect(seenSignal).toBeNull();
  release();
  await first;
  expect((await waiting).response).toBe('ok');
  expect(seenSignal).not.toBeNull();
});
