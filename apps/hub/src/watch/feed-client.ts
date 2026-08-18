import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { Readability } from '@mozilla/readability';
import { XMLParser } from 'fast-xml-parser';
import { JSDOM } from 'jsdom';

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export interface FeedArticleInput {
  canonicalUrl: string;
  externalId: string | null;
  excerpt: string;
  fingerprint: string;
  publishedAt: string | null;
  title: string;
}

export interface FeedDocument {
  articles: FeedArticleInput[];
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
  siteUrl: string;
  title: string;
}

export interface ValidatedFeed {
  feedUrl: string;
  siteUrl: string;
  title: string;
}

interface FetchTextResult {
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
  text: string;
  url: string;
}

const xmlParser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
});

export class SecureFeedClient {
  private readonly robotsCache = new Map<
    string,
    { expiresAt: number; disallow: string[] }
  >();

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async validate(
    inputUrl: string,
    signal: AbortSignal,
  ): Promise<ValidatedFeed> {
    const first = await this.fetchText(inputUrl, signal, MAX_FEED_BYTES, {});
    if (looksLikeXml(first.contentType, first.text)) {
      const parsed = parseFeed(first.text, first.url);
      return {
        feedUrl: first.url,
        siteUrl: parsed.siteUrl,
        title: parsed.title,
      };
    }
    if (!first.contentType.includes('text/html'))
      throw new Error('La source ne fournit ni page HTML ni flux RSS/Atom.');
    const dom = new JSDOM(first.text, { url: first.url });
    const advertisedCandidates = [
      ...dom.window.document.querySelectorAll('link[rel="alternate"]'),
    ]
      .filter((node) => /rss|atom|xml/iu.test(node.getAttribute('type') ?? ''))
      .map((node) => node.getAttribute('href'))
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);
    const candidates = [
      ...advertisedCandidates,
      ...['/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml', '/index.xml'],
    ];
    for (const candidate of candidates) {
      try {
        const feedUrl = new URL(candidate, first.url).toString();
        const response = await this.fetchText(
          feedUrl,
          signal,
          MAX_FEED_BYTES,
          {},
        );
        const parsed = parseFeed(response.text, response.url);
        return {
          feedUrl: response.url,
          siteUrl: parsed.siteUrl || first.url,
          title: parsed.title,
        };
      } catch {
        // Try the next explicitly advertised feed.
      }
    }
    throw new Error(
      'Aucun flux RSS/Atom vérifiable n’est annoncé par ce site.',
    );
  }

  async fetchFeed(
    feedUrl: string,
    signal: AbortSignal,
    validators: { etag?: string | null; lastModified?: string | null },
  ): Promise<FeedDocument> {
    const headers: Record<string, string> = {};
    if (validators.etag) headers['if-none-match'] = validators.etag;
    if (validators.lastModified)
      headers['if-modified-since'] = validators.lastModified;
    const response = await this.fetchText(
      feedUrl,
      signal,
      MAX_FEED_BYTES,
      headers,
    );
    if (response.notModified)
      return {
        articles: [],
        etag: response.etag,
        lastModified: response.lastModified,
        notModified: true,
        siteUrl: feedUrl,
        title: new URL(feedUrl).hostname,
      };
    const parsed = parseFeed(response.text, response.url);
    return {
      ...parsed,
      etag: response.etag,
      lastModified: response.lastModified,
      notModified: false,
    };
  }

  async fetchArticleText(url: string, signal: AbortSignal): Promise<string> {
    if (!(await this.robotsAllows(url, signal)))
      throw new Error('La lecture de cette page est refusée par robots.txt.');
    const response = await this.fetchText(url, signal, MAX_PAGE_BYTES, {});
    if (!response.contentType.includes('text/html')) return response.text;
    const dom = new JSDOM(response.text, {
      runScripts: undefined,
      url: response.url,
    });
    const article = new Readability(dom.window.document, {
      maxElemsToParse: 50_000,
    }).parse();
    return (article?.textContent ?? dom.window.document.body.textContent ?? '')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 20_000);
  }

  private async robotsAllows(
    url: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const target = new URL(url);
    const key = target.origin;
    let cached = this.robotsCache.get(key);
    if (!cached || cached.expiresAt <= Date.now()) {
      let disallow: string[];
      try {
        const response = await this.fetchText(
          new URL('/robots.txt', target).toString(),
          signal,
          256 * 1024,
          {},
        );
        disallow = parseRobots(response.text);
      } catch {
        disallow = [];
      }
      cached = { disallow, expiresAt: Date.now() + 60 * 60_000 };
      this.robotsCache.set(key, cached);
    }
    return !cached.disallow.some(
      (path) => path !== '' && target.pathname.startsWith(path),
    );
  }

  private async fetchText(
    inputUrl: string,
    signal: AbortSignal,
    maximumBytes: number,
    headers: Record<string, string>,
    redirects = 0,
  ): Promise<FetchTextResult> {
    const safeUrl = await assertPublicHttpsUrl(inputUrl);
    const response = await this.fetcher(safeUrl, {
      headers: {
        accept:
          'application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.8, text/plain;q=0.5',
        'user-agent': 'FridayWatch/1.0 (+local family feed reader)',
        ...headers,
      },
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (response.status === 304)
      return {
        contentType: response.headers.get('content-type') ?? '',
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        notModified: true,
        text: '',
        url: safeUrl,
      };
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= MAX_REDIRECTS) throw new Error('Trop de redirections.');
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirection sans destination.');
      return this.fetchText(
        new URL(location, safeUrl).toString(),
        signal,
        maximumBytes,
        headers,
        redirects + 1,
      );
    }
    if (!response.ok)
      throw new Error(`La source a répondu ${response.status.toString()}.`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
      throw new Error('La source dépasse la taille autorisée.');
    const bytes = await readLimitedBody(response, maximumBytes);
    return {
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      notModified: false,
      text: new TextDecoder().decode(bytes),
      url: response.url || safeUrl,
    };
  }
}

async function assertPublicHttpsUrl(input: string): Promise<string> {
  const url = new URL(input);
  if (url.protocol !== 'https:' || (url.port && url.port !== '443'))
    throw new Error('Seules les URL HTTPS publiques sont autorisées.');
  if (url.username || url.password || isIP(url.hostname))
    throw new Error('Cette URL n’est pas autorisée.');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateIp(address))
  )
    throw new Error('Cette URL pointe vers un réseau privé ou réservé.');
  return url.toString();
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.includes(':')) {
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('2001:db8')
    );
  }
  const parts = normalized.split('.').map(Number);
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function readLimitedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error('La source dépasse la taille autorisée.');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function parseFeed(
  text: string,
  feedUrl: string,
): Omit<FeedDocument, 'etag' | 'lastModified' | 'notModified'> {
  const value = xmlParser.parse(text) as Record<string, unknown>;
  const rss = asRecord(value.rss);
  const channel = asRecord(rss.channel);
  if (Object.keys(channel).length > 0) {
    const siteUrl = stringValue(channel.link) || new URL(feedUrl).origin;
    return {
      title: stringValue(channel.title) || new URL(feedUrl).hostname,
      siteUrl,
      articles: arrayValue(channel.item)
        .slice(0, 200)
        .flatMap((entry) => {
          const item = asRecord(entry);
          return normalizeArticle(
            stringValue(item.title),
            stringValue(item.link),
            stringValue(item.guid),
            stringValue(item.pubDate) || stringValue(item.date),
            stringValue(item.description) ||
              stringValue(item['content:encoded']),
            feedUrl,
          );
        }),
    };
  }
  const feed = asRecord(value.feed);
  if (Object.keys(feed).length === 0)
    throw new Error('Flux RSS/Atom invalide.');
  const siteLink = atomLink(feed.link, feedUrl);
  return {
    title: stringValue(feed.title) || new URL(feedUrl).hostname,
    siteUrl: siteLink,
    articles: arrayValue(feed.entry)
      .slice(0, 200)
      .flatMap((entry) => {
        const item = asRecord(entry);
        return normalizeArticle(
          stringValue(item.title),
          atomLink(item.link, feedUrl),
          stringValue(item.id),
          stringValue(item.updated) || stringValue(item.published),
          stringValue(item.summary) || stringValue(item.content),
          feedUrl,
        );
      }),
  };
}

export function parseFeedText(
  text: string,
  feedUrl: string,
): Omit<FeedDocument, 'etag' | 'lastModified' | 'notModified'> {
  return parseFeed(text, feedUrl);
}

function normalizeArticle(
  titleInput: string,
  urlInput: string,
  externalId: string,
  dateInput: string,
  excerptInput: string,
  feedUrl: string,
): FeedArticleInput[] {
  const title = stripMarkup(titleInput).slice(0, 500);
  if (!title || !urlInput) return [];
  let canonicalUrl: string;
  try {
    const url = new URL(urlInput, feedUrl);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    canonicalUrl = url.toString();
  } catch {
    return [];
  }
  const publishedAt = normalizeDate(dateInput);
  const excerpt = stripMarkup(excerptInput).slice(0, 8_000);
  const fingerprint = createHash('sha256')
    .update(`${normalizeText(title)}\n${publishedAt?.slice(0, 10) ?? ''}`)
    .digest('hex');
  return [
    {
      canonicalUrl,
      externalId: externalId || null,
      excerpt,
      fingerprint,
      publishedAt,
      title,
    },
  ];
}

function atomLink(value: unknown, baseUrl: string): string {
  for (const entry of arrayValue(value)) {
    if (typeof entry === 'string') return new URL(entry, baseUrl).toString();
    const link = asRecord(entry);
    if (!link['@_rel'] || link['@_rel'] === 'alternate') {
      const href = stringValue(link['@_href']);
      if (href) return new URL(href, baseUrl).toString();
    }
  }
  return new URL(baseUrl).origin;
}

function parseRobots(text: string): string[] {
  const groups: Array<{ agents: string[]; disallow: string[] }> = [];
  let agents: string[] = [];
  let disallow: string[] = [];
  let rulesStarted = false;
  const flush = () => {
    if (agents.length > 0) groups.push({ agents, disallow });
    agents = [];
    disallow = [];
    rulesStarted = false;
  };
  for (const rawLine of [...text.split(/\r?\n/u), '']) {
    const line = rawLine.replace(/#.*/u, '').trim();
    if (!line) {
      flush();
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (rulesStarted) flush();
      agents.push(value.toLowerCase());
    } else if (field === 'disallow' && agents.length > 0) {
      rulesStarted = true;
      disallow.push(value);
    }
  }
  const specific = groups.filter((group) =>
    group.agents.some((agent) => 'fridaywatch'.startsWith(agent)),
  );
  const selected =
    specific.length > 0
      ? specific
      : groups.filter((group) => group.agents.includes('*'));
  return selected.flatMap((group) => group.disallow);
}

function looksLikeXml(contentType: string, text: string): boolean {
  return (
    /xml|rss|atom/iu.test(contentType) ||
    /^\s*<\??(?:rss|feed|rdf)/iu.test(text)
  );
}

function normalizeDate(input: string): string | null {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function stripMarkup(input: string): string {
  if (!input) return '';
  const dom = new JSDOM(`<body>${input}</body>`);
  return (dom.window.document.body.textContent ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function arrayValue(value: unknown): unknown[] {
  return value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value
      : [value];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number')
    return decodeXmlEntities(String(value).trim());
  const record = asRecord(value);
  return typeof record['#text'] === 'string'
    ? decodeXmlEntities(record['#text'].trim())
    : '';
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'");
}
