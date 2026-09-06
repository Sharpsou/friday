import {
  SharedChatEngine,
  type VerifiedChatEngineOptions as SharedOptions,
} from '@friday/assistant-core';
import { SecureFeedClient } from '../watch/feed-client.js';
import { TavilySearchClient } from '../watch/tavily-search.js';
export {
  dedupeResolvedSourceCitations,
  explicitResourceSearchQueries,
  explicitResourceTypes,
  extractReadableParagraphs,
  highRiskNotice,
  normalizeGeneratedMarkdown,
  routeForcedByMode,
} from '@friday/assistant-core';
export type VerifiedChatEngineOptions = Omit<
  SharedOptions,
  'search' | 'pageReader'
> &
  Partial<Pick<SharedOptions, 'search' | 'pageReader'>>;
/** Production adapters only. The evaluation bench executes the same core. */
export class VerifiedChatEngine extends SharedChatEngine {
  constructor(options: VerifiedChatEngineOptions = {}) {
    super({
      ...options,
      search:
        options.search ??
        new TavilySearchClient(process.env.FRIDAY_TAVILY_API_KEY),
      pageReader: options.pageReader ?? new SecureFeedClient(),
      axesEnabled:
        options.axesEnabled ?? process.env.FRIDAY_CHAT_AXES_ENABLED === 'true',
      pipeline:
        options.pipeline ??
        (process.env.FRIDAY_CHAT_PIPELINE === 'unified' ? 'unified' : 'axes'),
    });
  }
}
