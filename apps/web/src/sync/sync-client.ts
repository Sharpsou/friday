import {
  PullResponseSchema,
  PushResponseSchema,
  type PullResponse,
  type PushResponse,
} from '@friday/contracts';

import {
  applyAcks,
  applyChanges,
  getCursor,
  getOutboxCounts,
  markOperations,
  readPendingOperations,
} from '../db/task-repository.js';

export interface SyncResult {
  conflicts: number;
  cursor: number;
  pending: number;
  syncedAt: string;
}

let activeSync: Promise<SyncResult> | null = null;
let activeSyncController: AbortController | null = null;
const SYNC_TIMEOUT_MS = 5_000;

async function parseJson<T>(
  response: Response,
  parser: { parse(value: unknown): T },
) {
  if (!response.ok) {
    throw new Error(`Synchronisation refusée (${response.status}).`);
  }
  return parser.parse(await response.json());
}

async function runSync(signal: AbortSignal): Promise<SyncResult> {
  const operations = await readPendingOperations();
  const operationIds = operations.map((operation) => operation.operationId);

  if (operations.length > 0) {
    await markOperations(operationIds, 'sent');
    try {
      const response = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations }),
        signal,
      });
      const payload: PushResponse = await parseJson(
        response,
        PushResponseSchema,
      );
      await applyAcks(payload.acks);
    } catch (error) {
      await markOperations(operationIds, 'pending');
      throw error;
    }
  }

  const cursor = await getCursor();
  const response = await fetch(`/api/sync/pull?after=${cursor.toString()}`, {
    signal,
  });
  const payload: PullResponse = await parseJson(response, PullResponseSchema);
  await applyChanges(payload.changes, payload.cursor);
  const counts = await getOutboxCounts();
  return {
    ...counts,
    cursor: payload.cursor,
    syncedAt: new Date().toISOString(),
  };
}

export function syncNow(): Promise<SyncResult> {
  if (!activeSync) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      SYNC_TIMEOUT_MS,
    );
    activeSyncController = controller;
    activeSync = runSync(controller.signal).finally(() => {
      globalThis.clearTimeout(timeout);
      if (activeSyncController === controller) activeSyncController = null;
      activeSync = null;
    });
  }
  return activeSync;
}

export async function cancelActiveSync(): Promise<void> {
  const sync = activeSync;
  if (!sync) return;

  activeSyncController?.abort();
  try {
    await sync;
  } catch {
    // Cancellation is expected before a local write or after losing the network.
  }
}
