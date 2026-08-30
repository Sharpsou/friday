import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AssistantMarkdown from './AssistantMarkdown.js';

describe('AssistantMarkdown', () => {
  it('renders formatting and links known citations to their source', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown
        content={'Une réponse **importante** [S1].\n\n* élément'}
        messageId="message-1"
        sources={[
          {
            id: 'S1',
            title: 'Source',
            url: 'https://example.com',
            domain: 'example.com',
            publishedAt: null,
            retrievedAt: '2026-08-10T12:00:00.000Z',
          },
        ]}
      />,
    );

    expect(html).toContain('<strong>importante</strong>');
    expect(html).toContain('href="#assistant-source-message-1-S1"');
    expect(html).toContain('id="assistant-source-message-1-S1"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('[S1] Source');
    expect(html).toContain('example.com · Consulté le');
    expect(html).toContain('<li>élément</li>');
  });

  it('does not interpret raw HTML', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown
        content={'<script>alert("non")</script>'}
        messageId="message-2"
        sources={[]}
      />,
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a grounded comparison table with linked citations', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown
        content={
          '| Modèle | Point fort |\n| --- | --- |\n| Alpha | Facile à utiliser [S1] |'
        }
        messageId="message-3"
        sources={[
          {
            id: 'S1',
            title: 'Essai Alpha',
            url: 'https://example.com/alpha',
            domain: 'example.com',
            publishedAt: null,
            retrievedAt: '2026-08-30T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(html).toContain('<table>');
    expect(html).toContain('<th>Modèle</th>');
    expect(html).toContain('href="#assistant-source-message-3-S1"');
  });
});
