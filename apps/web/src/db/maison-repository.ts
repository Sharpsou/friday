import {
  GroceryItemRecordSchema,
  MaisonCommandSchema,
  MaisonRecordSchema,
  type Change,
  type GroceryItemRecord,
  type MaisonCommand,
  type MaisonRecord,
  type OperationAck,
} from '@friday/contracts';
import { MAISON_HOUSEHOLD_ID, validateMaisonState } from '@friday/domain';
import { decryptJson, encryptJson } from '../crypto/vault.js';
import { getDeviceContext } from './device-context.js';
import { groceryItemAad, outboxAad } from './encryption-context.js';
import { fridayDb } from './friday-db.js';

export function maisonRecordAad(id: string, device: string) {
  return `maison:${id}:1:${device}`;
}
const aad = maisonRecordAad;
export async function listMaisonRecords(): Promise<MaisonRecord[]> {
  const { key, deviceId } = await getDeviceContext();
  return Promise.all(
    (await fridayDb.maisonRecords.toArray()).map(async (row) =>
      MaisonRecordSchema.parse(
        await decryptJson(key, row.encrypted, aad(row.id, deviceId)),
      ),
    ),
  );
}
export async function maisonFields(
  id: string = crypto.randomUUID(),
): Promise<
  Omit<
    Extract<MaisonRecord, { kind: 'product' }>,
    'kind' | 'name' | 'aliases' | 'conversions'
  >
> {
  const { deviceId, profileId } = await getDeviceContext();
  const now = new Date().toISOString();
  return {
    id,
    householdId: MAISON_HOUSEHOLD_ID,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdByProfileId: profileId,
    updatedByProfileId: profileId,
    deviceId,
    schemaVersion: 1,
  };
}
// Serialize local read/encrypt/write sequences; crypto must finish before opening Dexie transactions.
let writing: Promise<unknown> = Promise.resolve();
export function saveMaisonCommand(
  records: readonly MaisonRecord[],
  groceryWrites: MaisonCommand['payload']['groceryWrites'] = [],
): Promise<void> {
  const job = writing.then(() => save(records, groceryWrites));
  writing = job.catch(() => undefined);
  return job;
}
async function save(
  records: readonly MaisonRecord[],
  groceryWrites: MaisonCommand['payload']['groceryWrites'],
): Promise<void> {
  const { key, deviceId, profileId } = await getDeviceContext();
  const before = await listMaisonRecords();
  const existing = new Map(before.map((r) => [r.id, r]));
  const latestOutbox = await fridayDb.outbox.orderBy('createdAt').last();
  const now = new Date(
    Math.max(
      Date.now(),
      Date.parse(latestOutbox?.createdAt ?? '1970-01-01') + 1,
    ),
  ).toISOString();
  const commandId = crypto.randomUUID();
  const writes = records.map((record) => {
    const old = existing.get(record.id);
    if ((old?.revision ?? 0) !== record.revision)
      throw new Error('Ces données ont changé. Rouvrez le bilan.');
    return {
      baseRevision: record.revision,
      record: MaisonRecordSchema.parse({
        ...record,
        revision: record.revision + 1,
        updatedAt: now,
        updatedByProfileId: profileId,
        deviceId,
      }),
    };
  });
  const next = new Map(existing);
  for (const w of writes) next.set(w.record.id, w.record);
  validateMaisonState([...next.values()]);
  const command = MaisonCommandSchema.parse({
    protocolVersion: 1,
    operationId: commandId,
    entityId: commandId,
    entityType: 'maison_command',
    operation: 'upsert',
    baseRevision: 0,
    clientCreatedAt: now,
    deviceId,
    profileId,
    payload: { householdId: MAISON_HOUSEHOLD_ID, writes, groceryWrites },
  });
  const rows = await Promise.all(
    writes.map(async ({ record }) => ({
      id: record.id,
      revision: record.revision,
      updatedAt: now,
      syncState: 'pending' as const,
      encrypted: await encryptJson(key, record, aad(record.id, deviceId)),
    })),
  );
  const groceryRows = await Promise.all(
    groceryWrites.map(async (write) => {
      const row = await fridayDb.groceryItems.get(write.id);
      const old = row
        ? GroceryItemRecordSchema.parse(
            await decryptJson(
              key,
              row.encrypted,
              groceryItemAad(row.id, deviceId),
            ),
          )
        : undefined;
      if (
        (old?.revision ?? 0) !== write.baseRevision ||
        old?.checkedAt ||
        old?.deletedAt
      )
        throw new Error('Cette course a changé. Rouvrez le bilan.');
      const item: GroceryItemRecord = {
        ...(old ?? {
          ...(await maisonFields(write.id)),
          checkedAt: null,
          manualStoreFamilyId: null,
          manualAisleId: null,
        }),
        revision: write.baseRevision + 1,
        label: write.label,
        quantityText: write.quantityText,
        deletedAt: write.deleted ? now : null,
        updatedAt: now,
        updatedByProfileId: profileId,
        deviceId,
      };
      return {
        id: item.id,
        revision: item.revision,
        updatedAt: now,
        syncState: 'pending' as const,
        encrypted: await encryptJson(
          key,
          item,
          groceryItemAad(item.id, deviceId),
        ),
      };
    }),
  );
  const encrypted = await encryptJson(
    key,
    command,
    outboxAad(commandId, deviceId),
  );
  await fridayDb.transaction(
    'rw',
    [fridayDb.maisonRecords, fridayDb.groceryItems, fridayDb.outbox],
    async () => {
      for (const w of writes) {
        const current = await fridayDb.maisonRecords.get(w.record.id);
        if ((current?.revision ?? 0) !== w.baseRevision)
          throw new Error('Une synchronisation a modifié ce bilan. Réessayez.');
      }
      for (const w of groceryWrites) {
        const current = await fridayDb.groceryItems.get(w.id);
        if ((current?.revision ?? 0) !== w.baseRevision)
          throw new Error('La liste de courses a changé. Réessayez.');
      }
      await fridayDb.maisonRecords.bulkPut(rows);
      await fridayDb.groceryItems.bulkPut(groceryRows);
      await fridayDb.outbox.put({
        operationId: commandId,
        entityId: commandId,
        createdAt: now,
        encryptedPayload: encrypted,
        state: 'pending',
      });
    },
  );
}
export async function applyMaisonAcks(
  acks: readonly OperationAck[],
): Promise<OperationAck[]> {
  const { key, deviceId } = await getDeviceContext();
  const ordinary: OperationAck[] = [];
  for (const ack of acks) {
    const row = await fridayDb.outbox.get(ack.operationId);
    if (!row) {
      ordinary.push(ack);
      continue;
    }
    const raw = await decryptJson(
      key,
      row.encryptedPayload,
      outboxAad(row.operationId, deviceId),
    );
    const parsed = MaisonCommandSchema.safeParse(raw);
    if (!parsed.success) {
      ordinary.push(ack);
      continue;
    }
    const command = parsed.data;
    const state = ack.status === 'applied' ? 'acknowledged' : 'conflict';
    const conflict =
      state === 'conflict'
        ? await encryptJson(key, command, aad(ack.operationId, deviceId))
        : null;
    await fridayDb.transaction(
      'rw',
      [
        fridayDb.outbox,
        fridayDb.maisonRecords,
        fridayDb.groceryItems,
        fridayDb.maisonConflicts,
      ],
      async () => {
        await fridayDb.outbox.update(ack.operationId, { state });
        if (conflict)
          await fridayDb.maisonConflicts.put({
            id: ack.operationId,
            encrypted: conflict,
          });
        for (const w of command.payload.writes) {
          const current = await fridayDb.maisonRecords.get(w.record.id);
          if (current?.revision === w.record.revision)
            await fridayDb.maisonRecords.update(w.record.id, {
              syncState: state,
            });
        }
        for (const w of command.payload.groceryWrites) {
          const current = await fridayDb.groceryItems.get(w.id);
          if (current?.revision === w.baseRevision + 1)
            await fridayDb.groceryItems.update(w.id, { syncState: state });
        }
      },
    );
  }
  return ordinary;
}
export async function applyMaisonChanges(
  changes: readonly Change[],
): Promise<void> {
  const { key, deviceId } = await getDeviceContext();
  const rows = await Promise.all(
    changes
      .filter((c) => c.entityType === 'maison_record')
      .map(async (c) => ({
        id: c.entityId,
        revision: c.payload.revision,
        updatedAt: c.payload.updatedAt,
        syncState: 'acknowledged' as const,
        encrypted: await encryptJson(key, c.payload, aad(c.entityId, deviceId)),
      })),
  );
  await fridayDb.transaction('rw', fridayDb.maisonRecords, async () => {
    for (const row of rows) {
      const current = await fridayDb.maisonRecords.get(row.id);
      if (
        current &&
        (current.syncState !== 'acknowledged' ||
          current.revision > row.revision)
      )
        continue;
      await fridayDb.maisonRecords.put(row);
    }
  });
}
export async function bootstrapMaison(
  signal: AbortSignal,
  revalidate = false,
): Promise<boolean> {
  const initialized =
    (await fridayDb.settings.get('maisonSnapshotV1'))?.value === true;
  if (initialized && !revalidate) return true;
  const response = await fetch('/api/sync/maison-snapshot', { signal });
  if (response.status === 404) return false; // The old Hub continues to serve existing domains.
  if (!response.ok)
    throw new Error('Réserve et menus : synchronisation indisponible.');
  if (initialized) return true;
  const body = (await response.json()) as { records: unknown[] };
  const records = body.records.map((r) => MaisonRecordSchema.parse(r));
  await applyMaisonChanges(
    records.map((r, i) => ({
      cursor: i + 1,
      entityType: 'maison_record',
      entityId: r.id,
      operation: 'upsert',
      payload: r,
    })),
  );
  await fridayDb.settings.put({ key: 'maisonSnapshotV1', value: true });
  return true;
}
export async function listMaisonConflicts(): Promise<MaisonCommand[]> {
  const { key, deviceId } = await getDeviceContext();
  return Promise.all(
    (await fridayDb.maisonConflicts.toArray()).map(async (r) =>
      MaisonCommandSchema.parse(
        await decryptJson(key, r.encrypted, aad(r.id, deviceId)),
      ),
    ),
  );
}
/** Explicitly reconcile an entire connected set of failed commands, preserving their encrypted history. */
export async function acceptMaisonServer(
  command: MaisonCommand,
): Promise<void> {
  const { key, deviceId } = await getDeviceContext();
  const pending = await fridayDb.outbox
    .where('state')
    .anyOf(['pending', 'sent', 'conflict'])
    .toArray();
  const commands = await Promise.all(
    pending.map(async (row) => ({
      row,
      parsed: MaisonCommandSchema.safeParse(
        await decryptJson(
          key,
          row.encryptedPayload,
          outboxAad(row.operationId, deviceId),
        ),
      ),
    })),
  );
  const ids = new Set(command.payload.writes.map((w) => w.record.id));
  const groceryIds = new Set(command.payload.groceryWrites.map((w) => w.id));
  const operationIds = new Set([command.operationId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const entry of commands)
      if (entry.parsed.success && !operationIds.has(entry.row.operationId)) {
        const candidate = entry.parsed.data;
        if (
          candidate.payload.writes.some((w) => ids.has(w.record.id)) ||
          candidate.payload.groceryWrites.some((w) => groceryIds.has(w.id))
        ) {
          if (entry.row.state !== 'conflict')
            throw new Error(
              'Un bilan lié est encore en attente. Synchronisez avant de résoudre le conflit.',
            );
          operationIds.add(entry.row.operationId);
          for (const w of candidate.payload.writes) ids.add(w.record.id);
          for (const w of candidate.payload.groceryWrites) groceryIds.add(w.id);
          expanded = true;
        }
      }
  }
  // Ordinary edits to a touched grocery must finish before reconciliation.
  if (
    pending.some(
      (row) =>
        groceryIds.has(row.entityId) && !operationIds.has(row.operationId),
    )
  )
    throw new Error(
      'Une modification de course liée reste à synchroniser ou à résoudre.',
    );
  const priorRows = await fridayDb.maisonRecords.bulkGet([...ids]);
  const priorGroceries = await fridayDb.groceryItems.bulkGet([...groceryIds]);
  const response = await fetch('/api/sync/maison-snapshot');
  if (!response.ok)
    throw new Error('Le hub est nécessaire pour résoudre ce conflit.');
  const body = (await response.json()) as {
    cursor: number;
    records: unknown[];
    groceries: unknown[];
  };
  const server = body.records.map((r) => MaisonRecordSchema.parse(r));
  const groceries = body.groceries.map((r) => GroceryItemRecordSchema.parse(r));
  const rows = await Promise.all(
    server
      .filter((r) => ids.has(r.id))
      .map(async (r) => ({
        id: r.id,
        revision: r.revision,
        updatedAt: r.updatedAt,
        syncState: 'acknowledged' as const,
        encrypted: await encryptJson(key, r, aad(r.id, deviceId)),
      })),
  );
  const groceryRows = await Promise.all(
    groceries
      .filter((r) => groceryIds.has(r.id))
      .map(async (r) => ({
        id: r.id,
        revision: r.revision,
        updatedAt: r.updatedAt,
        syncState: 'acknowledged' as const,
        encrypted: await encryptJson(key, r, groceryItemAad(r.id, deviceId)),
      })),
  );
  await fridayDb.transaction(
    'rw',
    [
      fridayDb.maisonRecords,
      fridayDb.maisonConflicts,
      fridayDb.groceryItems,
      fridayDb.outbox,
      fridayDb.settings,
    ],
    async () => {
      if (
        JSON.stringify(await fridayDb.maisonRecords.bulkGet([...ids])) !==
          JSON.stringify(priorRows) ||
        JSON.stringify(await fridayDb.groceryItems.bulkGet([...groceryIds])) !==
          JSON.stringify(priorGroceries)
      )
        throw new Error(
          'Le bilan a changé pendant la comparaison. Recommencez avec les dernières données.',
        );
      if (!Number.isSafeInteger(body.cursor) || body.cursor < 0)
        throw new Error('Instantané de synchronisation invalide.');
      const cursor = (await fridayDb.settings.get('cursor'))?.value;
      if (typeof cursor === 'number' && cursor > body.cursor)
        await fridayDb.settings.put({ key: 'cursor', value: body.cursor });
      await fridayDb.maisonRecords.bulkDelete([...ids]);
      await fridayDb.maisonRecords.bulkPut(rows);
      await fridayDb.groceryItems.bulkDelete([...groceryIds]);
      await fridayDb.groceryItems.bulkPut(groceryRows);
      await fridayDb.maisonConflicts.bulkDelete([...operationIds]);
      for (const operationId of operationIds)
        await fridayDb.outbox.update(operationId, { state: 'acknowledged' });
    },
  );
}
