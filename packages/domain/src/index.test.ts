import { describe, expect, it } from 'vitest';

import {
  buildBudgetMonthlyProjection,
  buildBudgetPlanBalance,
  buildBudgetSummary,
  getBudgetEnvelopeBalance,
  getBudgetClosingProposal,
  getEffectiveBudgetEntries,
  getBudgetOccurrenceDates,
  getSuggestedMonthlyProvision,
  getBudgetProvisionPlan,
  getBudgetSavingsBalance,
  getNextRecurrenceDate,
  getRecurrenceDates,
  normalizeTaskNote,
  normalizeTaskTitle,
} from './index.js';

describe('budget rules', () => {
  it('keeps actual savings separate from the remaining monthly cash', () => {
    const summary = buildBudgetSummary([
      { kind: 'income', amountCents: 300_000, transferDirection: null },
      { kind: 'expense', amountCents: 120_000, transferDirection: null },
      {
        kind: 'savings_transfer',
        amountCents: 40_000,
        transferDirection: 'deposit',
      },
      {
        kind: 'savings_transfer',
        amountCents: 5_000,
        transferDirection: 'withdrawal',
      },
    ]);
    expect(summary).toEqual({
      expensesCents: 120_000,
      incomeCents: 300_000,
      remainingCents: 145_000,
      savingsCents: 35_000,
      savingsRate: 35_000 / 300_000,
    });
    expect(buildBudgetSummary([]).savingsRate).toBeNull();
  });

  it('calculates the reserve from its opening balance and transfer history', () => {
    expect(
      getBudgetSavingsBalance(
        [
          {
            amountCents: 5_000,
            kind: 'savings_transfer',
            transferDirection: 'deposit',
          },
          {
            amountCents: 1_200,
            kind: 'savings_transfer',
            transferDirection: 'withdrawal',
          },
          {
            amountCents: 9_999,
            kind: 'expense',
            transferDirection: null,
          },
        ],
        10_000,
      ),
    ).toBe(13_800);
  });

  it('never turns an overspent reservation into extra closing surplus', () => {
    expect(
      getBudgetClosingProposal({
        remainingCents: 50_000,
        carryEnvelopeReservationCents: -10_000,
        plannedReservationCents: 15_000,
      }),
    ).toBe(35_000);
    expect(
      getBudgetClosingProposal({
        remainingCents: 10_000,
        carryEnvelopeReservationCents: 6_000,
        plannedReservationCents: 5_000,
      }),
    ).toBe(0);
  });

  it('clamps monthly and leap-day annual occurrences', () => {
    expect(
      getBudgetOccurrenceDates(
        {
          frequency: 'monthly',
          dueDay: 31,
          dueMonth: null,
          startDate: '2026-01-01',
          endDate: null,
        },
        '2026-01-01',
        '2026-03-31',
      ),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(
      getBudgetOccurrenceDates(
        {
          frequency: 'yearly',
          dueDay: 29,
          dueMonth: 2,
          startDate: '2027-01-01',
          endDate: null,
        },
        '2027-01-01',
        '2028-12-31',
      ),
    ).toEqual(['2027-02-28', '2028-02-29']);
  });

  it('rounds a provision upward and treats an overdue expense as due now', () => {
    expect(
      getSuggestedMonthlyProvision(10_000, '2026-08-09', '2026-10-20'),
    ).toBe(3_334);
    expect(
      getSuggestedMonthlyProvision(10_000, '2026-08-09', '2026-07-20'),
    ).toBe(10_000);
  });

  it('adjusts the last provision cent and tracks the accumulated reserve', () => {
    expect(
      getBudgetProvisionPlan({
        amountCents: 10_000,
        monthlyProvisionCents: 3_334,
        startMonth: '2026-08-01',
        asOfMonth: '2026-10-01',
      }),
    ).toEqual({
      installmentCents: 3_332,
      provisionedCents: 10_000,
      remainingCents: 0,
    });
  });

  it('exposes an unallocated amount before envelopes are committed', () => {
    expect(
      buildBudgetPlanBalance({
        forecastIncomeCents: 300_000,
        fixedExpensesCents: 120_000,
        envelopeAllocationsCents: 80_000,
        projectProvisionsCents: 20_000,
        savingsTargetCents: 30_000,
      }),
    ).toEqual({ committedCents: 250_000, unallocatedCents: 50_000 });
  });

  it('projects exactly twelve rolling civil months', () => {
    const projection = buildBudgetMonthlyProjection('2026-08', [
      { date: '2026-08-01', kind: 'income', amountCents: 200_000 },
      { date: '2026-08-03', kind: 'expense', amountCents: 50_000 },
      { date: '2027-07-03', kind: 'expense', amountCents: 10_000 },
    ]);
    expect(projection).toHaveLength(12);
    expect(projection[0]).toMatchObject({
      month: '2026-08',
      remainingCents: 150_000,
    });
    expect(projection.at(-1)).toMatchObject({
      month: '2027-07',
      remainingCents: -10_000,
    });
  });

  it('keeps envelope allocation, report and spending explicit', () => {
    expect(
      getBudgetEnvelopeBalance({
        allocationCents: 30_000,
        reportCents: 12_000,
        spentCents: 35_000,
      }),
    ).toBe(7_000);
  });

  it('keeps a corrected movement in audit but out of effective totals', () => {
    const entries = [
      { id: 'old', correctionOfId: null, amountCents: 1200 },
      { id: 'new', correctionOfId: 'old', amountCents: 1000 },
    ];
    expect(getEffectiveBudgetEntries(entries)).toEqual([entries[1]]);
  });
});

describe('normalizeTaskTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeTaskTitle('  Sortir   les poubelles  ')).toBe(
      'Sortir les poubelles',
    );
  });
});

describe('task recurrence', () => {
  it('supports daily, weekly and custom-day intervals', () => {
    expect(getNextRecurrenceDate('2026-08-08', 'daily')).toBe('2026-08-09');
    expect(getNextRecurrenceDate('2026-08-08', 'weekly')).toBe('2026-08-15');
    expect(
      getNextRecurrenceDate('2026-08-08', {
        anchorDate: '2026-08-08',
        interval: 3,
        unit: 'day',
      }),
    ).toBe('2026-08-11');
  });

  it('preserves the anchor day for monthly and yearly recurrences', () => {
    const monthly = {
      anchorDate: '2026-01-31',
      interval: 1,
      unit: 'month',
    } as const;
    expect(getNextRecurrenceDate('2026-01-31', monthly)).toBe('2026-02-28');
    expect(getNextRecurrenceDate('2026-02-28', monthly)).toBe('2026-03-31');
    expect(
      getNextRecurrenceDate('2028-02-29', {
        anchorDate: '2028-02-29',
        interval: 1,
        unit: 'year',
      }),
    ).toBe('2029-02-28');
  });

  it('materializes occurrences through the inclusive end date', () => {
    expect(
      getRecurrenceDates('2026-08-08', {
        anchorDate: '2026-08-08',
        endDate: '2026-08-14',
        interval: 3,
        unit: 'day',
      }),
    ).toEqual(['2026-08-08', '2026-08-11', '2026-08-14']);
  });
});

describe('normalizeTaskNote', () => {
  it('keeps an optional note or returns null when empty', () => {
    expect(normalizeTaskNote('  Penser au justificatif  ')).toBe(
      'Penser au justificatif',
    );
    expect(normalizeTaskNote('   ')).toBeNull();
  });
});
