import { isIP } from 'node:net';

import { z } from 'zod';

import type { TavilyEvidence } from './tavily-search.js';

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EXCERPT_CHARACTERS = 2_000;

const McpResponseSchema = z
  .object({
    result: z
      .object({
        content: z.array(
          z
            .object({ type: z.string(), text: z.string().optional() })
            .passthrough(),
        ),
        isError: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type ExaFailureKind = 'rate_limited' | 'unavailable' | 'failed';

export class ExaMcpError extends Error {
  constructor(
    message: string,
    readonly kind: ExaFailureKind,
    readonly retryAt: string | null = null,
  ) {
    super(message);
  }
}

export interface ExaMcpSearchResult {
  evidence: TavilyEvidence[];
}

export class ExaMcpSearchClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async search(
    query: string,
    signal: AbortSignal,
  ): Promise<ExaMcpSearchResult> {
    let response: Response;
    try {
      response = await this.fetcher(EXA_MCP_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'web_search_exa',
            arguments: { query, numResults: 8 },
          },
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      const timedOut =
        error instanceof DOMException && error.name === 'TimeoutError';
      throw new ExaMcpError(
        timedOut ? 'Exa n’a pas répondu à temps.' : 'Exa est indisponible.',
        'unavailable',
      );
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new ExaMcpError(
          'Limite gratuite Exa atteinte.',
          'rate_limited',
          retryAt(response.headers.get('retry-after')),
        );
      }
      throw new ExaMcpError(
        response.status >= 500
          ? 'Exa est temporairement indisponible.'
          : 'Exa a refusé la recherche anonyme.',
        response.status >= 500 ? 'unavailable' : 'failed',
      );
    }

    const body = await readBoundedBody(response, MAX_RESPONSE_BYTES);
    const payload = parseMcpPayload(body);
    if (payload.result.isError)
      throw new ExaMcpError('Exa a refusé la recherche.', 'failed');
    const text = payload.result.content.find(
      (item) => item.type === 'text' && item.text,
    )?.text;
    if (!text) return { evidence: [] };
    if (/^error\b|rate limit|too many requests/iu.test(text.trim()))
      throw new ExaMcpError(
        /rate limit|too many requests/iu.test(text)
          ? 'Limite gratuite Exa atteinte.'
          : 'Exa a refusé la recherche.',
        /rate limit|too many requests/iu.test(text) ? 'rate_limited' : 'failed',
      );
    return { evidence: parseExaResults(text) };
  }
}

export function parseExaResults(text: string): TavilyEvidence[] {
  const sanitized = sanitizeExternalText(text);
  const blocks = sanitized.split(/\n\s*---\s*\n/gu);
  const evidence: TavilyEvidence[] = [];
  for (const block of blocks) {
    const title = field(block, 'Title');
    const urlValue = field(block, 'URL');
    if (!urlValue) continue;
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (!isPublicHostname(url.hostname)) continue;
    const contentMatch = /(?:^|\n)(?:Highlights|Text):\s*([\s\S]*)$/iu.exec(
      block,
    );
    const content = sanitizeExternalText(contentMatch?.[1] ?? '').slice(
      0,
      MAX_EXCERPT_CHARACTERS,
    );
    evidence.push({
      title: (title || url.hostname).slice(0, 500),
      url: url.toString(),
      publishedAt: normalizePublishedAt(field(block, 'Published')),
      content,
    });
  }
  return evidence.slice(0, 8);
}

function isPublicHostname(input: string): boolean {
  const hostname = input.replace(/^\[|\]$/gu, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  const kind = isIP(hostname);
  if (kind === 4) {
    const [a = 0, b = 0] = hostname.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (kind === 6)
    return !(
      hostname === '::' ||
      hostname === '::1' ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd') ||
      hostname.startsWith('fe8') ||
      hostname.startsWith('fe9') ||
      hostname.startsWith('fea') ||
      hostname.startsWith('feb')
    );
  return true;
}

function field(block: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\n)${name}:\\s*(.+)$`, 'imu').exec(block);
  const value = match?.[1]?.trim();
  return value && value !== 'N/A' ? value : null;
}

function sanitizeExternalText(input: string): string {
  return input
    .replace(/[\u200b-\u200f\u2028-\u202f\u2060-\u206f]/gu, '')
    .replace(/<!--[\s\S]*?-->/gu, '')
    .split(String.fromCharCode(0))
    .join('');
}

function normalizePublishedAt(input: string | null): string | null {
  if (!input) return null;
  const value = new Date(input);
  return Number.isNaN(value.valueOf()) ? null : value.toISOString();
}

function parseMcpPayload(body: string) {
  const candidates = [
    body.trim(),
    ...body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6).trim()),
  ];
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue;
    try {
      return McpResponseSchema.parse(JSON.parse(candidate));
    } catch {
      // Une réponse SSE peut contenir plusieurs événements non pertinents.
    }
  }
  throw new ExaMcpError('Réponse Exa illisible.', 'failed');
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new ExaMcpError('Réponse Exa trop volumineuse.', 'failed');
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function retryAt(value: string | null): string | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds))
    return new Date(Date.now() + Math.max(0, seconds) * 1_000).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
