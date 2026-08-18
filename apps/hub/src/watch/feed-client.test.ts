import { describe, expect, it } from 'vitest';

import { parseFeedText, SecureFeedClient } from './feed-client.js';

describe('watch feed client', () => {
  it('normalizes and deduplicates tracking parameters in an RSS feed', () => {
    const feed = parseFeedText(
      `<?xml version="1.0"?><rss><channel><title>Exemple</title><link>https://example.com</link><item><guid>one</guid><title>Une nouveauté</title><link>https://example.com/a?utm_source=x&amp;b=2</link><pubDate>Wed, 12 Aug 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Résumé utile</p>]]></description></item></channel></rss>`,
      'https://example.com/feed.xml',
    );
    expect(feed.title).toBe('Exemple');
    expect(feed.articles).toHaveLength(1);
    expect(feed.articles[0]).toMatchObject({
      canonicalUrl: 'https://example.com/a?b=2',
      excerpt: 'Résumé utile',
      externalId: 'one',
      publishedAt: '2026-08-12T08:00:00.000Z',
      title: 'Une nouveauté',
    });
  });

  it('parses Atom alternate links and content', () => {
    const feed = parseFeedText(
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><link rel="alternate" href="https://example.org/"/><entry><id>tag:example.org,1</id><title>Article Atom</title><link href="/article"/><updated>2026-08-12T09:00:00Z</updated><summary>Texte Atom</summary></entry></feed>`,
      'https://example.org/feed',
    );
    expect(feed.siteUrl).toBe('https://example.org/');
    expect(feed.articles[0]?.canonicalUrl).toBe('https://example.org/article');
  });

  it('rejects private and non-HTTPS source URLs before fetching', async () => {
    const client = new SecureFeedClient(async () => {
      throw new Error('fetch must not run');
    });
    await expect(
      client.validate('http://example.com/feed', new AbortController().signal),
    ).rejects.toThrow('HTTPS');
    await expect(
      client.validate('https://localhost/feed', new AbortController().signal),
    ).rejects.toThrow('réseau privé');
  });
});
