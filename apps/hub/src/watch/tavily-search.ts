import { z } from 'zod';

const TavilyResponseSchema = z
  .object({
    results: z.array(
      z
        .object({
          title: z.string(),
          url: z.string().url(),
          content: z.string().default(''),
          raw_content: z.string().nullable().optional(),
          published_date: z.string().nullable().optional(),
        })
        .passthrough(),
    ),
    usage: z.object({ credits: z.number().int().positive() }).optional(),
  })
  .passthrough();
const TavilyUsageResponseSchema = z
  .object({
    account: z.object({
      plan_usage: z.number().int().nonnegative(),
      plan_limit: z.number().int().positive(),
    }),
  })
  .passthrough();

export type TavilySearchDepth = 'basic' | 'advanced';

export interface TavilyEvidence {
  content: string;
  publishedAt: string | null;
  title: string;
  url: string;
}

export interface TavilySearchResult {
  creditsUsed: number;
  evidence: TavilyEvidence[];
}
export interface TavilyUsage {
  creditsUsed: number;
  limit: number;
}

export class TavilyUnavailableError extends Error {}

export class TavilySearchClient {
  private usageCache: { value: TavilyUsage; expiresAt: number } | undefined;
  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async search(
    query: string,
    depth: TavilySearchDepth,
    signal: AbortSignal,
  ): Promise<TavilySearchResult> {
    if (!this.apiKey)
      throw new TavilyUnavailableError('La clé Tavily n’est pas configurée.');
    const response = await this.fetcher('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
        search_depth: depth,
        max_results: 5,
        include_answer: false,
        include_raw_content: 'text',
        auto_parameters: false,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok)
      throw new TavilyUnavailableError(
        `Tavily a répondu ${response.status.toString()}.`,
      );
    const payload = TavilyResponseSchema.parse(await response.json());
    this.usageCache = undefined;
    return {
      creditsUsed: payload.usage?.credits ?? (depth === 'advanced' ? 2 : 1),
      evidence: payload.results.map((result) => ({
        title: result.title.trim() || new URL(result.url).hostname,
        url: result.url,
        content: (result.raw_content ?? result.content).slice(0, 20_000),
        publishedAt: normalizePublishedAt(result.published_date),
      })),
    };
  }

  async usage(signal: AbortSignal): Promise<TavilyUsage> {
    if (!this.apiKey)
      throw new TavilyUnavailableError('La clé Tavily n’est pas configurée.');
    if (this.usageCache && this.usageCache.expiresAt > Date.now())
      return this.usageCache.value;
    const response = await this.fetcher('https://api.tavily.com/usage', {
      headers: { authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok)
      throw new TavilyUnavailableError(
        `Tavily usage a répondu ${response.status.toString()}.`,
      );
    const payload = TavilyUsageResponseSchema.parse(await response.json());
    const value = {
      creditsUsed: payload.account.plan_usage,
      limit: payload.account.plan_limit,
    };
    this.usageCache = { value, expiresAt: Date.now() + 5 * 60_000 };
    return value;
  }
}

function normalizePublishedAt(input: string | null | undefined): string | null {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
