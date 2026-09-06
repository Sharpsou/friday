import {
  GroceryItemRecordSchema,
  MaisonRecordSchema,
  type GroceryItemOperation,
  type MaisonCommand,
  type MaisonRecord,
  type OperationAck,
} from '@friday/contracts';
import { validateMaisonState } from '@friday/domain';
import type Database from 'better-sqlite3';

export function readMaisonRecords(database: Database.Database): MaisonRecord[] {
  return (
    database.prepare('SELECT payload_json FROM maison_records').all() as Array<{
      payload_json: string;
    }>
  ).map((r) => MaisonRecordSchema.parse(JSON.parse(r.payload_json)));
}

export function readMaisonGrocerySnapshot(database: Database.Database) {
  return (
    database
      .prepare(
        "SELECT c.payload_json FROM change_log c JOIN (SELECT entity_id, MAX(sequence) AS sequence FROM change_log WHERE entity_type='grocery_item' GROUP BY entity_id) latest ON latest.sequence=c.sequence",
      )
      .all() as Array<{ payload_json: string }>
  ).map((row) => GroceryItemRecordSchema.parse(JSON.parse(row.payload_json)));
}

class MaisonConflict extends Error {}

export function applyMaisonCommand(
  database: Database.Database,
  command: MaisonCommand,
  applyGrocery: (operation: GroceryItemOperation) => OperationAck,
): OperationAck {
  const ack: OperationAck = {
    operationId: command.operationId,
    entityId: command.entityId,
    status: 'applied',
    serverRevision: 1,
    conflictReason: null,
  };
  try {
    database.transaction(() => {
      const startCursor = (
        database
          .prepare(
            'SELECT COALESCE(MAX(sequence), 0) AS cursor FROM change_log',
          )
          .get() as { cursor: number }
      ).cursor;
      const before = readMaisonRecords(database);
      const next = new Map(before.map((r) => [r.id, r]));
      const ids = new Set<string>();
      const now = new Date().toISOString();
      for (const write of command.payload.writes) {
        const old = next.get(write.record.id);
        if (
          ids.has(write.record.id) ||
          (old?.revision ?? 0) !== write.baseRevision ||
          (old && old.kind !== write.record.kind)
        )
          throw new MaisonConflict();
        ids.add(write.record.id);
        if (
          write.record.householdId !== command.payload.householdId ||
          write.record.deviceId !== command.deviceId ||
          write.record.updatedByProfileId !== command.profileId ||
          (!old && write.record.createdByProfileId !== command.profileId)
        )
          throw new MaisonConflict();
        if (old?.kind === 'movement' || old?.kind === 'receipt')
          throw new MaisonConflict();
        if (
          old?.kind === 'preparation' &&
          old.status === 'prepared' &&
          (write.record.kind !== 'preparation' ||
            write.record.status !== 'prepared' ||
            write.record.actualPortionsMilli !== old.actualPortionsMilli ||
            write.record.recipeId !== old.recipeId ||
            write.record.deletedAt)
        )
          throw new MaisonConflict();
        if (
          old?.kind === 'meal' &&
          old.status === 'eaten' &&
          (write.record.kind !== 'meal' ||
            write.record.status !== 'eaten' ||
            JSON.stringify(write.record.servings) !==
              JSON.stringify(old.servings) ||
            write.record.deletedAt)
        )
          throw new MaisonConflict();
        if (
          old?.kind === 'recipe' &&
          JSON.stringify({
            ...old,
            revision: 0,
            updatedAt: '',
            updatedByProfileId: '',
            deviceId: '',
            deletedAt: null,
          }) !==
            JSON.stringify({
              ...write.record,
              revision: 0,
              updatedAt: '',
              updatedByProfileId: '',
              deviceId: '',
              deletedAt: null,
            })
        )
          throw new MaisonConflict();
        next.set(write.record.id, {
          ...write.record,
          revision: write.baseRevision + 1,
          createdAt: old?.createdAt ?? now,
          createdByProfileId: old?.createdByProfileId ?? command.profileId,
          updatedAt: now,
        });
      }
      // Quantity changes must have a matching append-only movement in the same command.
      for (const write of command.payload.writes)
        if (write.record.kind === 'movement') {
          const movement = write.record;
          const stock = command.payload.writes.find(
            (w) => w.record.id === movement.stockId,
          )?.record;
          const old = before.find((r) => r.id === movement.stockId);
          if (
            movement.deletedAt ||
            stock?.kind !== 'stock' ||
            JSON.stringify(movement.before) !==
              JSON.stringify(old?.kind === 'stock' ? old.quantity : null) ||
            JSON.stringify(movement.after) !== JSON.stringify(stock.quantity)
          )
            throw new MaisonConflict();
          if (movement.compensatesId) {
            const compensated = before.find(
              (r) => r.id === movement.compensatesId,
            );
            if (
              compensated?.kind !== 'movement' ||
              compensated.stockId !== movement.stockId ||
              movement.reason !== 'correction'
            )
              throw new MaisonConflict();
          }
        }
      for (const write of command.payload.writes)
        if (write.record.kind === 'stock') {
          const old = before.find((r) => r.id === write.record.id);
          const beforeQuantity = old?.kind === 'stock' ? old.quantity : null;
          if (
            !old ||
            JSON.stringify(beforeQuantity) !==
              JSON.stringify(write.record.quantity)
          ) {
            const movements = command.payload.writes.filter(
              (w) =>
                w.record.kind === 'movement' &&
                w.record.stockId === write.record.id,
            );
            if (movements.length !== 1) throw new MaisonConflict();
            const movement = movements[0]!.record;
            if (
              movement.kind !== 'movement' ||
              JSON.stringify(movement.before) !==
                JSON.stringify(beforeQuantity) ||
              JSON.stringify(movement.after) !==
                JSON.stringify(write.record.quantity)
            )
              throw new MaisonConflict();
          }
        }
      try {
        validateMaisonState([...next.values()]);
      } catch {
        throw new MaisonConflict();
      }
      const groceryIds = new Set<string>();
      for (const [index, write] of command.payload.groceryWrites.entries()) {
        if (groceryIds.has(write.id)) throw new MaisonConflict();
        groceryIds.add(write.id);
        const row = database
          .prepare('SELECT * FROM grocery_items WHERE id = ?')
          .get(write.id) as
          | {
              revision: number;
              checked_at: string | null;
              created_at: string;
              created_by_profile_id: string;
              manual_store_family_id: string | null;
              manual_aisle_id: string | null;
              deleted_at: string | null;
            }
          | undefined;
        if (
          (row?.revision ?? 0) !== write.baseRevision ||
          row?.checked_at ||
          row?.deleted_at
        )
          throw new MaisonConflict();
        const record = GroceryItemRecordSchema.parse({
          id: write.id,
          householdId: command.payload.householdId,
          revision: write.baseRevision,
          label: write.label,
          quantityText: write.quantityText,
          checkedAt: null,
          manualStoreFamilyId: row?.manual_store_family_id ?? null,
          manualAisleId: row?.manual_aisle_id ?? null,
          createdAt: row?.created_at ?? now,
          updatedAt: now,
          deletedAt: write.deleted ? now : null,
          createdByProfileId: row?.created_by_profile_id ?? command.profileId,
          updatedByProfileId: command.profileId,
          deviceId: command.deviceId,
          schemaVersion: 1,
        });
        const result = applyGrocery({
          ...command,
          operationId: `${command.operationId}:g:${index}`,
          entityType: 'grocery_item',
          entityId: write.id,
          baseRevision: write.baseRevision,
          payload: record,
        });
        if (result.status !== 'applied') throw new MaisonConflict();
      }
      for (const write of command.payload.writes)
        if (write.record.kind === 'receipt') {
          const row = database
            .prepare('SELECT checked_at FROM grocery_items WHERE id = ?')
            .get(write.record.groceryItemId) as
            { checked_at: string | null } | undefined;
          if (row?.checked_at !== write.record.checkedAt)
            throw new MaisonConflict();
        }
      for (const id of ids) {
        const record = next.get(id)!;
        const payload = JSON.stringify(record);
        database
          .prepare(
            'INSERT INTO maison_records(id, kind, household_id, revision, payload_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, payload_json=excluded.payload_json',
          )
          .run(id, record.kind, record.householdId, record.revision, payload);
        database
          .prepare(
            "INSERT INTO change_log(entity_type, entity_id, operation, payload_json, created_at) VALUES ('maison_record', ?, 'upsert', ?, ?)",
          )
          .run(id, payload, now);
      }
      database
        .prepare('UPDATE change_log SET command_id = ? WHERE sequence > ?')
        .run(command.operationId, startCursor);
    })();
  } catch (error) {
    // Domain conflicts are retained with the client command for explicit reconciliation.
    if (
      !(error instanceof MaisonConflict) &&
      !(
        error instanceof Error &&
        'code' in error &&
        String(error.code).startsWith('SQLITE_CONSTRAINT')
      )
    )
      throw error;
    ack.status = 'conflict';
    ack.serverRevision = 0;
    ack.conflictReason = 'revision_mismatch';
  }
  database
    .prepare(
      'INSERT INTO applied_operations(operation_id, result_json, applied_at) VALUES (?, ?, ?)',
    )
    .run(command.operationId, JSON.stringify(ack), new Date().toISOString());
  return ack;
}

export { MAISON_MIGRATION } from '../db/migrations/045.js';
