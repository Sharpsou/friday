import { createHash } from 'node:crypto';

export const EXTRACTION_VERSION = 'structured-document-v3-main-content';
export interface DocumentSection {
  heading?: string;
  paragraphs: string[];
}
export interface StructuredDocument {
  version: typeof EXTRACTION_VERSION;
  fingerprint: string;
  sections: DocumentSection[];
  text: string;
  truncated: boolean;
}

/** Both network and frozen HTML adapters supply an inert DOM. No fetching here. */
export function extractStructuredDocument(
  document: Document,
): StructuredDocument {
  document
    .querySelectorAll(
      'script,style,noscript,svg,form,nav,footer,iframe,template,[hidden],[aria-hidden="true"],[role="navigation"],[role="search"],[role="menu"],[role="menubar"],[role="dialog"]',
    )
    .forEach((e) => e.remove());
  // Prefer structural content boundaries, never blacklist a document's subject.
  let root: Element =
    document.querySelector('main,[role="main"],#main') ??
    document.querySelector('article') ??
    document.body;
  const articles = [...root.querySelectorAll('article')].sort(
    (a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0),
  );
  const article = articles[0];
  if (
    article &&
    (article.textContent?.length ?? 0) >= (root.textContent?.length ?? 0) * 0.6
  )
    root = article;
  // An informative aside can contain an essential warning. Remove only link menus.
  for (const aside of root.querySelectorAll('aside')) {
    const links = [...aside.querySelectorAll('a')];
    const length = aside.textContent?.trim().length ?? 0;
    const linked = links.reduce(
      (sum, link) => sum + (link.textContent?.trim().length ?? 0),
      0,
    );
    if (
      links.length >= 3 &&
      length > 0 &&
      linked / length > 0.8 &&
      !aside.querySelector('pre,code,table')
    )
      aside.remove();
  }
  const sections: DocumentSection[] = [];
  const headings: string[] = [];
  let definition = '';
  let characters = 0;
  let truncated = false;
  const elements = [
    ...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,dt,dd,tr,blockquote,pre'),
  ];
  for (const element of elements.slice(0, 3000)) {
    if (element.parentElement?.closest('li,dd,tr,blockquote,pre')) continue;
    const text = (element.textContent ?? '').replace(/\s+/gu, ' ').trim();
    if (!text) continue;
    if (/^H[1-6]$/u.test(element.tagName)) {
      const level = Number(element.tagName[1]);
      headings.length = level - 1;
      headings[level - 1] = text.slice(0, 180);
      definition = '';
      continue;
    }
    if (element.tagName === 'DT') {
      definition =
        element.previousElementSibling?.tagName === 'DT' && definition
          ? `${definition} / ${text}`
          : text;
      continue;
    }
    let block =
      element.tagName === 'DD' && definition ? `${definition}: ${text}` : text;
    if (element.tagName === 'TR') {
      const header = element.closest('table')?.querySelector('tr');
      const labels = header
        ? [...header.querySelectorAll('th')].map(
            (e) => e.textContent?.trim() ?? '',
          )
        : [];
      if (header === element && labels.length && !element.querySelector('td'))
        continue;
      block = [...element.querySelectorAll('th,td')]
        .map(
          (cell, i) =>
            `${header !== element && labels[i] ? labels[i] + ': ' : ''}${cell.textContent?.trim() ?? ''}`,
        )
        .join(' | ');
    }
    const heading = headings.filter(Boolean).join(' > ').slice(-500);
    let section = sections.at(-1);
    if (
      !section ||
      (section.heading ?? '') !== heading ||
      section.paragraphs.length >= 50
    ) {
      section = { ...(heading ? { heading } : {}), paragraphs: [] };
      sections.push(section);
    }
    if (section.paragraphs.at(-1) === block) continue;
    // Keep a list's governing sentence with the item, without losing its identity.
    if (element.tagName === 'LI') {
      const intro = element.closest('ul,ol')?.previousElementSibling;
      const lead = intro?.matches('p')
        ? intro.textContent?.replace(/\s+/gu, ' ').trim()
        : '';
      if (lead && lead.length <= 1500 && lead !== block)
        block = `${lead}\n${block}`;
    }
    if (
      block.length > 12000 ||
      characters + block.length > 120000 ||
      sections.length > 200
    ) {
      truncated = true;
      continue;
    }
    section.paragraphs.push(block);
    characters += block.length;
  }
  const nonempty = sections.filter((s) => s.paragraphs.length).slice(0, 200);
  const text = nonempty
    .map((s) => [s.heading, ...s.paragraphs].filter(Boolean).join('\n\n'))
    .join('\n\n');
  return {
    version: EXTRACTION_VERSION,
    fingerprint: createHash('sha256').update(text).digest('hex'),
    sections: nonempty,
    text,
    truncated: truncated || elements.length > 3000,
  };
}
