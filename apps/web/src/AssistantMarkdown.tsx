import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { AssistantSource } from '@friday/contracts';

interface AssistantMarkdownProps {
  content: string;
  messageId: string;
  sources: AssistantSource[];
}

function citationHref(messageId: string, sourceId: string): string {
  return `#assistant-source-${messageId}-${sourceId}`;
}

export default function AssistantMarkdown({
  content,
  messageId,
  sources,
}: AssistantMarkdownProps) {
  const sourceIds = new Set(sources.map(({ id }) => id));
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
    </div>
  );
}
