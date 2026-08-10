import { describe, expect, it, vi } from 'vitest';

import type { AssistantMessage } from '@friday/contracts';

import {
  OllamaAssistantEngine,
  sanitizeConversationTitle,
} from './assistant-engine.js';
import type { PlaywrightWebResearcher } from './web-researcher.js';

describe('OllamaAssistantEngine', () => {
  it('uses the installed Gemma 4 variant with a 131072-token context', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: 'Bonjour' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const engine = new OllamaAssistantEngine({ fetch: fetcher });
    const message: AssistantMessage = {
      id: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      conversationId: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      role: 'user',
      content: 'Bonjour',
      requestedMode: 'classic',
      effectiveMode: null,
      runId: '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      sources: [],
      createdAt: '2026-08-10T12:00:00.000Z',
    };

    await expect(
      engine.answerClassic([message], new AbortController().signal),
    ).resolves.toMatchObject({
      content: 'Bonjour',
    });
    const request = fetcher.mock.calls[0];
    const body = JSON.parse(String(request?.[1]?.body)) as {
      model: string;
      options: { num_ctx: number; num_predict: number };
    };
    expect(body).toMatchObject({
      model: 'gemma4-12b-multimodal:128k',
      options: { num_ctx: 131_072, num_predict: 4_096 },
    });
  });

  it('merges Web evidence into the current user turn for Gemma role alternation', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ message: { content: 'Réponse [S1]' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      );
    const researcher = {
      research: vi.fn().mockResolvedValue([
        {
          excerpt: 'Une preuve suffisamment longue pour être utilisée.',
          publishedAt: null,
          title: 'Source primaire',
          url: 'https://example.com/source',
        },
      ]),
      close: vi.fn(),
    } as unknown as PlaywrightWebResearcher;
    const engine = new OllamaAssistantEngine({ fetch: fetcher, researcher });
    const message: AssistantMessage = {
      id: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      conversationId: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      role: 'user',
      content: 'Question actuelle ?',
      requestedMode: 'web',
      effectiveMode: 'web',
      runId: '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      sources: [],
      createdAt: '2026-08-10T12:00:00.000Z',
    };

    await engine.answerWeb(
      [message],
      ['question actuelle'],
      new AbortController().signal,
      () => undefined,
      'deep',
    );

    const draftBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      format?: unknown;
      messages: Array<{ content: string; role: string }>;
    };
    expect(draftBody.messages.map(({ role }) => role)).toEqual([
      'system',
      'user',
    ]);
    expect(draftBody.messages[1]?.content).toContain('PREUVES_WEB_NON_FIABLES');
    expect(draftBody.format).toBeUndefined();
  });

  it('uses Ministral once and skips the verifier for a fast Web answer', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: { content: 'Réponse **courte** [S1] [S9]' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const researcher = {
      research: vi.fn().mockResolvedValue([
        {
          excerpt: 'Preuve actuelle.',
          publishedAt: null,
          title: 'Source',
          url: 'https://example.com/source',
        },
      ]),
      close: vi.fn(),
    } as unknown as PlaywrightWebResearcher;
    const engine = new OllamaAssistantEngine({ fetch: fetcher, researcher });
    const message: AssistantMessage = {
      id: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      conversationId: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      role: 'user',
      content: 'Question simple ?',
      requestedMode: 'web',
      effectiveMode: 'web',
      runId: '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      sources: [],
      createdAt: '2026-08-10T12:00:00.000Z',
    };

    const result = await engine.answerWeb(
      [message],
      ['question simple'],
      new AbortController().signal,
      () => undefined,
      'fast',
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('Réponse **courte** [S1] ');
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      model: string;
      options: { num_ctx: number };
    };
    expect(body.model).toBe('ministral-3:8b');
    expect(body.options.num_ctx).toBe(32_768);
  });

  it('generates a short sanitized title with the model already used by the run', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: { content: '**Titre : Araignées dehors en hiver.**\nSuite' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const engine = new OllamaAssistantEngine({ fetch: fetcher });

    await expect(
      engine.generateTitle(
        'Les araignées survivent-elles dehors en hiver ?',
        'web',
        'fast',
        new AbortController().signal,
      ),
    ).resolves.toBe('Araignées dehors en hiver');

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      model: string;
      options: { num_ctx: number; num_predict: number };
    };
    expect(body).toMatchObject({
      model: 'ministral-3:8b',
      options: { num_ctx: 32_768, num_predict: 24 },
    });
    expect(sanitizeConversationTitle('« Budget familial mensuel »')).toBe(
      'Budget familial mensuel',
    );
  });
});
