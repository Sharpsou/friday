import {
  WatchAddDiscoveredSourcesRequestSchema,
  WatchAddDiscoveredSourcesResponseSchema,
  WatchArticleSchema,
  WatchCreateRequestSchema,
  WatchConceptSchema,
  WatchDiscoveryRequestSchema,
  WatchDiscoverySchema,
  WatchOverviewSchema,
  WatchSchema,
  WatchUpdateRequestSchema,
  type Watch,
  type WatchArticleStateValue,
  type WatchCreateRequest,
  type WatchConceptState,
  type WatchDiscovery,
  type WatchDiscoveryRequest,
  type WatchOverview,
} from '@friday/contracts';

import {
  cacheWatchOverview,
  getCachedWatchOverview,
  listQueuedWatchStates,
  listQueuedWatchConceptStates,
  queueWatchConceptState,
  queueWatchState,
  removeQueuedWatchState,
} from '../db/watch-repository.js';

export interface WatchSourceInput {
  feedUrl: string;
  siteUrl: string;
  title: string;
}

const WATCH_REQUEST_TIMEOUT_MS = 5_000;

async function fetchWatch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  let timeout = 0;
  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => {
          controller.abort();
          reject(new DOMException('Hub inaccessible.', 'TimeoutError'));
        }, WATCH_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function parse<T>(
  response: Response,
  schema: { parse(input: unknown): T },
): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : `Veille indisponible (${response.status.toString()}).`;
    throw new Error(message);
  }
  return schema.parse(payload);
}

export async function getWatchOverview(
  options: {
    refresh?: boolean;
  } = {},
): Promise<WatchOverview> {
  const cached = await getCachedWatchOverview();
  if (cached && !options.refresh) return cached;
  try {
    await flushWatchOutbox();
    const overview = await parse(
      await fetchWatch('/api/watch/overview'),
      WatchOverviewSchema,
    );
    await cacheWatchOverview(overview);
    return overview;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

export async function validateWatchSource(
  url: string,
): Promise<WatchSourceInput> {
  const response = await fetch('/api/watch/sources/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String(payload.message)
        : 'Flux RSS/Atom introuvable.';
    throw new Error(message);
  }
  if (!payload || typeof payload !== 'object')
    throw new Error('Réponse de source invalide.');
  const value = payload as Record<string, unknown>;
  if (
    typeof value.title !== 'string' ||
    typeof value.siteUrl !== 'string' ||
    typeof value.feedUrl !== 'string'
  )
    throw new Error('Réponse de source invalide.');
  return { title: value.title, siteUrl: value.siteUrl, feedUrl: value.feedUrl };
}

export async function suggestWatchSources(
  query: string,
): Promise<WatchSourceInput[]> {
  const response = await fetch('/api/watch/source-suggestions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const payload = (await response.json().catch(() => null)) as {
    message?: string;
    sources?: WatchSourceInput[];
  } | null;
  if (!response.ok)
    throw new Error(payload?.message ?? 'Suggestions indisponibles.');
  return payload?.sources ?? [];
}

export async function discoverWatchSources(
  input: WatchDiscoveryRequest,
): Promise<WatchDiscovery> {
  const payload = WatchDiscoveryRequestSchema.parse(input);
  return parse(
    await fetch('/api/watch/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    WatchDiscoverySchema,
  );
}

export async function createWatch(input: WatchCreateRequest): Promise<Watch> {
  const payload = WatchCreateRequestSchema.parse(input);
  return parse(
    await fetch('/api/watch/watches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    WatchSchema,
  );
}

export async function updateWatch(id: string, update: unknown): Promise<Watch> {
  const payload = WatchUpdateRequestSchema.parse(update);
  return parse(
    await fetch(`/api/watch/watches/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    WatchSchema,
  );
}

export async function addDiscoveredWatchSources(
  watchId: string,
  discoveryId: string,
  candidateIds: string[],
): Promise<{ addedCount: number; watch: Watch }> {
  const payload = WatchAddDiscoveredSourcesRequestSchema.parse({
    discoveryId,
    candidateIds,
  });
  return parse(
    await fetch(
      `/api/watch/watches/${encodeURIComponent(watchId)}/sources/discovered`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    ),
    WatchAddDiscoveredSourcesResponseSchema,
  );
}

export async function deleteWatch(id: string): Promise<void> {
  const response = await fetch(`/api/watch/watches/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Suppression de la veille impossible.');
}

export async function runWatch(id: string): Promise<void> {
  const response = await fetch(
    `/api/watch/watches/${encodeURIComponent(id)}/run`,
    {
      method: 'POST',
    },
  );
  if (!response.ok) throw new Error('Actualisation de la veille impossible.');
}

export async function setWatchArticleState(
  overview: WatchOverview,
  watchId: string,
  articleId: string,
  state: WatchArticleStateValue,
  exclusionKeyword: string | null = null,
): Promise<WatchOverview> {
  const operationId = crypto.randomUUID();
  const optimistic = WatchOverviewSchema.parse({
    ...overview,
    articles: overview.articles.map((article) =>
      article.id === articleId && article.watchId === watchId
        ? { ...article, state }
        : article,
    ),
    unreadRelevantCount: overview.articles.filter(
      (article) =>
        article.relevant &&
        !article.baseline &&
        (article.id === articleId && article.watchId === watchId
          ? state === 'unread'
          : article.state === 'unread'),
    ).length,
  });
  await cacheWatchOverview(optimistic);
  const queued = { operationId, watchId, articleId, state, exclusionKeyword };
  try {
    const article = await parse(
      await fetch(
        `/api/watch/watches/${encodeURIComponent(watchId)}/articles/${encodeURIComponent(articleId)}/state`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operationId, state, exclusionKeyword }),
        },
      ),
      WatchArticleSchema,
    );
    const confirmed = WatchOverviewSchema.parse({
      ...optimistic,
      articles: optimistic.articles.map((item) =>
        item.id === article.id && item.watchId === article.watchId
          ? article
          : item,
      ),
    });
    await cacheWatchOverview(confirmed);
    return confirmed;
  } catch (error) {
    if (!navigator.onLine || error instanceof TypeError) {
      await queueWatchState(queued);
      return optimistic;
    }
    throw error;
  }
}

export async function setWatchConceptState(
  overview: WatchOverview,
  watchId: string,
  conceptId: string,
  state: WatchConceptState,
): Promise<WatchOverview> {
  const operationId = crypto.randomUUID();
  const optimistic = WatchOverviewSchema.parse({
    ...overview,
    concepts: overview.concepts.map((concept) =>
      concept.id === conceptId && concept.watchId === watchId
        ? { ...concept, state }
        : concept,
    ),
  });
  await cacheWatchOverview(optimistic);
  try {
    const concept = await parse(
      await fetch(
        `/api/watch/watches/${encodeURIComponent(watchId)}/concepts/${encodeURIComponent(conceptId)}/state`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operationId, state }),
        },
      ),
      WatchConceptSchema,
    );
    const confirmed = WatchOverviewSchema.parse({
      ...optimistic,
      concepts: optimistic.concepts.map((item) =>
        item.id === concept.id ? concept : item,
      ),
    });
    await cacheWatchOverview(confirmed);
    return confirmed;
  } catch (error) {
    if (!navigator.onLine || error instanceof TypeError) {
      await queueWatchConceptState({ operationId, watchId, conceptId, state });
      return optimistic;
    }
    throw error;
  }
}

export async function flushWatchOutbox(): Promise<void> {
  if (!navigator.onLine) return;
  for (const item of await listQueuedWatchStates()) {
    try {
      const response = await fetchWatch(
        `/api/watch/watches/${encodeURIComponent(item.watchId)}/articles/${encodeURIComponent(item.articleId)}/state`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operationId: item.operationId,
            state: item.state,
            exclusionKeyword: item.exclusionKeyword,
          }),
        },
      );
      if (!response.ok) break;
      await removeQueuedWatchState(item.operationId);
    } catch {
      break;
    }
  }
  for (const item of await listQueuedWatchConceptStates()) {
    try {
      const response = await fetchWatch(
        `/api/watch/watches/${encodeURIComponent(item.watchId)}/concepts/${encodeURIComponent(item.conceptId)}/state`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operationId: item.operationId,
            state: item.state,
          }),
        },
      );
      if (!response.ok) break;
      await removeQueuedWatchState(item.operationId);
    } catch {
      break;
    }
  }
}
