import {
  WatchArticleStateRequestSchema,
  WatchConceptStateRequestSchema,
  WatchOverviewSchema,
  type WatchArticleStateValue,
  type WatchOverview,
  type WatchConceptState,
} from '@friday/contracts';

import { decryptJson, encryptJson } from '../crypto/vault.js';
import { fridayDb } from './friday-db.js';
import { getDeviceContext } from './task-repository.js';

const snapshotAad = (profileId: string, deviceId: string) =>
  `watch-snapshot:${profileId}:${deviceId}`;
const outboxAad = (operationId: string, deviceId: string) =>
  `watch-outbox:${operationId}:${deviceId}`;

export interface QueuedWatchState {
  articleId: string;
  exclusionKeyword: string | null;
  operationId: string;
  state: WatchArticleStateValue;
  watchId: string;
}

export interface QueuedWatchConceptState {
  conceptId: string;
  operationId: string;
  state: WatchConceptState;
  watchId: string;
}

export async function cacheWatchOverview(
  overview: WatchOverview,
): Promise<void> {
  const parsed = WatchOverviewSchema.parse(overview);
  const { deviceId, key, profileId } = await getDeviceContext();
  await fridayDb.watchSnapshots.put({
    profileId,
    updatedAt: new Date().toISOString(),
    encrypted: await encryptJson(key, parsed, snapshotAad(profileId, deviceId)),
  });
}

export async function getCachedWatchOverview(): Promise<WatchOverview | null> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const row = await fridayDb.watchSnapshots.get(profileId);
  if (!row) return null;
  return WatchOverviewSchema.parse(
    await decryptJson(key, row.encrypted, snapshotAad(profileId, deviceId)),
  );
}

export async function queueWatchState(input: QueuedWatchState): Promise<void> {
  const parsed = WatchArticleStateRequestSchema.parse({
    operationId: input.operationId,
    state: input.state,
    exclusionKeyword: input.exclusionKeyword,
  });
  const { deviceId, key, profileId } = await getDeviceContext();
  await fridayDb.watchOutbox.put({
    operationId: input.operationId,
    profileId,
    watchId: input.watchId,
    articleId: input.articleId,
    kind: 'article',
    createdAt: new Date().toISOString(),
    encrypted: await encryptJson(
      key,
      parsed,
      outboxAad(input.operationId, deviceId),
    ),
  });
}

export async function listQueuedWatchStates(): Promise<QueuedWatchState[]> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const rows = await fridayDb.watchOutbox
    .where('profileId')
    .equals(profileId)
    .sortBy('createdAt');
  return Promise.all(
    rows
      .filter((row) => (row.kind ?? 'article') === 'article')
      .map(async (row) => {
        const payload = WatchArticleStateRequestSchema.parse(
          await decryptJson(
            key,
            row.encrypted,
            outboxAad(row.operationId, deviceId),
          ),
        );
        return {
          articleId: row.articleId!,
          watchId: row.watchId,
          ...payload,
        };
      }),
  );
}

export async function queueWatchConceptState(
  input: QueuedWatchConceptState,
): Promise<void> {
  const parsed = WatchConceptStateRequestSchema.parse({
    operationId: input.operationId,
    state: input.state,
  });
  const { deviceId, key, profileId } = await getDeviceContext();
  await fridayDb.watchOutbox.put({
    operationId: input.operationId,
    profileId,
    kind: 'concept',
    watchId: input.watchId,
    conceptId: input.conceptId,
    createdAt: new Date().toISOString(),
    encrypted: await encryptJson(
      key,
      parsed,
      outboxAad(input.operationId, deviceId),
    ),
  });
}

export async function listQueuedWatchConceptStates(): Promise<
  QueuedWatchConceptState[]
> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const rows = await fridayDb.watchOutbox
    .where('profileId')
    .equals(profileId)
    .sortBy('createdAt');
  return Promise.all(
    rows
      .filter((row) => row.kind === 'concept')
      .map(async (row) => {
        const payload = WatchConceptStateRequestSchema.parse(
          await decryptJson(
            key,
            row.encrypted,
            outboxAad(row.operationId, deviceId),
          ),
        );
        return {
          conceptId: row.conceptId!,
          watchId: row.watchId,
          ...payload,
        };
      }),
  );
}

export async function removeQueuedWatchState(
  operationId: string,
): Promise<void> {
  await fridayDb.watchOutbox.delete(operationId);
}
