import {
  BudgetEntryOperationSchema,
  BudgetEntryRecordSchema,
  BudgetEnvelopeOperationSchema,
  BudgetEnvelopeRecordSchema,
  BudgetPlannedExpenseOperationSchema,
  BudgetPlannedExpenseRecordSchema,
  BudgetRecurringTemplateOperationSchema,
  BudgetRecurringTemplateRecordSchema,
  BudgetSavingsMonthOperationSchema,
  BudgetSavingsMonthRecordSchema,
  SyncOperationSchema,
  type BudgetCategory,
  type BudgetEntryRecord,
  type BudgetEnvelopeRecord,
  type BudgetPlannedExpenseRecord,
  type BudgetRecurringTemplateRecord,
  type BudgetSavingsMonthRecord,
  type SyncOperation,
} from '@friday/contracts';
import { getBudgetOccurrenceDates } from '@friday/domain';

import { decryptJson, encryptJson } from '../crypto/vault.js';
import { budgetAad, outboxAad } from './encryption-context.js';
import { fridayDb, type BudgetRow } from './friday-db.js';
import { getDeviceContext } from './task-repository.js';

const HOUSEHOLD_ID = '1030b4f6-1e0f-48fa-adab-865750ce597d';

export interface BudgetState {
  entries: BudgetEntryRecord[];
  envelopes: BudgetEnvelopeRecord[];
  plannedExpenses: BudgetPlannedExpenseRecord[];
  recurringTemplates: BudgetRecurringTemplateRecord[];
  savingsMonths: BudgetSavingsMonthRecord[];
}

export interface CreateBudgetEntryInput {
  amountCents: number;
  category?: BudgetCategory | null;
  correctionOfId?: string | null;
  envelopeId?: string | null;
  id?: string;
  incomeType?: 'extra' | 'regular' | null;
  kind: 'expense' | 'income' | 'savings_transfer';
  label: string;
  occurredOn: string;
  ownerProfileId?: string | null;
  plannedExpenseId?: string | null;
  recurringTemplateId?: string | null;
  source?: 'automatic' | 'import' | 'manual';
  transferDirection?: 'deposit' | 'withdrawal' | null;
}

export interface CreateBudgetEnvelopeInput {
  category: BudgetCategory;
  dueDate?: string | null;
  id?: string;
  kind?: 'monthly' | 'project';
  monthlyAllocationCents: number;
  name: string;
  ownerProfileId?: string | null;
  rollover: 'carry' | 'reset';
  targetAmountCents?: number | null;
}

export interface UpdateBudgetEnvelopeInput {
  category: BudgetCategory;
  monthlyAllocationCents: number;
  name: string;
  ownerProfileId: string | null;
  rollover: 'carry' | 'reset';
}

export interface CreateBudgetPlannedExpenseInput {
  amountCents: number;
  category: BudgetCategory;
  dueDate: string;
  envelopeId?: string | null;
  label: string;
  monthlyProvisionCents?: number;
  note?: string | null;
  ownerProfileId?: string | null;
  priority?: 'high' | 'low' | 'medium' | null;
  provisionAccepted?: boolean;
}

export interface CreateBudgetRecurringTemplateInput {
  active?: boolean;
  amountCents: number;
  category?: BudgetCategory | null;
  dueDay: number;
  dueMonth?: number | null;
  endDate?: string | null;
  envelopeId?: string | null;
  essential?: boolean;
  frequency: 'monthly' | 'yearly';
  incomeType?: 'extra' | 'regular' | null;
  kind: 'expense' | 'income' | 'savings_transfer';
  label: string;
  ownerProfileId?: string | null;
  startDate: string;
  transferDirection?: 'deposit' | 'withdrawal' | null;
}

type BudgetEntityType =
  | 'budget_entry'
  | 'budget_envelope'
  | 'budget_planned_expense'
  | 'budget_recurring_template'
  | 'budget_savings_month';
type BudgetRecord =
  | BudgetEntryRecord
  | BudgetEnvelopeRecord
  | BudgetPlannedExpenseRecord
  | BudgetRecurringTemplateRecord
  | BudgetSavingsMonthRecord;

function requiredLabel(value: string): string {
  const label = value.trim().replace(/\s+/gu, ' ');
  if (!label) throw new Error('Le libellé est obligatoire.');
  return label;
}

function localDateMonthsAgo(months: number): string {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

async function deterministicUuid(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function tableFor(entityType: BudgetEntityType) {
  switch (entityType) {
    case 'budget_entry':
      return fridayDb.budgetEntries;
    case 'budget_envelope':
      return fridayDb.budgetEnvelopes;
    case 'budget_planned_expense':
      return fridayDb.budgetPlannedExpenses;
    case 'budget_recurring_template':
      return fridayDb.budgetRecurringTemplates;
    case 'budget_savings_month':
      return fridayDb.budgetSavingsMonths;
  }
}

async function queueRecord(
  entityType: BudgetEntityType,
  record: BudgetRecord,
  operation: SyncOperation,
): Promise<void> {
  const { deviceId, key } = await getDeviceContext();
  const [encrypted, encryptedPayload] = await Promise.all([
    encryptJson(key, record, budgetAad(entityType, record.id, deviceId)),
    encryptJson(key, operation, outboxAad(operation.operationId, deviceId)),
  ]);
  await fridayDb.transaction(
    'rw',
    tableFor(entityType),
    fridayDb.outbox,
    async () => {
      await tableFor(entityType).put({
        encrypted,
        id: record.id,
        revision: record.revision,
        syncState: 'pending',
        updatedAt: record.updatedAt,
      });
      await fridayDb.outbox.put({
        createdAt: operation.clientCreatedAt,
        encryptedPayload,
        entityId: record.id,
        operationId: operation.operationId,
        state: 'pending',
      });
    },
  );
}

function auditFields(
  id: string,
  now: string,
  profileId: string,
  deviceId: string,
) {
  return {
    id,
    householdId: HOUSEHOLD_ID,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdByProfileId: profileId,
    updatedByProfileId: profileId,
    deviceId,
    schemaVersion: 1 as const,
  };
}

export async function createBudgetEntry(
  input: CreateBudgetEntryInput,
): Promise<BudgetEntryRecord> {
  const { deviceId, profileId } = await getDeviceContext();
  const now = new Date().toISOString();
  const id =
    input.id ??
    (input.correctionOfId
      ? await deterministicUuid(`budget-correction:${input.correctionOfId}`)
      : crypto.randomUUID());
  const entry = BudgetEntryRecordSchema.parse({
    ...auditFields(id, now, profileId, deviceId),
    kind: input.kind,
    category: input.category ?? null,
    incomeType: input.incomeType ?? null,
    transferDirection: input.transferDirection ?? null,
    label: requiredLabel(input.label),
    amountCents: input.amountCents,
    occurredOn: input.occurredOn,
    ownerProfileId: input.ownerProfileId ?? null,
    envelopeId: input.envelopeId ?? null,
    plannedExpenseId: input.plannedExpenseId ?? null,
    recurringTemplateId: input.recurringTemplateId ?? null,
    correctionOfId: input.correctionOfId ?? null,
    source: input.source ?? 'manual',
  });
  const operationId = input.recurringTemplateId
    ? await deterministicUuid(`budget-entry-operation:${id}`)
    : crypto.randomUUID();
  const operation = BudgetEntryOperationSchema.parse({
    protocolVersion: 1,
    operationId,
    deviceId,
    profileId,
    entityType: 'budget_entry',
    entityId: id,
    operation: 'upsert',
    baseRevision: 0,
    clientCreatedAt: now,
    payload: entry,
  });
  await queueRecord('budget_entry', entry, operation);
  return entry;
}

export async function createBudgetEnvelope(
  input: CreateBudgetEnvelopeInput,
): Promise<BudgetEnvelopeRecord> {
  const { deviceId, profileId } = await getDeviceContext();
  const now = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();
  const envelope = BudgetEnvelopeRecordSchema.parse({
    ...auditFields(id, now, profileId, deviceId),
    name: requiredLabel(input.name),
    kind: input.kind ?? 'monthly',
    category: input.category,
    ownerProfileId: input.ownerProfileId ?? null,
    monthlyAllocationCents: input.monthlyAllocationCents,
    rollover: input.rollover,
    targetAmountCents: input.targetAmountCents ?? null,
    dueDate: input.dueDate ?? null,
    active: true,
  });
  const operation = BudgetEnvelopeOperationSchema.parse({
    protocolVersion: 1,
    operationId: input.id
      ? await deterministicUuid(`budget-envelope-operation:${id}`)
      : crypto.randomUUID(),
    deviceId,
    profileId,
    entityType: 'budget_envelope',
    entityId: id,
    operation: 'upsert',
    baseRevision: 0,
    clientCreatedAt: now,
    payload: envelope,
  });
  await queueRecord('budget_envelope', envelope, operation);
  return envelope;
}

export async function updateBudgetEnvelope(
  id: string,
  input: UpdateBudgetEnvelopeInput,
): Promise<BudgetEnvelopeRecord> {
  return updateBudgetRecord(
    'budget_envelope',
    id,
    (value) => BudgetEnvelopeRecordSchema.parse(value),
    (record) => ({
      ...record,
      name: requiredLabel(input.name),
      category: input.category,
      monthlyAllocationCents: input.monthlyAllocationCents,
      rollover: input.rollover,
      ownerProfileId: input.ownerProfileId,
    }),
  );
}

export async function createBudgetPlannedExpense(
  input: CreateBudgetPlannedExpenseInput,
): Promise<BudgetPlannedExpenseRecord> {
  const { deviceId, profileId } = await getDeviceContext();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const expense = BudgetPlannedExpenseRecordSchema.parse({
    ...auditFields(id, now, profileId, deviceId),
    label: requiredLabel(input.label),
    amountCents: input.amountCents,
    dueDate: input.dueDate,
    category: input.category,
    ownerProfileId: input.ownerProfileId ?? null,
    priority: input.priority ?? null,
    status: 'planned',
    envelopeId: input.envelopeId ?? null,
    provisionAccepted: input.provisionAccepted ?? false,
    provisionStartedMonth: null,
    monthlyProvisionCents: input.monthlyProvisionCents ?? 0,
    paidEntryId: null,
    note: input.note?.trim() || null,
  });
  const operation = BudgetPlannedExpenseOperationSchema.parse({
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    deviceId,
    profileId,
    entityType: 'budget_planned_expense',
    entityId: id,
    operation: 'upsert',
    baseRevision: 0,
    clientCreatedAt: now,
    payload: expense,
  });
  await queueRecord('budget_planned_expense', expense, operation);
  return expense;
}

export async function createBudgetRecurringTemplate(
  input: CreateBudgetRecurringTemplateInput,
): Promise<BudgetRecurringTemplateRecord> {
  const { deviceId, profileId } = await getDeviceContext();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const template = BudgetRecurringTemplateRecordSchema.parse({
    ...auditFields(id, now, profileId, deviceId),
    ...input,
    label: requiredLabel(input.label),
    category: input.category ?? null,
    incomeType: input.incomeType ?? null,
    transferDirection: input.transferDirection ?? null,
    dueMonth: input.dueMonth ?? null,
    endDate: input.endDate ?? null,
    essential: input.essential ?? false,
    active: input.active ?? true,
    ownerProfileId: input.ownerProfileId ?? null,
    envelopeId: input.envelopeId ?? null,
  });
  const operation = BudgetRecurringTemplateOperationSchema.parse({
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    deviceId,
    profileId,
    entityType: 'budget_recurring_template',
    entityId: id,
    operation: 'upsert',
    baseRevision: 0,
    clientCreatedAt: now,
    payload: template,
  });
  await queueRecord('budget_recurring_template', template, operation);
  return template;
}

export async function upsertBudgetSavingsMonth(input: {
  month: string;
  reserveAsOfDate?: string;
  reserveOpeningBalanceCents?: number;
  reserveTargetMonths?: number;
  targetCents: number;
}): Promise<BudgetSavingsMonthRecord> {
  const { deviceId, profileId } = await getDeviceContext();
  const now = new Date().toISOString();
  const id = await deterministicUuid(
    `budget-savings-month:${HOUSEHOLD_ID}:${input.month}`,
  );
  const existing = await fridayDb.budgetSavingsMonths.get(id);
  if (existing) {
    return updateBudgetRecord(
      'budget_savings_month',
      id,
      (value) => BudgetSavingsMonthRecordSchema.parse(value),
      (record) => ({
        ...record,
        month: input.month,
        targetCents: input.targetCents,
        reserveAsOfDate: input.reserveAsOfDate ?? record.reserveAsOfDate,
        reserveOpeningBalanceCents:
          input.reserveOpeningBalanceCents ?? record.reserveOpeningBalanceCents,
        reserveTargetMonths:
          input.reserveTargetMonths ?? record.reserveTargetMonths,
      }),
    );
  }
  const record = BudgetSavingsMonthRecordSchema.parse({
    ...auditFields(id, now, profileId, deviceId),
    ...input,
    reserveAsOfDate: input.reserveAsOfDate ?? todayLocalDate(),
    reserveOpeningBalanceCents: input.reserveOpeningBalanceCents ?? 0,
    reserveTargetMonths: input.reserveTargetMonths ?? 3,
  });
  const operation = BudgetSavingsMonthOperationSchema.parse({
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    deviceId,
    profileId,
    entityType: 'budget_savings_month',
    entityId: id,
    operation: 'upsert',
    baseRevision: 0,
    clientCreatedAt: now,
    payload: record,
  });
  await queueRecord('budget_savings_month', record, operation);
  return record;
}

async function decryptRows<T>(
  entityType: BudgetEntityType,
  rows: BudgetRow[],
  parse: (value: unknown) => T,
): Promise<T[]> {
  const { deviceId, key } = await getDeviceContext();
  return Promise.all(
    rows.map(async (row) =>
      parse(
        await decryptJson(
          key,
          row.encrypted,
          budgetAad(entityType, row.id, deviceId),
        ),
      ),
    ),
  );
}

export async function listBudgetState(): Promise<BudgetState> {
  const [entryRows, envelopeRows, plannedRows, templateRows, savingsRows] =
    await Promise.all([
      fridayDb.budgetEntries.toArray(),
      fridayDb.budgetEnvelopes.toArray(),
      fridayDb.budgetPlannedExpenses.toArray(),
      fridayDb.budgetRecurringTemplates.toArray(),
      fridayDb.budgetSavingsMonths.toArray(),
    ]);
  const [
    entries,
    envelopes,
    plannedExpenses,
    recurringTemplates,
    savingsMonths,
  ] = await Promise.all([
    decryptRows('budget_entry', entryRows, (value) =>
      BudgetEntryRecordSchema.parse(value),
    ),
    decryptRows('budget_envelope', envelopeRows, (value) =>
      BudgetEnvelopeRecordSchema.parse(value),
    ),
    decryptRows('budget_planned_expense', plannedRows, (value) =>
      BudgetPlannedExpenseRecordSchema.parse(value),
    ),
    decryptRows('budget_recurring_template', templateRows, (value) =>
      BudgetRecurringTemplateRecordSchema.parse(value),
    ),
    decryptRows('budget_savings_month', savingsRows, (value) =>
      BudgetSavingsMonthRecordSchema.parse(value),
    ),
  ]);
  return {
    entries: entries
      .filter((record) => record.deletedAt === null)
      .toSorted((a, b) =>
        a.occurredOn === b.occurredOn
          ? a.id.localeCompare(b.id)
          : a.occurredOn.localeCompare(b.occurredOn),
      ),
    envelopes: envelopes.filter((record) => record.deletedAt === null),
    plannedExpenses: plannedExpenses.filter(
      (record) => record.deletedAt === null,
    ),
    recurringTemplates: recurringTemplates.filter(
      (record) => record.deletedAt === null,
    ),
    savingsMonths: savingsMonths.filter((record) => record.deletedAt === null),
  };
}

export async function materializeDueBudgetEntries(
  today: string,
): Promise<number> {
  const state = await listBudgetState();
  const existingIds = new Set(
    (await fridayDb.budgetEntries.toCollection().primaryKeys()).map(String),
  );
  let created = 0;
  for (const template of state.recurringTemplates.filter(
    (item) => item.active,
  )) {
    const from =
      template.startDate > localDateMonthsAgo(24)
        ? template.startDate
        : localDateMonthsAgo(24);
    const dates = getBudgetOccurrenceDates(
      {
        frequency: template.frequency,
        dueDay: template.dueDay,
        dueMonth: template.dueMonth,
        startDate: template.startDate,
        endDate: template.endDate,
      },
      from,
      today,
    );
    for (const occurredOn of dates) {
      const id = await deterministicUuid(
        `budget-occurrence:${template.id}:${occurredOn}`,
      );
      if (existingIds.has(id)) continue;
      await createBudgetEntry({
        id,
        kind: template.kind,
        category: template.category,
        incomeType: template.incomeType,
        transferDirection: template.transferDirection,
        label: template.label,
        amountCents: template.amountCents,
        occurredOn,
        ownerProfileId: template.ownerProfileId,
        envelopeId: template.envelopeId,
        recurringTemplateId: template.id,
        source: 'automatic',
      });
      existingIds.add(id);
      created += 1;
    }
  }
  return created;
}

async function updateBudgetRecord<T extends BudgetRecord>(
  entityType: BudgetEntityType,
  id: string,
  parse: (value: unknown) => T,
  mutate: (record: T, updatedAt: string) => T,
): Promise<T> {
  const { deviceId, key, profileId } = await getDeviceContext();
  const table = tableFor(entityType);
  const row = await table.get(id);
  if (!row) throw new Error('Élément budgétaire introuvable.');
  const current = parse(
    await decryptJson(key, row.encrypted, budgetAad(entityType, id, deviceId)),
  );
  const pendingCount = await fridayDb.outbox
    .where('entityId')
    .equals(id)
    .and(
      (operation) =>
        operation.state === 'pending' || operation.state === 'sent',
    )
    .count();
  const updatedAt = new Date().toISOString();
  const baseRevision = current.revision + (pendingCount > 0 ? 1 : 0);
  const updated = parse({
    ...mutate(current, updatedAt),
    revision: baseRevision,
    updatedAt,
    updatedByProfileId: profileId,
    deviceId,
  });
  const operation = SyncOperationSchema.parse({
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    deviceId,
    profileId,
    entityType,
    entityId: id,
    operation: 'upsert',
    baseRevision,
    clientCreatedAt: updatedAt,
    payload: updated,
  });
  await queueRecord(entityType, updated, operation);
  return updated;
}

export async function ignoreBudgetEntry(
  id: string,
): Promise<BudgetEntryRecord> {
  return deleteBudgetEntry(id);
}

export async function deleteBudgetEntry(
  id: string,
): Promise<BudgetEntryRecord> {
  const current = await getBudgetEntryById(id);
  if (!current || current.deletedAt !== null) {
    throw new Error('Mouvement budgétaire introuvable.');
  }
  if (current.correctionOfId) {
    const replaced = await getBudgetEntryById(current.correctionOfId);
    if (replaced?.deletedAt === null) await deleteBudgetEntry(replaced.id);
  }
  return updateBudgetRecord(
    'budget_entry',
    id,
    (value) => BudgetEntryRecordSchema.parse(value),
    (record, updatedAt) => ({ ...record, deletedAt: updatedAt }),
  );
}

export async function deleteBudgetRecurringTemplate(
  id: string,
): Promise<BudgetRecurringTemplateRecord> {
  return updateBudgetRecord(
    'budget_recurring_template',
    id,
    (value) => BudgetRecurringTemplateRecordSchema.parse(value),
    (record, updatedAt) => ({
      ...record,
      active: false,
      deletedAt: updatedAt,
    }),
  );
}

export async function deleteBudgetRecurringSeriesFromEntry(
  entryId: string,
): Promise<void> {
  const entry = await getBudgetEntryById(entryId);
  if (!entry || entry.deletedAt !== null || !entry.recurringTemplateId) {
    throw new Error('Occurrence récurrente introuvable.');
  }
  await deleteBudgetEntry(entry.id);
  await deleteBudgetRecurringTemplate(entry.recurringTemplateId);
}

export async function deleteBudgetEnvelope(
  id: string,
): Promise<BudgetEnvelopeRecord> {
  const state = await listBudgetState();
  const usedByActivePlan = state.plannedExpenses.some(
    (item) =>
      item.envelopeId === id &&
      (item.status === 'draft' || item.status === 'planned'),
  );
  if (usedByActivePlan) {
    throw new Error(
      "Cette enveloppe finance encore une dépense future. Retirez d'abord ce lien.",
    );
  }
  return updateBudgetRecord(
    'budget_envelope',
    id,
    (value) => BudgetEnvelopeRecordSchema.parse(value),
    (record, updatedAt) => ({ ...record, active: false, deletedAt: updatedAt }),
  );
}

export async function setBudgetPlannedProvision(
  id: string,
  accepted: boolean,
): Promise<BudgetPlannedExpenseRecord> {
  return updateBudgetRecord(
    'budget_planned_expense',
    id,
    (value) => BudgetPlannedExpenseRecordSchema.parse(value),
    (record) => ({
      ...record,
      provisionAccepted: accepted,
      provisionStartedMonth: accepted
        ? (record.provisionStartedMonth ?? `${todayLocalDate().slice(0, 7)}-01`)
        : null,
    }),
  );
}

export async function setBudgetRecurringTemplateActive(
  id: string,
  active: boolean,
): Promise<BudgetRecurringTemplateRecord> {
  return updateBudgetRecord(
    'budget_recurring_template',
    id,
    (value) => BudgetRecurringTemplateRecordSchema.parse(value),
    (record) => ({ ...record, active }),
  );
}

export async function updateBudgetRecurringTemplate(
  id: string,
  patch: Pick<
    BudgetRecurringTemplateRecord,
    | 'amountCents'
    | 'dueDay'
    | 'dueMonth'
    | 'endDate'
    | 'essential'
    | 'frequency'
    | 'label'
    | 'startDate'
  >,
): Promise<BudgetRecurringTemplateRecord> {
  return updateBudgetRecord(
    'budget_recurring_template',
    id,
    (value) => BudgetRecurringTemplateRecordSchema.parse(value),
    (record) => ({ ...record, ...patch }),
  );
}

export async function payBudgetPlannedExpense(
  id: string,
): Promise<BudgetEntryRecord> {
  const state = await listBudgetState();
  const planned = state.plannedExpenses.find((item) => item.id === id);
  if (!planned) throw new Error('Dépense future introuvable.');
  const paymentId =
    planned.paidEntryId ??
    (await deterministicUuid(`budget-planned-payment:${planned.id}`));
  const existing = await getBudgetEntryById(paymentId);
  const entry =
    existing ??
    (await createBudgetEntry({
      id: paymentId,
      kind: 'expense',
      amountCents: planned.amountCents,
      category: planned.category,
      envelopeId: planned.envelopeId,
      label: planned.label,
      occurredOn: todayLocalDate(),
      ownerProfileId: planned.ownerProfileId,
      plannedExpenseId: planned.id,
    }));
  await updateBudgetRecord(
    'budget_planned_expense',
    id,
    (value) => BudgetPlannedExpenseRecordSchema.parse(value),
    (record) => ({ ...record, status: 'paid', paidEntryId: entry.id }),
  );
  return entry;
}

export async function createBudgetClosing(
  month: string,
  amountCents: number,
): Promise<BudgetEntryRecord> {
  const id = await deterministicUuid(`budget-closing:${HOUSEHOLD_ID}:${month}`);
  const existing = await getBudgetEntryById(id);
  if (existing) return existing;
  return createBudgetEntry({
    id,
    kind: 'savings_transfer',
    transferDirection: 'deposit',
    amountCents,
    label: `Clôture ${month.slice(0, 7)}`,
    occurredOn: todayLocalDate(),
    ownerProfileId: null,
  });
}

async function getBudgetEntryById(
  id: string,
): Promise<BudgetEntryRecord | null> {
  const row = await fridayDb.budgetEntries.get(id);
  if (!row) return null;
  const { deviceId, key } = await getDeviceContext();
  const entry = BudgetEntryRecordSchema.parse(
    await decryptJson(
      key,
      row.encrypted,
      budgetAad('budget_entry', id, deviceId),
    ),
  );
  return entry.deletedAt === null ? entry : null;
}

function todayLocalDate(): string {
  return new Date().toLocaleDateString('sv-SE');
}
