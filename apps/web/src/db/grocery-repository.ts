import {
  GroceryItemOperationSchema,
  GroceryItemRecordSchema,
  type GroceryItemRecord,
} from '@friday/contracts';

import { decryptJson, encryptJson } from '../crypto/vault.js';
import { fridayDb, type GroceryItemRow } from './friday-db.js';
import { groceryItemAad, outboxAad } from './encryption-context.js';
import { getDeviceContext } from './task-repository.js';

const HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';

export type LocalGroceryItem = GroceryItemRecord & {
  syncState: GroceryItemRow['syncState'];
};

export interface CreateLocalGroceryItemInput {
  label: string;
  quantityText?: string | null;
}

function normalizeRequired(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/gu, ' ') ?? '';
  return normalized || null;
}

export async function createLocalGroceryItem(
  input: CreateLocalGroceryItemInput,
): Promise<GroceryItemRecord> {
  const label = normalizeRequired(input.label);
  if (!label) throw new Error('Le produit est obligatoire.');

  const { deviceId, key, profileId } = await getDeviceContext();
  const now = new Date().toISOString();
  const item = GroceryItemRecordSchema.parse({
    id: crypto.randomUUID(),
    householdId: HOUSEHOLD_ID,
    revision: 0,
    label,
    quantityText: normalizeOptional(input.quantityText),
    checkedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdByProfileId: profileId,
    updatedByProfileId: profileId,
    deviceId,
    schemaVersion: 1,
  });
  const operation = GroceryItemOperationSchema.parse({
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    deviceId,
    profileId,
    entityType: 'grocery_item',
    entityId: item.id,
    operation: 'upsert',
    baseRevision: 0,
    clientCreatedAt: now,
    payload: item,
  });
  const [encryptedItem, encryptedOperation] = await Promise.all([
    encryptJson(key, item, groceryItemAad(item.id, deviceId)),
    encryptJson(key, operation, outboxAad(operation.operationId, deviceId)),
  ]);

  await fridayDb.transaction(
    'rw',
    fridayDb.groceryItems,
    fridayDb.outbox,
    async () => {
      await fridayDb.groceryItems.put({
        encrypted: encryptedItem,
        id: item.id,
        revision: 0,
        syncState: 'pending',
        updatedAt: now,
      });
      await fridayDb.outbox.put({
        createdAt: now,
        encryptedPayload: encryptedOperation,
        entityId: item.id,
        operationId: operation.operationId,
        state: 'pending',
      });
    },
  );

  return item;
}

async function queueLocalGroceryItemUpdate(
  itemId: string,
  update: (
    item: GroceryItemRecord,
    updatedAt: string,
  ) => GroceryItemRecord | null,
): Promise<GroceryItemRecord> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const row = await fridayDb.groceryItems.get(itemId);
  if (!row) throw new Error('Produit introuvable.');

  const item = GroceryItemRecordSchema.parse(
    await decryptJson<GroceryItemRecord>(
      key,
      row.encrypted,
      groceryItemAad(row.id, deviceId),
    ),
  );
  const queuedOperations = await fridayDb.outbox
    .where('entityId')
    .equals(itemId)
    .and((operation) => ['pending', 'sent'].includes(operation.state))
    .toArray();
  const latestQueuedTimestamp = queuedOperations.reduce(
    (latest, operation) => Math.max(latest, Date.parse(operation.createdAt)),
    0,
  );
  const updatedAt = new Date(
    Math.max(Date.now(), latestQueuedTimestamp + 1),
  ).toISOString();
  const changedItem = update(item, updatedAt);
  if (!changedItem) return item;

  const baseRevision = item.revision + (queuedOperations.length > 0 ? 1 : 0);
  const updatedItem = GroceryItemRecordSchema.parse({
    ...changedItem,
    revision: baseRevision,
    updatedAt,
    updatedByProfileId: profileId,
    deviceId,
  });
  const operation = GroceryItemOperationSchema.parse({
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    deviceId,
    profileId,
    entityType: 'grocery_item',
    entityId: item.id,
    operation: 'upsert',
    baseRevision,
    clientCreatedAt: updatedAt,
    payload: updatedItem,
  });
  const [encryptedItem, encryptedOperation] = await Promise.all([
    encryptJson(key, updatedItem, groceryItemAad(item.id, deviceId)),
    encryptJson(key, operation, outboxAad(operation.operationId, deviceId)),
  ]);

  await fridayDb.transaction(
    'rw',
    fridayDb.groceryItems,
    fridayDb.outbox,
    async () => {
      await fridayDb.groceryItems.put({
        encrypted: encryptedItem,
        id: item.id,
        revision: updatedItem.revision,
        syncState: 'pending',
        updatedAt,
      });
      await fridayDb.outbox.put({
        createdAt: updatedAt,
        encryptedPayload: encryptedOperation,
        entityId: item.id,
        operationId: operation.operationId,
        state: 'pending',
      });
    },
  );

  return updatedItem;
}

export async function setLocalGroceryItemChecked(
  itemId: string,
  checked: boolean,
): Promise<GroceryItemRecord> {
  return queueLocalGroceryItemUpdate(itemId, (item, updatedAt) => {
    if (item.deletedAt) throw new Error('Produit introuvable.');
    if ((item.checkedAt !== null) === checked) return null;
    return { ...item, checkedAt: checked ? updatedAt : null };
  });
}

export async function deleteLocalGroceryItem(itemId: string): Promise<void> {
  await queueLocalGroceryItemUpdate(itemId, (item, updatedAt) => {
    if (item.deletedAt) return null;
    return { ...item, deletedAt: updatedAt };
  });
}

export async function listGroceryItems(): Promise<LocalGroceryItem[]> {
  const { deviceId, key } = await getDeviceContext();
  const rows = await fridayDb.groceryItems.orderBy('updatedAt').toArray();
  const items = await Promise.all(
    rows.map(async (row) => {
      const item = GroceryItemRecordSchema.parse(
        await decryptJson<GroceryItemRecord>(
          key,
          row.encrypted,
          groceryItemAad(row.id, deviceId),
        ),
      );
      return { ...item, syncState: row.syncState };
    }),
  );
  return items
    .filter((item) => item.deletedAt === null)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}
