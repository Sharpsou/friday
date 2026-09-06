import {
  BudgetEntryRecordSchema,
  BudgetEnvelopeRecordSchema,
  BudgetPlannedExpenseRecordSchema,
  BudgetRecurringTemplateRecordSchema,
  BudgetSavingsMonthRecordSchema,
  GroceryItemRecordSchema,
  TaskRecordSchema,
  type Change,
  type GroceryItemRecord,
  type OperationAck,
  type TaskRecord,
} from '@friday/contracts';
import { decryptJson, encryptJson } from '../crypto/vault.js';
import { getDeviceContext } from './device-context.js';
import { budgetAad, groceryItemAad, taskAad } from './encryption-context.js';
import {
  fridayDb,
  type BudgetRow,
  type GroceryItemRow,
  type TaskRow,
} from './friday-db.js';
import { applyMaisonAcks, maisonRecordAad } from './maison-repository.js';

export async function applyAcks(
  incomingAcks: readonly OperationAck[],
): Promise<void> {
  const acks = await applyMaisonAcks(incomingAcks);
  const { deviceId, key } = await getDeviceContext();
  const entityUpdates = await Promise.all(
    acks.map(async (ack) => {
      const [taskRow, groceryRow, ...budgetRows] = await Promise.all([
        fridayDb.tasks.get(ack.entityId),
        fridayDb.groceryItems.get(ack.entityId),
        fridayDb.budgetEntries.get(ack.entityId),
        fridayDb.budgetEnvelopes.get(ack.entityId),
        fridayDb.budgetPlannedExpenses.get(ack.entityId),
        fridayDb.budgetRecurringTemplates.get(ack.entityId),
        fridayDb.budgetSavingsMonths.get(ack.entityId),
      ]);
      const budgetTypes = [
        'budget_entry',
        'budget_envelope',
        'budget_planned_expense',
        'budget_recurring_template',
        'budget_savings_month',
      ] as const;
      const budgetIndex = budgetRows.findIndex(Boolean);
      const budgetRow = budgetIndex >= 0 ? budgetRows[budgetIndex] : undefined;
      const budgetType =
        budgetIndex >= 0 ? budgetTypes[budgetIndex] : undefined;
      if (!taskRow && !groceryRow && !budgetRow) return null;
      if (ack.status === 'conflict') {
        const existingRow = taskRow ?? groceryRow ?? budgetRow;
        if (!existingRow) return null;
        return {
          entityType: taskRow
            ? ('task' as const)
            : groceryRow
              ? ('grocery_item' as const)
              : budgetType!,
          id: ack.entityId,
          encrypted: existingRow.encrypted,
          revision: existingRow.revision,
          syncState: 'conflict' as const,
        };
      }

      if (budgetRow && budgetType) {
        const schema = {
          budget_entry: BudgetEntryRecordSchema,
          budget_envelope: BudgetEnvelopeRecordSchema,
          budget_planned_expense: BudgetPlannedExpenseRecordSchema,
          budget_recurring_template: BudgetRecurringTemplateRecordSchema,
          budget_savings_month: BudgetSavingsMonthRecordSchema,
        }[budgetType];
        const record = schema.parse(
          await decryptJson(
            key,
            budgetRow.encrypted,
            budgetAad(budgetType, budgetRow.id, deviceId),
          ),
        );
        const acknowledged = { ...record, revision: ack.serverRevision };
        return {
          entityType: budgetType,
          id: ack.entityId,
          encrypted: await encryptJson(
            key,
            acknowledged,
            budgetAad(budgetType, budgetRow.id, deviceId),
          ),
          revision: ack.serverRevision,
          syncState: 'acknowledged' as const,
        };
      }

      if (taskRow) {
        const task = TaskRecordSchema.parse(
          await decryptJson<TaskRecord>(
            key,
            taskRow.encrypted,
            taskAad(taskRow.id, deviceId),
          ),
        );
        const acknowledgedTask = TaskRecordSchema.parse({
          ...task,
          revision: ack.serverRevision,
        });
        return {
          entityType: 'task' as const,
          id: ack.entityId,
          encrypted: await encryptJson(
            key,
            acknowledgedTask,
            taskAad(taskRow.id, deviceId),
          ),
          revision: ack.serverRevision,
          syncState: 'acknowledged' as const,
        };
      }

      if (!groceryRow) return null;
      const groceryItem = GroceryItemRecordSchema.parse(
        await decryptJson<GroceryItemRecord>(
          key,
          groceryRow.encrypted,
          groceryItemAad(groceryRow.id, deviceId),
        ),
      );
      const acknowledgedGroceryItem = GroceryItemRecordSchema.parse({
        ...groceryItem,
        revision: ack.serverRevision,
      });
      return {
        entityType: 'grocery_item' as const,
        id: ack.entityId,
        encrypted: await encryptJson(
          key,
          acknowledgedGroceryItem,
          groceryItemAad(groceryRow.id, deviceId),
        ),
        revision: ack.serverRevision,
        syncState: 'acknowledged' as const,
      };
    }),
  );

  await fridayDb.transaction(
    'rw',
    [
      fridayDb.groceryItems,
      fridayDb.budgetEntries,
      fridayDb.budgetEnvelopes,
      fridayDb.budgetPlannedExpenses,
      fridayDb.budgetRecurringTemplates,
      fridayDb.budgetSavingsMonths,
      fridayDb.outbox,
      fridayDb.tasks,
    ],
    async () => {
      for (const [index, ack] of acks.entries()) {
        const syncState =
          ack.status === 'applied' ? 'acknowledged' : 'conflict';
        const entityUpdate = entityUpdates[index];
        await fridayDb.outbox.update(ack.operationId, { state: syncState });
        if (entityUpdate) {
          const update = {
            encrypted: entityUpdate.encrypted,
            revision: entityUpdate.revision,
            syncState: entityUpdate.syncState,
          };
          if (entityUpdate.entityType === 'task') {
            await fridayDb.tasks.update(entityUpdate.id, update);
          } else if (entityUpdate.entityType === 'grocery_item') {
            await fridayDb.groceryItems.update(entityUpdate.id, update);
          } else if (entityUpdate.entityType === 'budget_entry') {
            await fridayDb.budgetEntries.update(entityUpdate.id, update);
          } else if (entityUpdate.entityType === 'budget_envelope') {
            await fridayDb.budgetEnvelopes.update(entityUpdate.id, update);
          } else if (entityUpdate.entityType === 'budget_planned_expense') {
            await fridayDb.budgetPlannedExpenses.update(
              entityUpdate.id,
              update,
            );
          } else if (entityUpdate.entityType === 'budget_recurring_template') {
            await fridayDb.budgetRecurringTemplates.update(
              entityUpdate.id,
              update,
            );
          } else {
            await fridayDb.budgetSavingsMonths.update(entityUpdate.id, update);
          }
        }
      }
    },
  );
}

export async function applyChanges(
  incomingChanges: readonly Change[],
  cursor: number,
): Promise<void> {
  const changes = incomingChanges;
  const { deviceId, key } = await getDeviceContext();
  const encryptedChanges = await Promise.all(
    changes.map(async (change) => {
      const aad =
        change.entityType === 'maison_record'
          ? maisonRecordAad(change.entityId, deviceId)
          : change.entityType === 'task'
            ? taskAad(change.entityId, deviceId)
            : change.entityType === 'grocery_item'
              ? groceryItemAad(change.entityId, deviceId)
              : budgetAad(change.entityType, change.entityId, deviceId);
      return {
        entityType: change.entityType,
        row: {
          encrypted: await encryptJson(key, change.payload, aad),
          id: change.entityId,
          revision: change.payload.revision,
          syncState: 'acknowledged' as const,
          updatedAt: change.payload.updatedAt,
        },
      };
    }),
  );
  const taskRows: TaskRow[] = [];
  const maisonRows: TaskRow[] = [];
  const groceryRows: GroceryItemRow[] = [];
  const budgetRows = new Map<string, BudgetRow[]>();
  for (const change of encryptedChanges) {
    if (change.entityType === 'maison_record') maisonRows.push(change.row);
    else if (change.entityType === 'task') taskRows.push(change.row);
    else if (change.entityType === 'grocery_item') groceryRows.push(change.row);
    else {
      const rows = budgetRows.get(change.entityType) ?? [];
      rows.push(change.row);
      budgetRows.set(change.entityType, rows);
    }
  }

  await fridayDb.transaction(
    'rw',
    [
      fridayDb.groceryItems,
      fridayDb.maisonRecords,
      fridayDb.budgetEntries,
      fridayDb.budgetEnvelopes,
      fridayDb.budgetPlannedExpenses,
      fridayDb.budgetRecurringTemplates,
      fridayDb.budgetSavingsMonths,
      fridayDb.tasks,
      fridayDb.settings,
    ],
    async () => {
      if (taskRows.length > 0) await fridayDb.tasks.bulkPut(taskRows);
      for (const row of maisonRows) {
        const current = await fridayDb.maisonRecords.get(row.id);
        if (
          current &&
          (current.syncState !== 'acknowledged' ||
            current.revision > row.revision)
        )
          continue;
        await fridayDb.maisonRecords.put(row);
      }
      for (const row of groceryRows) {
        const current = await fridayDb.groceryItems.get(row.id);
        if (
          current &&
          (current.syncState !== 'acknowledged' ||
            current.revision > row.revision)
        )
          continue;
        await fridayDb.groceryItems.put(row);
      }
      await fridayDb.budgetEntries.bulkPut(
        budgetRows.get('budget_entry') ?? [],
      );
      await fridayDb.budgetEnvelopes.bulkPut(
        budgetRows.get('budget_envelope') ?? [],
      );
      await fridayDb.budgetPlannedExpenses.bulkPut(
        budgetRows.get('budget_planned_expense') ?? [],
      );
      await fridayDb.budgetRecurringTemplates.bulkPut(
        budgetRows.get('budget_recurring_template') ?? [],
      );
      await fridayDb.budgetSavingsMonths.bulkPut(
        budgetRows.get('budget_savings_month') ?? [],
      );
      await fridayDb.settings.put({ key: 'cursor', value: cursor });
    },
  );
}

export async function getCursor(): Promise<number> {
  const value = (await fridayDb.settings.get('cursor'))?.value;
  return typeof value === 'number' ? value : 0;
}
