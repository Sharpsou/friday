import { SyncOperationSchema, type SyncOperation } from '@friday/contracts';
import { decryptJson } from '../crypto/vault.js';
import { getDeviceContext } from './device-context.js';
import { outboxAad } from './encryption-context.js';
import { fridayDb, type OutboxRow } from './friday-db.js';

export async function readPendingOperations(): Promise<SyncOperation[]> {
  const { deviceId, key } = await getDeviceContext();
  const rows = await fridayDb.outbox
    .where('state')
    .anyOf(['pending', 'sent'])
    .sortBy('createdAt');
  return Promise.all(
    rows.map(async (row) =>
      SyncOperationSchema.parse(
        await decryptJson<SyncOperation>(
          key,
          row.encryptedPayload,
          outboxAad(row.operationId, deviceId),
        ),
      ),
    ),
  );
}

export async function markOperations(
  operationIds: readonly string[],
  state: OutboxRow['state'],
): Promise<void> {
  await fridayDb.transaction('rw', fridayDb.outbox, async () => {
    await Promise.all(
      operationIds.map(async (operationId) =>
        fridayDb.outbox.update(operationId, { state }),
      ),
    );
  });
}

export async function getOutboxCounts(): Promise<{
  conflicts: number;
  pending: number;
}> {
  const [pending, sent, conflicts] = await Promise.all([
    fridayDb.outbox.where('state').equals('pending').count(),
    fridayDb.outbox.where('state').equals('sent').count(),
    fridayDb.outbox.where('state').equals('conflict').count(),
  ]);
  return { conflicts, pending: pending + sent };
}
