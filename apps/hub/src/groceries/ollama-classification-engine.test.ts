import { describe, expect, it, vi } from 'vitest';

import { OllamaClassificationEngine } from './ollama-classification-engine.js';

describe('Ollama grocery classification engine', () => {
  it('retries an invalid response, reorders indexes and downgrades low confidence', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: { content: JSON.stringify({ classifications: [] }) },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                classifications: [
                  {
                    index: 1,
                    storeFamilyId: 'pet-store',
                    aisleId: 'food',
                    confidence: 0.4,
                  },
                  {
                    index: 0,
                    storeFamilyId: 'supermarket',
                    aisleId: 'produce',
                    confidence: 0.95,
                  },
                ],
              }),
            },
          }),
          { status: 200 },
        ),
      );
    const engine = new OllamaClassificationEngine({ fetch: fetcher });

    const result = await engine.classify(
      ['Pommes', 'Croquettes Nouchka'],
      new AbortController().signal,
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    const request = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
      think: boolean;
    };
    expect(request.think).toBe(false);
    expect(
      JSON.parse(
        request.messages.find((message) => message.role === 'user')!.content,
      ),
    ).toEqual({
      items: [
        { index: 0, label: 'Pommes' },
        { index: 1, label: 'Croquettes Nouchka' },
      ],
    });
    expect(result).toEqual([
      {
        storeFamilyId: 'supermarket',
        aisleId: 'produce',
        confidence: 0.95,
      },
      {
        storeFamilyId: 'other',
        aisleId: 'unclassified',
        confidence: 0.4,
      },
    ]);
  });

  it('rejects duplicate indexes after the bounded retry', async () => {
    const response = new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            classifications: [
              {
                index: 0,
                storeFamilyId: 'supermarket',
                aisleId: 'produce',
                confidence: 0.9,
              },
              {
                index: 0,
                storeFamilyId: 'supermarket',
                aisleId: 'produce',
                confidence: 0.9,
              },
            ],
          }),
        },
      }),
      { status: 200 },
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response.clone())
      .mockResolvedValueOnce(response.clone());
    const engine = new OllamaClassificationEngine({ fetch: fetcher });

    await expect(
      engine.classify(['Pommes', 'Poires'], new AbortController().signal),
    ).rejects.toThrow('index');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts the model request when the job is stopped', async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const engine = new OllamaClassificationEngine({ fetch: fetcher });

    const classification = engine.classify(['Pommes'], controller.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort();

    await expect(classification).rejects.toMatchObject({ name: 'AbortError' });
  });
});
