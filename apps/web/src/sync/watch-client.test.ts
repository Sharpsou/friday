import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WatchOverview } from '@friday/contracts';

const repository = vi.hoisted(() => ({
  cacheWatchOverview: vi.fn(),
  getCachedWatchOverview: vi.fn(),
  listQueuedWatchConceptStates: vi.fn(async () => []),
  listQueuedWatchStates: vi.fn(async () => []),
  queueWatchConceptState: vi.fn(),
  queueWatchState: vi.fn(),
  removeQueuedWatchState: vi.fn(),
}));

vi.mock('../db/watch-repository.js', () => repository);

import { getWatchOverview } from './watch-client.js';

const CACHED_OVERVIEW: WatchOverview = {
  watches: [],
  articles: [],
  digests: [],
  concepts: [],
  topics: [],
  runs: [],
  unreadRelevantCount: 2,
};

beforeEach(() => {
  repository.getCachedWatchOverview.mockResolvedValue(CACHED_OVERVIEW);
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Watch overview loading', () => {
  it('returns the encrypted local snapshot without waiting for the hub', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getWatchOverview()).resolves.toEqual(CACHED_OVERVIEW);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the snapshot when cellular connectivity cannot reach the private hub', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const overviewPromise = getWatchOverview({ refresh: true });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(overviewPromise).resolves.toEqual(CACHED_OVERVIEW);
  });
});
