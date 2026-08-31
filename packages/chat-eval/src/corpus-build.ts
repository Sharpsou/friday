import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';

import { JSDOM } from 'jsdom';
import { z } from 'zod';

import {
  CorpusSchema,
  HumanCriteriaSchema,
  PriorTurnSchema,
  type Corpus,
  type FrozenPage,
} from './contracts.js';
import { DEFAULT_CORPUS_ROOT, privateCorpusRoot } from './corpus.js';

const SourceSpecSchema = z.strictObject({
  url: z
    .url()
    .max(2_048)
    .refine((value) => value.startsWith('https://')),
  title: z.string().trim().min(1).max(500),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
});

const CaseSpecSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/u),
  split: z.enum(['development', 'validation']),
  category: z.enum([
    'current_events',
    'explanation',
    'comparison',
    'recommendation',
    'procedure',
    'local',
    'scientific',
    'technical',
    'high_risk',
    'context_followup',
  ]),
  question: z.string().trim().min(3).max(2_000),
  priorTurns: z.array(PriorTurnSchema).max(2).default([]),
  criteria: HumanCriteriaSchema,
  sources: z.array(SourceSpecSchema).min(1).max(8),
});

export const CorpusSpecSchema = z
  .strictObject({
    version: z.literal('chat-foundation-v1'),
    cases: z.array(CaseSpecSchema).length(20),
  })
  .refine(
    ({ cases }) =>
      new Set(cases.map(({ id }) => id)).size === cases.length &&
      cases.filter(({ split }) => split === 'development').length === 10 &&
      cases.filter(({ split }) => split === 'validation').length === 10,
    'Corpus spec requires unique ids and a 10/10 split',
  );

interface CorpusBuildOptions {
  root?: string;
  fetchImplementation?: typeof fetch;
  lookupImplementation?: typeof lookup;
  now?: () => Date;
}

function isForbiddenIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function isForbiddenNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isForbiddenIpv4(address);
  if (family !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return isForbiddenIpv4(normalized.slice('::ffff:'.length));
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith('2001:db8:')
  );
}

async function assertPublicHttps(
  value: string,
  lookupImplementation: typeof lookup,
): Promise<URL> {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    throw new Error('SOURCE_URL_NOT_SAFE_HTTPS');
  }
  const addresses = await lookupImplementation(url.hostname, { all: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isForbiddenNetworkAddress(address))
  ) {
    throw new Error('SOURCE_URL_PRIVATE_OR_UNRESOLVED');
  }
  return url;
}

async function boundedBody(
  response: Response,
  maximum = 2_000_000,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maximum) throw new Error('SOURCE_BODY_TOO_LARGE');
  if (!response.body) throw new Error('SOURCE_BODY_EMPTY');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new Error('SOURCE_BODY_TOO_LARGE');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function download(
  initialUrl: string,
  fetchImplementation: typeof fetch,
  lookupImplementation: typeof lookup,
): Promise<{
  body: Uint8Array;
  contentType: 'text/html' | 'text/plain';
  finalUrl: string;
}> {
  let url = await assertPublicHttps(initialUrl, lookupImplementation);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetchImplementation(url, {
      redirect: 'manual',
      headers: {
        accept: 'text/html,text/plain;q=0.9',
        'user-agent': 'FridayChatEval/1.0',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 5) {
        throw new Error('SOURCE_REDIRECT_INVALID');
      }
      url = await assertPublicHttps(
        new URL(location, url).href,
        lookupImplementation,
      );
      continue;
    }
    if (!response.ok) {
      throw new Error(`SOURCE_HTTP_${response.status.toString()}`);
    }
    const rawType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (rawType !== 'text/html' && rawType !== 'text/plain') {
      throw new Error('SOURCE_CONTENT_TYPE_FORBIDDEN');
    }
    return {
      body: await boundedBody(response),
      contentType: rawType,
      finalUrl: url.href,
    };
  }
  throw new Error('SOURCE_REDIRECT_INVALID');
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

export function extractFrozenSections(html: string): FrozenPage['sections'] {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  document
    .querySelectorAll(
      'script,style,noscript,svg,form,nav,footer,iframe,template',
    )
    .forEach((element) => element.remove());
  const root =
    document.querySelector('main,article,[role="main"]') ?? document.body;
  const sections: FrozenPage['sections'] = [];
  let heading: string | undefined;
  for (const element of [...root.querySelectorAll('h1,h2,h3,h4,p,li')].slice(
    0,
    1_000,
  )) {
    const text = normalizedText(element.textContent).slice(0, 12_000);
    if (text.length < 20) continue;
    if (/^H[1-4]$/u.test(element.tagName)) {
      heading = text.slice(0, 500);
      continue;
    }
    const previous = sections.at(-1);
    if (
      !previous ||
      previous.heading !== heading ||
      previous.paragraphs.length >= 50
    ) {
      sections.push({ ...(heading ? { heading } : {}), paragraphs: [text] });
    } else {
      previous.paragraphs.push(text);
    }
    if (sections.length >= 200) break;
  }
  if (sections.length === 0) throw new Error('SOURCE_NO_EXTRACTABLE_TEXT');
  return sections;
}

export function extractPlainTextSections(
  value: string,
): FrozenPage['sections'] {
  const paragraphs = value
    .split(/\n\s*\n/gu)
    .map(normalizedText)
    .filter((text) => text.length >= 20)
    .slice(0, 500)
    .map((text) => text.slice(0, 12_000));
  if (paragraphs.length === 0) throw new Error('SOURCE_NO_EXTRACTABLE_TEXT');
  return [{ paragraphs }];
}

export async function buildFrozenCorpus(
  options: CorpusBuildOptions = {},
): Promise<{ path: string; pages: number }> {
  const root = privateCorpusRoot(options.root ?? DEFAULT_CORPUS_ROOT);
  const spec = CorpusSpecSchema.parse(
    JSON.parse(await readFile(join(root, 'corpus-spec.json'), 'utf8')),
  );
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const lookupImplementation = options.lookupImplementation ?? lookup;
  const now = options.now ?? (() => new Date());
  const cases: Corpus['cases'] = [];
  const snapshots: Array<{ file: string; body: Uint8Array }> = [];
  let pageCount = 0;
  for (const evalCase of spec.cases) {
    const pages: FrozenPage[] = [];
    for (const [index, source] of evalCase.sources.entries()) {
      let downloaded: Awaited<ReturnType<typeof download>>;
      try {
        downloaded = await download(
          source.url,
          fetchImplementation,
          lookupImplementation,
        );
      } catch (error) {
        const code =
          error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
            ? error.message
            : 'SOURCE_DOWNLOAD_FAILED';
        throw new Error(`${code}:${evalCase.id}:S${(index + 1).toString()}`, {
          cause: error,
        });
      }
      const bodyText = new TextDecoder().decode(downloaded.body);
      const file = `pages/${evalCase.id}-s${(index + 1).toString()}.html`;
      snapshots.push({ file, body: downloaded.body });
      pages.push({
        source: {
          id: `S${(index + 1).toString()}`,
          url: downloaded.finalUrl,
          title: source.title,
          ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
          retrievedAt: now().toISOString(),
        },
        snapshot: {
          file,
          sha256: createHash('sha256').update(downloaded.body).digest('hex'),
          contentType: downloaded.contentType,
        },
        sections:
          downloaded.contentType === 'text/plain'
            ? extractPlainTextSections(bodyText)
            : extractFrozenSections(bodyText),
      });
      pageCount += 1;
    }
    cases.push({
      id: evalCase.id,
      split: evalCase.split,
      category: evalCase.category,
      question: evalCase.question,
      priorTurns: evalCase.priorTurns,
      criteria: evalCase.criteria,
      pages,
      frozenAt: now().toISOString(),
    });
  }
  const corpus = CorpusSchema.parse({
    version: spec.version,
    frozen: true,
    cases,
  });
  const path = join(root, 'corpus.json');
  for (const snapshot of snapshots) {
    await writeFile(join(root, snapshot.file), snapshot.body, { flag: 'wx' });
  }
  await writeFile(path, `${JSON.stringify(corpus, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return { path, pages: pageCount };
}
