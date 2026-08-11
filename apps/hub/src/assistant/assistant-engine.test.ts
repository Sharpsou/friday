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
  it('uses only the local Gemma 4 model with a 131072-token context', async () => {
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
      model: 'gemma4-12b-multimodal:128k',
      think: false,
      options: { num_ctx: 131_072, num_predict: 4_096 },
    });
    expect(body.messages[0]?.content).toContain('ni d’Internet');
  });

  it('forces thinking for one message without exposing raw thinking', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: { content: 'Réponse finale' },
          thinking: 'raisonnement interne',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const engine = new OllamaAssistantEngine({ fetch: fetcher });

    await expect(
      engine.answer([message], new AbortController().signal, {
        mode: 'local',
        thinkingPolicy: 'forced',
      }),
    ).resolves.toEqual({ content: 'Réponse finale', thinkingUsed: true });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      think: boolean;
    };
    expect(body.think).toBe(true);
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
    };
    expect(body.format).toMatchObject({
      type: 'object',
      required: ['searchNeeded', 'queries'],
    });
  });

  it('uses the same Gemma model to generate a short sanitized title', async () => {
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
      ),
    ).resolves.toBe('Planifier les vacances');
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      model: string;
      options: { num_predict: number };
    };
    expect(body).toMatchObject({
      model: 'gemma4-12b-multimodal:128k',
      options: { num_predict: 24 },
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
