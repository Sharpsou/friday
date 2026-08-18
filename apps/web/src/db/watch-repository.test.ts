import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fridayDb } from './friday-db.js';
import { resetDatabaseForTests } from './task-repository.js';
import {
  cacheWatchOverview,
  getCachedWatchOverview,
  listQueuedWatchStates,
  queueWatchState,
} from './watch-repository.js';

beforeEach(async () => {
  await fridayDb.open();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe('encrypted watch repository', () => {
  it('stores the overview and state outbox without plaintext', async () => {
    const overview = {
      watches: [],
      articles: [],
      concepts: [],
      digests: [
        {
          id: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
          watchId: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
          title: 'Nouveauté secrète',
          summary: 'Résumé privé',
          articleIds: [],
          newCount: 1,
          createdAt: '2026-08-12T10:00:00.000Z',
        },
      ],
      unreadRelevantCount: 1,
      topics: [],
      runs: [],
    };
    await cacheWatchOverview(overview);
    expect(await getCachedWatchOverview()).toEqual(overview);
    const raw = await fridayDb.watchSnapshots.toArray();
    expect(JSON.stringify(raw)).not.toContain('Résumé privé');

    const queued = {
      operationId: '51bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      watchId: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      articleId: '41bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      state: 'follow_up' as const,
      exclusionKeyword: null,
    };
    await queueWatchState(queued);
    await queueWatchState(queued);
    expect(await listQueuedWatchStates()).toEqual([queued]);
  });
});
