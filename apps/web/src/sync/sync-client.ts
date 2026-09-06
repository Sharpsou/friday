import {
  PullResponseSchema,
  PushResponseSchema,
  type PullResponse,
  type PushResponse,
} from '@friday/contracts';

import { bootstrapMaison } from '../db/maison-repository.js';
import {
  getOutboxCounts,
  markOperations,
  readPendingOperations,
} from '../db/outbox-repository.js';
import { applyAcks, applyChanges, getCursor } from '../db/sync-repository.js';

export interface SyncResult {
  conflicts: number;
  cursor: number;
  pending: number;
  syncedAt: string;
}

let activeSync: Promise<SyncResult> | null = null;
let activeSyncController: AbortController | null = null;
const SYNC_TIMEOUT_MS = 5_000;

export class AuthenticationRequiredError extends Error {}

async function parseJson<T>(
  response: Response,
  parser: { parse(value: unknown): T },
) {
  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthenticationRequiredError('Authentification requise.');
    }
    throw new Error(`Synchronisation refusée (${response.status}).`);
  }
  return parser.parse(await response.json());
}

async function runSync(signal: AbortSignal): Promise<SyncResult> {
  const maisonAvailable = await bootstrapMaison(signal);
  let operations = (await readPendingOperations())
    .filter((op) => maisonAvailable || op.entityType !== 'maison_command')
    .slice(0, 100);
  while (operations.length > 0) {
    const operationIds = operations.map((operation) => operation.operationId);
    await markOperations(operationIds, 'sent');
    try {
      const response = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations }),
        signal,
      });
      // An older Hub rejects the new union before applying any operation.
      // Confirm its missing endpoint; a business validation error must remain
      // visible. Retry only supported operations with their original IDs.
      if (
        response.status === 400 &&
        operations.some((op) => op.entityType === 'maison_command') &&
        !(await bootstrapMaison(signal, true))
      ) {
        await markOperations(operationIds, 'pending');
        // Unsupported commands may fill the first page; select supported
        // operations from the complete queue so they cannot starve behind it.
        operations = (await readPendingOperations())
          .filter((op) => op.entityType !== 'maison_command')
          .slice(0, 100);
        continue;
      }
      const payload: PushResponse = await parseJson(
        response,
        PushResponseSchema,
      );
      await applyAcks(payload.acks);
      break;
    } catch (error) {
      await markOperations(operationIds, 'pending');
      throw error;
    }
  }

  const cursor = await getCursor();
  const response = await fetch(
    `/api/sync/pull?after=${cursor.toString()}&maison=1`,
    {
      signal,
    },
  );
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
