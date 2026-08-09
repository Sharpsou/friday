import type Database from 'better-sqlite3';

import {
  GroceryItemRecordSchema,
  TaskRecordSchema,
  type Change,
  type GroceryItemOperation,
  type GroceryItemRecord,
  type OperationAck,
  type PullResponse,
  type PushResponse,
  type SyncOperation,
  type TaskRecord,
} from '@friday/contracts';

interface TaskRow {
  id: string;
  household_id: string;
  revision: number;
  title: string;
  due_date: string | null;
  due_time: string | null;
  duration_minutes: number | null;
  assignee_profile_id: string | null;
  recurrence: string | null;
  note: string | null;
  status: 'todo' | 'done';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by_profile_id: string;
  updated_by_profile_id: string;
  device_id: string;
  schema_version: 1;
}

interface AppliedOperationRow {
  result_json: string;
}

interface GroceryItemRow {
  id: string;
  household_id: string;
  revision: number;
  label: string;
  quantity_text: string | null;
  checked_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by_profile_id: string;
  updated_by_profile_id: string;
  device_id: string;
  schema_version: 1;
}

interface ChangeRow {
  sequence: number;
  entity_type: 'grocery_item' | 'task';
  entity_id: string;
  operation: 'upsert';
  payload_json: string;
}

export class SyncService {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  push(operations: readonly SyncOperation[]): PushResponse {
    const acks = operations.map((operation) => this.#apply(operation));
    return { acks, cursor: this.#currentCursor() };
  }

  pull(after: number): PullResponse {
    const rows = this.#database
      .prepare(
        `SELECT sequence, entity_type, entity_id, operation, payload_json
         FROM change_log
         WHERE sequence > ?
         ORDER BY sequence ASC
         LIMIT 500`,
      )
      .all(after) as ChangeRow[];

    const changes: Change[] = rows.map((row) => {
      const common = {
        cursor: row.sequence,
        entityId: row.entity_id,
        operation: row.operation,
      } as const;
      if (row.entity_type === 'grocery_item') {
        return {
          ...common,
          entityType: 'grocery_item',
          payload: GroceryItemRecordSchema.parse(JSON.parse(row.payload_json)),
        };
      }
      return {
        ...common,
        entityType: 'task',
        payload: TaskRecordSchema.parse(JSON.parse(row.payload_json)),
      };
    });

    return {
      changes,
      cursor: changes.at(-1)?.cursor ?? after,
    };
  }

  #apply(operation: SyncOperation): OperationAck {
    return this.#database.transaction(() => {
      const prior = this.#database
        .prepare(
          'SELECT result_json FROM applied_operations WHERE operation_id = ?',
        )
        .get(operation.operationId) as AppliedOperationRow | undefined;

      if (prior) {
        return JSON.parse(prior.result_json) as OperationAck;
      }

      if (operation.entityType === 'grocery_item') {
        return this.#applyGroceryItem(operation);
      }

      const current = this.#database
        .prepare('SELECT * FROM tasks WHERE id = ?')
        .get(operation.entityId) as TaskRow | undefined;

      if ((current?.revision ?? 0) !== operation.baseRevision) {
        const conflict: OperationAck = {
          operationId: operation.operationId,
          entityId: operation.entityId,
          status: 'conflict',
          serverRevision: current?.revision ?? 0,
          conflictReason: 'revision_mismatch',
        };
        this.#remember(operation.operationId, conflict);
        return conflict;
      }

      const now = new Date().toISOString();
      const revision = (current?.revision ?? 0) + 1;
      const canonical: TaskRecord = {
        ...operation.payload,
        revision,
        createdAt: current?.created_at ?? now,
        updatedAt: now,
        updatedByProfileId: operation.profileId,
        deviceId: operation.deviceId,
      };

      this.#database
        .prepare(
          `INSERT INTO tasks (
             id, household_id, revision, title, due_date, due_time,
             duration_minutes, assignee_profile_id, recurrence, note, status,
             created_at, updated_at, deleted_at,
             created_by_profile_id, updated_by_profile_id, device_id, schema_version
           ) VALUES (
             @id, @householdId, @revision, @title, @dueDate, @dueTime,
             @durationMinutes, @assigneeProfileId, @recurrence, @note, @status,
             @createdAt, @updatedAt, @deletedAt,
             @createdByProfileId, @updatedByProfileId, @deviceId, @schemaVersion
           )
           ON CONFLICT(id) DO UPDATE SET
             household_id = excluded.household_id,
             revision = excluded.revision,
             title = excluded.title,
             due_date = excluded.due_date,
             due_time = excluded.due_time,
             duration_minutes = excluded.duration_minutes,
             assignee_profile_id = excluded.assignee_profile_id,
             recurrence = excluded.recurrence,
             note = excluded.note,
             status = excluded.status,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             updated_by_profile_id = excluded.updated_by_profile_id,
             device_id = excluded.device_id,
             schema_version = excluded.schema_version`,
        )
        .run({
          ...canonical,
          recurrence:
            canonical.recurrence === null
              ? null
              : JSON.stringify(canonical.recurrence),
        });

      this.#database
        .prepare(
          `INSERT INTO change_log (
             entity_type, entity_id, operation, payload_json, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          'task',
          operation.entityId,
          'upsert',
          JSON.stringify(canonical),
          now,
        );

      const ack: OperationAck = {
        operationId: operation.operationId,
        entityId: operation.entityId,
        status: 'applied',
        serverRevision: revision,
        conflictReason: null,
      };
      this.#remember(operation.operationId, ack);
      return ack;
    })();
  }

  #applyGroceryItem(operation: GroceryItemOperation): OperationAck {
    const current = this.#database
      .prepare('SELECT * FROM grocery_items WHERE id = ?')
      .get(operation.entityId) as GroceryItemRow | undefined;

    if ((current?.revision ?? 0) !== operation.baseRevision) {
      const conflict: OperationAck = {
        operationId: operation.operationId,
        entityId: operation.entityId,
        status: 'conflict',
        serverRevision: current?.revision ?? 0,
        conflictReason: 'revision_mismatch',
      };
      this.#remember(operation.operationId, conflict);
      return conflict;
    }

    const now = new Date().toISOString();
    const revision = (current?.revision ?? 0) + 1;
    const canonical: GroceryItemRecord = {
      ...operation.payload,
      revision,
      createdAt: current?.created_at ?? now,
      updatedAt: now,
      updatedByProfileId: operation.profileId,
      deviceId: operation.deviceId,
    };

    this.#database
      .prepare(
        `INSERT INTO grocery_items (
           id, household_id, revision, label, quantity_text, checked_at,
           created_at, updated_at, deleted_at, created_by_profile_id,
           updated_by_profile_id, device_id, schema_version
         ) VALUES (
           @id, @householdId, @revision, @label, @quantityText, @checkedAt,
           @createdAt, @updatedAt, @deletedAt, @createdByProfileId,
           @updatedByProfileId, @deviceId, @schemaVersion
         )
         ON CONFLICT(id) DO UPDATE SET
           household_id = excluded.household_id,
           revision = excluded.revision,
           label = excluded.label,
           quantity_text = excluded.quantity_text,
           checked_at = excluded.checked_at,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           updated_by_profile_id = excluded.updated_by_profile_id,
           device_id = excluded.device_id,
           schema_version = excluded.schema_version`,
      )
      .run(canonical);

    this.#database
      .prepare(
        `INSERT INTO change_log (
           entity_type, entity_id, operation, payload_json, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'grocery_item',
        operation.entityId,
        'upsert',
        JSON.stringify(canonical),
        now,
      );

    const ack: OperationAck = {
      operationId: operation.operationId,
      entityId: operation.entityId,
      status: 'applied',
      serverRevision: revision,
      conflictReason: null,
    };
    this.#remember(operation.operationId, ack);
    return ack;
  }

  #remember(operationId: string, ack: OperationAck): void {
    this.#database
      .prepare(
        `INSERT INTO applied_operations (operation_id, result_json, applied_at)
         VALUES (?, ?, ?)`,
      )
      .run(operationId, JSON.stringify(ack), new Date().toISOString());
  }

  #currentCursor(): number {
    const row = this.#database
      .prepare('SELECT COALESCE(MAX(sequence), 0) AS cursor FROM change_log')
      .get() as { cursor: number };
    return row.cursor;
  }
}
