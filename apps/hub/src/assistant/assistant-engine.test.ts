import { describe, expect, it, vi } from 'vitest';

import type { AssistantMessage } from '@friday/contracts';

import {
  OllamaAssistantEngine,
  sanitizeConversationTitle,
} from './assistant-engine.js';

const message: AssistantMessage = {
  id: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
  conversationId: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
  role: 'user',
  content: 'Bonjour',
  requestedMode: 'classic',
  effectiveMode: null,
  mode: 'local',
  model: 'gemma4',
  thinkingPolicy: 'auto',
  thinkingUsed: false,
  researchOutcome: 'not_needed',
  creditsUsed: 0,
  runId: '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
  sources: [],
  progressEvents: [],
  createdAt: '2026-08-10T12:00:00.000Z',
};

describe('OllamaAssistantEngine', () => {
  it('serializes Watch and Chat work and exposes the shared queue', async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const engine = new OllamaAssistantEngine({ fetch: fetcher });
    const watch = engine.analyzeWatchArticle(
      {
        articleTitle: 'Nouveau modèle',
        articleText: 'Un nouveau modèle est publié.',
        excludeKeywords: [],
        includeKeywords: ['IA'],
        question: 'Quoi de neuf en IA ?',
        sourceTitle: 'Source',
        themes: [
          {
            title: 'Modèles IA locaux',
            summary: 'Modèles exécutés sur du matériel maîtrisé.',
          },
        ],
      },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    const chat = engine.answer([message], new AbortController().signal);
    expect(engine.getInferenceStatus()).toMatchObject({
      active: { kind: 'watch' },
      queued: { assistant: 1, watch: 0 },
    });
    resolvers[0]?.(
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              relevant: true,
              novelty: 'new',
              summary: 'Un nouveau modèle est publié.',
              reason: 'Le sujet correspond à la veille.',
              topicTitle: 'Modèles IA locaux',
              concepts: ['IA'],
              entities: [],
              facts: ['Publication annoncée'],
              importance: 4,
            }),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(watch).resolves.toMatchObject({
      importance: 1,
      topicTitle: 'Modèles IA locaux',
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(engine.getInferenceStatus()).toMatchObject({
      active: { kind: 'assistant' },
      queued: { assistant: 0, watch: 0 },
    });
    resolvers[1]?.(
      new Response(JSON.stringify({ message: { content: 'Bonjour' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(chat).resolves.toEqual({
      content: 'Bonjour',
      thinkingUsed: false,
    });
    expect(engine.getInferenceStatus()).toEqual({
      active: null,
      queued: { assistant: 0, watch: 0 },
    });
  });

  it('uses Qwen 9B by default with the optimized 32K answer context', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: 'Bonjour' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const engine = new OllamaAssistantEngine({ fetch: fetcher });

    await expect(
      engine.answer([message], new AbortController().signal),
    ).resolves.toEqual({ content: 'Bonjour', thinkingUsed: false });

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      model: string;
      think: boolean;
      options: { num_ctx: number; num_predict: number };
      messages: Array<{ content: string; role: string }>;
    };
    expect(body).toMatchObject({
      model: 'qwen3.5:9b-q4_K_M',
      think: false,
      options: { num_ctx: 32_768, num_predict: 2_048 },
    });
    expect(body.messages[0]?.content).toContain('ni d’Internet');
  });

  it('uses a bounded internal deliberation for complex local Qwen requests', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: { content: '- Contraintes\n- Risques' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: 'Réponse Qwen' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const engine = new OllamaAssistantEngine({ fetch: fetcher });
    const stages: string[] = [];

    await expect(
      engine.answer(
        [{ ...message, content: 'Analyse cette stratégie familiale.' }],
        new AbortController().signal,
        {
          mode: 'local',
          model: 'qwen3.5',
          onStage: (label) => stages.push(label),
        },
      ),
    ).resolves.toEqual({ content: 'Réponse Qwen', thinkingUsed: true });

    const deliberation = JSON.parse(
      String(fetcher.mock.calls[0]?.[1]?.body),
    ) as {
      model: string;
      options: Record<string, number>;
      think: boolean;
    };
    expect(deliberation).toMatchObject({
      model: 'qwen3.5:9b-q4_K_M',
      think: false,
      options: {
        num_ctx: 32_768,
        num_predict: 256,
        presence_penalty: 1.5,
        temperature: 0.2,
        top_k: 20,
        top_p: 0.8,
      },
    });
    const answer = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as {
      messages: Array<{ content: string }>;
      options: { num_ctx: number; num_predict: number };
      think: boolean;
    };
    expect(answer.think).toBe(false);
    expect(answer.options).toMatchObject({
      num_ctx: 32_768,
      num_predict: 2_048,
    });
    expect(answer.messages[0]?.content).toContain('- Contraintes');
    expect(stages).toEqual([
      'Analyse structurée de la demande',
      'Rédaction à partir du plan interne',
    ]);
  });

  it('uses the existing Web pipeline without adding Qwen native thinking', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: 'Réponse Qwen' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const engine = new OllamaAssistantEngine({ fetch: fetcher });

    await engine.answer([message], new AbortController().signal, {
      mode: 'web_deep',
      model: 'qwen3.5',
    });

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      options: { num_ctx: number; num_predict: number };
      think: boolean;
    };
    expect(body.think).toBe(false);
    expect(body.options).toMatchObject({
      num_ctx: 32_768,
      num_predict: 4_096,
    });
  });

  it('keeps native Gemma thinking automatic for complex local requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: 'Réponse Gemma' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const engine = new OllamaAssistantEngine({ fetch: fetcher });

    await expect(
      engine.answer(
        [{ ...message, content: 'Compare ces deux stratégies en détail.' }],
        new AbortController().signal,
        { mode: 'local', model: 'gemma4' },
      ),
    ).resolves.toEqual({ content: 'Réponse Gemma', thinkingUsed: true });

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      model: string;
      options: { num_ctx: number; num_predict: number };
      think: boolean;
    };
    expect(body).toMatchObject({
      model: 'gemma4-12b-multimodal:128k',
      think: true,
      options: { num_ctx: 32_768, num_predict: 4_096 },
    });
  });

  it('bounds a deep Web dossier while preserving every source label', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ message: { content: 'Réponse sourcée' } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const engine = new OllamaAssistantEngine({ fetch: fetcher });
    const evidence = Array.from({ length: 30 }, (_, index) => ({
      title: `Source ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      content: 'x'.repeat(20_000),
      publishedAt: null,
    }));

    await engine.answer([message], new AbortController().signal, {
      evidence,
      mode: 'web_deep',
      model: 'qwen3.5',
    });

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ content: string }>;
      options: { num_ctx: number };
    };
    const dossier = body.messages.at(-1)?.content ?? '';
    expect(body.options.num_ctx).toBe(32_768);
    expect(dossier.length).toBeLessThan(65_000);
    expect(dossier).toContain('[S1] Source 1');
    expect(dossier).toContain('[S30] Source 30');
  });

  it('constrains research plans to JSON and falls back instead of failing', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: { content: 'Je propose une recherche.' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    const engine = new OllamaAssistantEngine({ fetch: fetcher });

    await expect(
      engine.planResearch(
        [
          { ...message, content: 'Activités enfants à Saint-Nazaire' },
          {
            ...message,
            id: '81bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
            content: 'Tu oublies le jardin des plantes ?',
          },
        ],
        'web_light',
        2,
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      searchNeeded: true,
      queries: [
        'Activités enfants à Saint-Nazaire — Tu oublies le jardin des plantes ?',
      ],
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      format?: { required?: string[]; type?: string };
      options: { num_ctx: number };
    };
    expect(body.format).toMatchObject({
      type: 'object',
      required: ['searchNeeded', 'queries'],
    });
    expect(body.options.num_ctx).toBe(16_384);
  });

  it('keeps Gemma available with the optimized 8K title context', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: { content: '« Planifier les vacances ! »' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const engine = new OllamaAssistantEngine({ fetch: fetcher });

    await expect(
      engine.generateTitle(
        'Prépare mes vacances',
        new AbortController().signal,
        'gemma4',
      ),
    ).resolves.toBe('Planifier les vacances');
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      model: string;
      options: { num_ctx: number; num_predict: number };
    };
    expect(body).toMatchObject({
      model: 'gemma4-12b-multimodal:128k',
      options: { num_ctx: 8_192, num_predict: 24 },
    });
  });
});

describe('sanitizeConversationTitle', () => {
  it('rejects an empty generated title', () => {
    expect(() => sanitizeConversationTitle('***')).toThrow(
      'Titre de conversation vide.',
    );
  });
});
