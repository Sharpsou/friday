import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';

export interface ResearchPage {
  excerpt: string;
  publishedAt: string | null;
  title: string;
  url: string;
}

interface SearchCandidate {
  title: string;
  url: string;
}
type SearchEngine = 'google' | 'duckduckgo' | 'brave' | 'bing';

const PRIVATE_V4 =
  /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u;
const PRIVATE_V6 = /^(?:::1$|fc|fd|fe80)/iu;

export class PlaywrightWebResearcher {
  private browser: Browser | null = null;
  private readonly disabledUntil = new Map<SearchEngine, number>();
  private readonly googleEnabled: boolean;

  constructor(options: { googleEnabled?: boolean } = {}) {
    this.googleEnabled = options.googleEnabled ?? false;
  }

  async research(
    queries: string[],
    signal: AbortSignal,
    onReading: (completed: number, total: number) => void,
  ): Promise<ResearchPage[]> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block',
      userAgent: 'FridayLocalAssistant/1.0',
    });
    const abort = () => void context.close().catch(() => undefined);
    signal.addEventListener('abort', abort, { once: true });
    try {
      await this.harden(context);
      const candidates: SearchCandidate[] = [];
      for (const query of queries) {
        for (const engine of this.engines()) {
          if ((this.disabledUntil.get(engine) ?? 0) > Date.now()) continue;
          try {
            const found = await this.search(context, engine, query);
            candidates.push(...found);
            if (found.length >= 4) break;
          } catch {
            this.disabledUntil.set(engine, Date.now() + 30 * 60_000);
          }
        }
      }
      const unique = [
        ...new Map(candidates.map((item) => [item.url, item])).values(),
      ].slice(0, 6);
      const pages: ResearchPage[] = [];
      for (const [index, candidate] of unique.entries()) {
        if (signal.aborted) throw signal.reason;
        try {
          const result = await this.read(context, candidate);
          if (result.excerpt.length >= 200) pages.push(result);
        } catch {
          // A broken source does not prevent consulting the remaining sources.
        }
        onReading(index + 1, unique.length);
      }
      return pages;
    } finally {
      signal.removeEventListener('abort', abort);
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  private engines(): SearchEngine[] {
    return this.googleEnabled
      ? ['google', 'duckduckgo', 'brave', 'bing']
      : ['duckduckgo', 'brave', 'bing'];
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser?.isConnected())
      this.browser = await chromium.launch({ headless: true });
    return this.browser;
  }

  private async harden(context: BrowserContext): Promise<void> {
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (['image', 'media', 'font'].includes(request.resourceType()))
        return route.abort();
      const url = request.url();
      if (!url.startsWith('http://') && !url.startsWith('https://'))
        return route.abort();
      if (!(await this.isPublicUrl(url))) return route.abort();
      return route.continue();
    });
  }

  private async search(
    context: BrowserContext,
    engine: SearchEngine,
    query: string,
  ): Promise<SearchCandidate[]> {
    const urls: Record<SearchEngine, string> = {
      google: `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr`,
      duckduckgo: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      brave: `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`,
      bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=fr`,
    };
    const page = await context.newPage();
    try {
      const response = await page.goto(urls[engine], {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      const body = (
        await page.locator('body').innerText({ timeout: 5_000 })
      ).slice(0, 10_000);
      if (!response?.ok() || /captcha|unusual traffic|robot/iu.test(body))
        throw new Error(`${engine} indisponible`);
      const links = await page.locator('a[href]').evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          title: (anchor.textContent ?? '').trim(),
          url: (anchor as unknown as { href: string }).href,
        })),
      );
      const ownDomains = [
        'google.',
        'duckduckgo.',
        'brave.com',
        'bing.com',
        'microsoft.com',
      ];
      const results: SearchCandidate[] = [];
      for (const link of links) {
        if (link.title.length < 8) continue;
        let target = link.url;
        const parsed = new URL(target);
        const redirected =
          parsed.searchParams.get('q') ?? parsed.searchParams.get('uddg');
        if (redirected?.startsWith('http')) target = redirected;
        const hostname = new URL(target).hostname;
        if (ownDomains.some((domain) => hostname.includes(domain))) continue;
        if (!(await this.isPublicUrl(target))) continue;
        results.push({ title: link.title.slice(0, 500), url: target });
        if (results.length === 6) break;
      }
      return results;
    } finally {
      await page.close();
    }
  }

  private async read(
    context: BrowserContext,
    candidate: SearchCandidate,
  ): Promise<ResearchPage> {
    if (!(await this.isPublicUrl(candidate.url)))
      throw new Error('Destination privée refusée.');
    const page: Page = await context.newPage();
    try {
      const response = await page.goto(candidate.url, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      if (!response?.ok())
        throw new Error(
          `Source HTTP ${response?.status().toString() ?? 'inconnue'}`,
        );
      if (!(await this.isPublicUrl(page.url())))
        throw new Error('Redirection privée refusée.');
      const title = ((await page.title()) || candidate.title)
        .trim()
        .slice(0, 500);
      const bodyText = await page.locator('body').innerText({ timeout: 5_000 });
      const mainText = await page
        .locator('main, article, [role="main"]')
        .first()
        .innerText({ timeout: 2_000 })
        .catch(() => '');
      const excerpt = (mainText.length >= 200 ? mainText : bodyText)
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 12_000);
      const publishedRaw = await page
        .locator(
          'meta[property="article:published_time"], meta[name="date"], time[datetime]',
        )
        .first()
        .getAttribute('content')
        .catch(() => null);
      const published = publishedRaw ? new Date(publishedRaw) : null;
      return {
        title,
        url: page.url(),
        excerpt,
        publishedAt:
          published && !Number.isNaN(published.valueOf())
            ? published.toISOString()
            : null,
      };
    } finally {
      await page.close();
    }
  }

  private async isPublicUrl(value: string): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return false;
    if (url.hostname === 'localhost') return false;
    const addresses = isIP(url.hostname)
      ? [{ address: url.hostname }]
      : await lookup(url.hostname, { all: true }).catch(() => []);
    if (addresses.length === 0) return false;
    return addresses.every(
      ({ address }) => !PRIVATE_V4.test(address) && !PRIVATE_V6.test(address),
    );
  }
}
