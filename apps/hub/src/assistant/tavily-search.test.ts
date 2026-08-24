import { describe, expect, it, vi } from 'vitest';

import {
  normalizeResearchEvidence,
  TavilySearchClient,
  TavilyUnavailableError,
} from './tavily-search.js';

describe('TavilySearchClient', () => {
  it('rejects video metadata without a readable transcript', () => {
    expect(
      normalizeResearchEvidence({
        title: 'Une vidéo',
        url: 'https://www.youtube.com/watch?v=abc',
        content:
          'Une vidéo\nChaîne exemple\nDescription\nUne simple description.\nTranscript:',
        publishedAt: null,
      }),
    ).toBeNull();
  });

  it('keeps a substantial video transcript with its declared origin and warnings', () => {
    const transcript = Array.from(
      { length: 100 },
      (_, index) => `information${index.toString()}`,
    ).join(' ');

    expect(
      normalizeResearchEvidence({
        title: 'Une conférence scientifique',
        url: 'https://www.youtube.com/watch?v=abc',
        content: `Une conférence scientifique\nInstitut exemple\n1200 subscribers\nDescription\nRésumé.\nTranscript:\n${transcript}`,
        publishedAt: '2026-08-01T00:00:00.000Z',
      }),
    ).toMatchObject({
      format: 'video_transcript',
      origin: 'Institut exemple',
      title: 'Une conférence scientifique — Institut exemple',
      content: expect.stringContaining(
        'PRUDENCE: la transcription peut contenir des erreurs',
      ),
    });
  });

  it('keeps the key server-side and reports Tavily credits', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'Documentation officielle',
              url: 'https://example.com/reference',
              content: 'Résumé',
              raw_content: 'Contenu complet',
              published_date: '2026-08-01',
            },
          ],
          usage: { credits: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new TavilySearchClient('secret-test', fetcher);

    await expect(
      client.search('requête ciblée', 'advanced', new AbortController().signal),
    ).resolves.toMatchObject({
      creditsUsed: 2,
      evidence: [
        {
          title: 'Documentation officielle',
          url: 'https://example.com/reference',
          content: 'Contenu complet',
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer secret-test',
        }),
      }),
    );
  });

  it('fails locally when no API key is configured', async () => {
    const client = new TavilySearchClient(undefined, vi.fn<typeof fetch>());
    await expect(
      client.search('actualité', 'basic', new AbortController().signal),
    ).rejects.toBeInstanceOf(TavilyUnavailableError);
  });

  it('reads the authoritative account counter', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          key: { usage: 4, limit: null, search_usage: 4 },
          account: {
            current_plan: 'Researcher',
            plan_usage: 4,
            plan_limit: 1_000,
            paygo_usage: 0,
            paygo_limit: null,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new TavilySearchClient('secret-test', fetcher);

    await expect(client.usage(new AbortController().signal)).resolves.toEqual({
      creditsUsed: 4,
      limit: 1_000,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.tavily.com/usage',
      expect.objectContaining({ method: 'GET' }),
    );
    await client.usage(new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
