import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { AssistantSource, ChatSource } from '@friday/contracts';

interface AssistantMarkdownProps {
  content: string;
  messageId: string;
  sources: Array<AssistantSource | ChatSource>;
}

function citationHref(messageId: string, sourceId: string): string {
  return `#assistant-source-${messageId}-${sourceId}`;
}

function sourceDate(source: AssistantSource): {
  label: string;
  value: string;
} {
  const value = source.publishedAt ?? source.retrievedAt;
  return {
    label: source.publishedAt ? 'Publié le' : 'Consulté le',
    value,
  };
}

export default function AssistantMarkdown({
  content,
  messageId,
  sources,
}: AssistantMarkdownProps) {
  const readableSources = sources.filter(
    (source) =>
      !('evidenceLevel' in source) || source.evidenceLevel !== 'discovery_only',
  );
  const discoveryOnlySources = sources.filter(
    (source) =>
      'evidenceLevel' in source && source.evidenceLevel === 'discovery_only',
  );
  const sourceIds = new Set(readableSources.map(({ id }) => id));
  const withCitationLinks = content.replace(/\[(S\d+)\]/gu, (match, id) =>
    sourceIds.has(String(id))
      ? `[${String(id)}](${citationHref(messageId, String(id))})`
      : match,
  );

  return (
    <div className="assistant-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          url.startsWith('#assistant-source-') ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children, ...props }) => {
            const external = href?.startsWith('http') ?? false;
            return (
              <a
                {...props}
                href={href}
                {...(external
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {withCitationLinks}
      </Markdown>
      {readableSources.length > 0 ? (
        <details className="assistant-sources" open>
          <summary>Sources consultées ({readableSources.length})</summary>
          <ol>
            {readableSources.map((source) => {
              const date = sourceDate(source);
              return (
                <li
                  id={citationHref(messageId, source.id).slice(1)}
                  key={source.id}
                >
                  <a
                    href={source.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    [{source.id}] {source.title}
                  </a>
                  <small>
                    {source.domain} · {date.label}{' '}
                    <time dateTime={date.value}>
                      {new Date(date.value).toLocaleDateString('fr-FR')}
                    </time>
                  </small>
                </li>
              );
            })}
          </ol>
        </details>
      ) : null}
      {discoveryOnlySources.length > 0 ? (
        <details className="assistant-sources assistant-source-leads" open>
          <summary>
            Pistes non vérifiées ({discoveryOnlySources.length})
          </summary>
          <ol>
            {discoveryOnlySources.map((source) => (
              <li key={source.id}>
                <a href={source.url} rel="noopener noreferrer" target="_blank">
                  {source.title}
                </a>
                <small>{source.domain} · contenu original non lisible</small>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
