import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEffectiveBudgetEntries } from '@friday/domain';

import {
  createBudgetClosing,
  createBudgetEntry,
  createBudgetEnvelope,
  createBudgetPlannedExpense,
  createBudgetRecurringTemplate,
  deleteBudgetEntry,
  deleteBudgetEnvelope,
  deleteBudgetRecurringSeriesFromEntry,
  ignoreBudgetEntry,
  listBudgetState,
  materializeDueBudgetEntries,
  payBudgetPlannedExpense,
  setBudgetPlannedProvision,
  updateBudgetEnvelope,
  updateBudgetRecurringTemplate,
} from './budget-repository.js';
import { fridayDb } from './friday-db.js';
import {
  applyAcks,
  readPendingOperations,
  resetDatabaseForTests,
} from './task-repository.js';

beforeEach(async () => {
  await fridayDb.open();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe('local budget repository', () => {
  it('stores a movement and its outbox operation encrypted', async () => {
    const entry = await createBudgetEntry({
      kind: 'expense',
      category: 'groceries',
      label: 'Marché fictif',
      amountCents: 4250,
      occurredOn: '2026-08-09',
    });
    const raw = await fridayDb.budgetEntries.get(entry.id);
    const operations = await readPendingOperations();

    expect((await listBudgetState()).entries).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      entityType: 'budget_entry',
      entityId: entry.id,
    });
    expect(JSON.stringify(raw?.encrypted)).not.toContain('Marché fictif');
  });

  it('deletes a manual income or expense through synchronized tombstones', async () => {
    const income = await createBudgetEntry({
      kind: 'income',
      incomeType: 'extra',
      label: 'Revenu supprimable',
      amountCents: 12000,
      occurredOn: '2026-08-09',
    });
    const expense = await createBudgetEntry({
      kind: 'expense',
      category: 'extra',
      label: 'Frais supprimable',
      amountCents: 2500,
      occurredOn: '2026-08-09',
    });

    await deleteBudgetEntry(income.id);
    await deleteBudgetEntry(expense.id);

    expect((await listBudgetState()).entries).toHaveLength(0);
    expect(await fridayDb.budgetEntries.get(income.id)).toBeDefined();
    expect(await fridayDb.budgetEntries.get(expense.id)).toBeDefined();
  });

  it('does not restore the replaced amount when a correction is deleted', async () => {
    const original = await createBudgetEntry({
      kind: 'expense',
      category: 'extra',
      label: 'Montant initial',
      amountCents: 2500,
      occurredOn: '2026-08-09',
    });
    const correction = await createBudgetEntry({
      kind: 'expense',
      category: 'extra',
      label: 'Montant corrigé',
      amountCents: 2000,
      occurredOn: '2026-08-09',
      correctionOfId: original.id,
    });

    await deleteBudgetEntry(correction.id);

    expect((await listBudgetState()).entries).toHaveLength(0);
  });

  it('deletes an envelope through a synchronized tombstone', async () => {
    const envelope = await createBudgetEnvelope({
      name: 'Enveloppe supprimable',
      category: 'extra',
      monthlyAllocationCents: 5000,
      rollover: 'carry',
    });

    await deleteBudgetEnvelope(envelope.id);

    expect((await listBudgetState()).envelopes).toHaveLength(0);
    expect(await fridayDb.budgetEnvelopes.get(envelope.id)).toBeDefined();
    expect(
      (await readPendingOperations()).filter(
        (operation) => operation.entityId === envelope.id,
      ),
    ).toHaveLength(2);
  });

  it('updates an envelope without rewriting its identity or history', async () => {
    const envelope = await createBudgetEnvelope({
      name: 'Courses initiales',
      category: 'groceries',
      monthlyAllocationCents: 30000,
      rollover: 'reset',
    });

    const updated = await updateBudgetEnvelope(envelope.id, {
      name: 'Courses ajustées',
      category: 'groceries',
      monthlyAllocationCents: 42500,
      rollover: 'carry',
      ownerProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
    });

    expect(updated).toMatchObject({
      id: envelope.id,
      name: 'Courses ajustées',
      monthlyAllocationCents: 42500,
      rollover: 'carry',
      ownerProfileId: 'f61f8f8b-8d09-4575-8e83-357618e881ac',
    });
    expect((await listBudgetState()).envelopes).toEqual([updated]);
    expect(
      (await readPendingOperations()).filter(
        (operation) => operation.entityId === envelope.id,
      ),
    ).toHaveLength(2);
  });

  it('protects an envelope still used by a future expense', async () => {
    const envelope = await createBudgetEnvelope({
      name: 'Projet protégé',
      category: 'extra',
      monthlyAllocationCents: 5000,
      rollover: 'carry',
    });
    await createBudgetPlannedExpense({
      label: 'Dépense liée',
      amountCents: 15000,
      category: 'extra',
      dueDate: '2026-12-20',
      envelopeId: envelope.id,
    });

    await expect(deleteBudgetEnvelope(envelope.id)).rejects.toThrow(
      'dépense future',
    );
    expect((await listBudgetState()).envelopes).toHaveLength(1);
  });

  it('materializes recurring occurrences deterministically only once', async () => {
    await createBudgetRecurringTemplate({
      kind: 'expense',
      category: 'fixed',
      label: 'Abonnement fictif',
      amountCents: 1999,
      frequency: 'monthly',
      dueDay: 31,
      startDate: '2026-01-01',
      essential: true,
    });

    expect(await materializeDueBudgetEntries('2026-03-31')).toBe(3);
    expect(await materializeDueBudgetEntries('2026-03-31')).toBe(0);
    expect(
      (await listBudgetState()).entries.map((entry) => entry.occurredOn),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('validates a suggested provision without creating real savings', async () => {
    const expense = await createBudgetPlannedExpense({
      label: 'Projet fictif',
      amountCents: 10000,
      category: 'extra',
      dueDate: '2026-10-20',
      monthlyProvisionCents: 3334,
    });

    await setBudgetPlannedProvision(expense.id, true);
    const state = await listBudgetState();
    expect(state.plannedExpenses[0]).toMatchObject({
      provisionAccepted: true,
      monthlyProvisionCents: 3334,
      provisionStartedMonth: expect.stringMatching(/^\d{4}-\d{2}-01$/u),
    });
    expect(state.entries).toHaveLength(0);
  });

  it('stores the server revision on an acknowledged budget row', async () => {
    const entry = await createBudgetEntry({
      kind: 'income',
      incomeType: 'extra',
      label: 'Prime fictive',
      amountCents: 10000,
      occurredOn: '2026-08-09',
    });
    const [operation] = await readPendingOperations();
    if (!operation) throw new Error('Opération absente.');

    await applyAcks([
      {
        operationId: operation.operationId,
        entityId: entry.id,
        status: 'applied',
        serverRevision: 1,
        conflictReason: null,
      },
    ]);

    expect(await fridayDb.budgetEntries.get(entry.id)).toMatchObject({
      revision: 1,
      syncState: 'acknowledged',
    });
  });

  it('never rematerializes an ignored recurring occurrence', async () => {
    await createBudgetRecurringTemplate({
      kind: 'expense',
      category: 'fixed',
      label: 'Échéance à ignorer',
      amountCents: 1500,
      frequency: 'monthly',
      dueDay: 9,
      startDate: '2026-08-01',
    });
    await materializeDueBudgetEntries('2026-08-09');
    const [entry] = (await listBudgetState()).entries;
    if (!entry) throw new Error('Occurrence absente.');
    await ignoreBudgetEntry(entry.id);

    expect(await materializeDueBudgetEntries('2026-08-09')).toBe(0);
    expect((await listBudgetState()).entries).toHaveLength(0);
  });

  it('deletes one occurrence and stops its series without erasing earlier history', async () => {
    await createBudgetRecurringTemplate({
      kind: 'income',
      incomeType: 'regular',
      label: 'Revenu récurrent',
      amountCents: 200000,
      frequency: 'monthly',
      dueDay: 9,
      startDate: '2026-07-01',
    });
    await materializeDueBudgetEntries('2026-08-09');
    const entries = (await listBudgetState()).entries;
    const august = entries.find((entry) => entry.occurredOn === '2026-08-09');
    if (!august) throw new Error('Occurrence absente.');

    await deleteBudgetRecurringSeriesFromEntry(august.id);

    const state = await listBudgetState();
    expect(state.entries.map((entry) => entry.occurredOn)).toEqual([
      '2026-07-09',
    ]);
    expect(state.recurringTemplates).toHaveLength(0);
    expect(await materializeDueBudgetEntries('2026-09-09')).toBe(0);
  });

  it('changes only future occurrences when a recurring series is edited', async () => {
    const template = await createBudgetRecurringTemplate({
      kind: 'expense',
      category: 'fixed',
      label: 'Série fictive',
      amountCents: 1000,
      frequency: 'monthly',
      dueDay: 9,
      startDate: '2026-08-09',
    });
    await materializeDueBudgetEntries('2026-08-09');
    await updateBudgetRecurringTemplate(template.id, {
      label: 'Série modifiée',
      amountCents: 2000,
      frequency: 'monthly',
      dueDay: 10,
      dueMonth: null,
      startDate: '2026-09-10',
      endDate: null,
      essential: false,
    });
    await materializeDueBudgetEntries('2026-09-10');

    expect(
      (await listBudgetState()).entries.map((entry) => ({
        amountCents: entry.amountCents,
        label: entry.label,
        occurredOn: entry.occurredOn,
      })),
    ).toEqual([
      {
        amountCents: 1000,
        label: 'Série fictive',
        occurredOn: '2026-08-09',
      },
      {
        amountCents: 2000,
        label: 'Série modifiée',
        occurredOn: '2026-09-10',
      },
    ]);
  });

  it('pays the same planned expense only once', async () => {
    const planned = await createBudgetPlannedExpense({
      label: 'Réparation fictive',
      amountCents: 45000,
      category: 'extra',
      dueDate: '2026-08-09',
    });

    const first = await payBudgetPlannedExpense(planned.id);
    const second = await payBudgetPlannedExpense(planned.id);

    expect(second.id).toBe(first.id);
    expect((await listBudgetState()).entries).toHaveLength(1);
  });

  it('deduplicates a monthly closing and concurrent corrections logically', async () => {
    const original = await createBudgetEntry({
      kind: 'expense',
      category: 'extra',
      label: 'Montant initial',
      amountCents: 1200,
      occurredOn: '2026-08-09',
    });
    const corrections = await Promise.all([
      createBudgetEntry({
        kind: 'expense',
        category: 'extra',
        label: 'Correction A',
        amountCents: 1000,
        occurredOn: '2026-08-09',
        correctionOfId: original.id,
      }),
      createBudgetEntry({
        kind: 'expense',
        category: 'extra',
        label: 'Correction B',
        amountCents: 1100,
        occurredOn: '2026-08-09',
        correctionOfId: original.id,
      }),
    ]);
    const firstClosing = await createBudgetClosing('2026-08-01', 5000);
    const secondClosing = await createBudgetClosing('2026-08-01', 5000);
    const state = await listBudgetState();

    expect(corrections[0].id).toBe(corrections[1].id);
    expect(firstClosing.id).toBe(secondClosing.id);
    expect(getEffectiveBudgetEntries(state.entries)).toHaveLength(2);
  });
});
