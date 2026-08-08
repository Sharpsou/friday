import 'fake-indexeddb/auto';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { fridayDb } from '../db/friday-db.js';
import { resetDatabaseForTests } from '../db/task-repository.js';
import { cancelActiveSync, syncNow } from './sync-client.js';

beforeEach(async () => {
  await fridayDb.open();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await cancelActiveSync();
  await resetDatabaseForTests();
});

it('aborts an active hub request before a local write', async () => {
  let requestSignal: AbortSignal | undefined;
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal ?? undefined;
        if (!requestSignal) {
          reject(new Error("Signal d'annulation absent."));
          return;
        }
        requestSignal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const sync = syncNow();
  const rejectedSync = expect(sync).rejects.toMatchObject({
    name: 'AbortError',
  });
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

  await cancelActiveSync();

  expect(requestSignal?.aborted).toBe(true);
  await rejectedSync;
});
