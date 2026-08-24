import { describe, expect, it, vi } from 'vitest';

import { OllamaPhotoTranscriptionEngine } from './ollama-photo-transcription-engine.js';

describe('Ollama grocery photo transcription engine', () => {
  it('uses the local vision model, excludes crossed lines and validates output', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              items: [
                {
                  box: { x: 10, y: 20, width: 200, height: 30 },
                  crossedOut: true,
                  label: 'Ancien produit',
                  quantityText: null,
                  sourceText: 'Ancien produit',
                },
                {
                  box: { x: 500, y: 120, width: 250, height: 40 },
                  crossedOut: false,
                  label: 'Fleur de sel x2',
                  quantityText: 'x2',
                  sourceText: 'fleur de sel x2',
                },
              ],
            }),
          },
        }),
        { status: 200 },
      ),
    );
    const engine = new OllamaPhotoTranscriptionEngine({ fetch: fetcher });

    await expect(
      engine.transcribe(
        'YWJjZGVmZ2hpamtsbW5vcA==',
        'image/jpeg',
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      items: [
        {
          box: { x: 500, y: 120, width: 250, height: 40 },
          label: 'Fleur de sel',
          quantityText: 'x2',
          sourceText: 'fleur de sel x2',
        },
      ],
    });
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      model: string;
      messages: Array<{ images?: string[] }>;
    };
    expect(request.model).toBe('qwen3.5:9b-q4_K_M');
    expect(request.messages.at(-1)?.images).toEqual([
      'YWJjZGVmZ2hpamtsbW5vcA==',
    ]);
  });

  it('rejects malformed model output instead of importing it', async () => {
    const engine = new OllamaPhotoTranscriptionEngine({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: { content: '{"items":[{"label":""}]}' },
          }),
          { status: 200 },
        ),
      ),
    });

    await expect(
      engine.transcribe(
        'YWJjZGVmZ2hpamtsbW5vcA==',
        'image/jpeg',
        new AbortController().signal,
      ),
    ).rejects.toThrow('Lecture de la photo invalide');
  });

  it('propagates cancellation to the local Ollama request', async () => {
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error('Signal absent.');
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    });
    const engine = new OllamaPhotoTranscriptionEngine({ fetch: fetcher });
    const controller = new AbortController();
    const transcription = engine.transcribe(
      'YWJjZGVmZ2hpamtsbW5vcA==',
      'image/jpeg',
      controller.signal,
    );

    controller.abort(new DOMException('Analyse annulée.', 'AbortError'));

    await expect(transcription).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
