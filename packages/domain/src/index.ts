export function normalizeTaskTitle(input: string): string {
  return input.trim().replace(/\s+/gu, ' ').slice(0, 200);
}

export function normalizeTaskNote(input: string): string | null {
  const note = input.trim().replace(/\r\n?/gu, '\n').slice(0, 2_000);
  return note || null;
}

export interface BudgetSummaryInput {
  amountCents: number;
  kind: 'expense' | 'income' | 'savings_transfer';
  transferDirection: 'deposit' | 'withdrawal' | null;
}

export interface BudgetSummary {
  expensesCents: number;
  incomeCents: number;
  remainingCents: number;
  savingsCents: number;
  savingsRate: number | null;
}

export function buildBudgetSummary(
  entries: readonly BudgetSummaryInput[],
): BudgetSummary {
  let expensesCents = 0;
  let incomeCents = 0;
  let depositsCents = 0;
  let withdrawalsCents = 0;
  for (const entry of entries) {
    if (entry.kind === 'expense') expensesCents += entry.amountCents;
    else if (entry.kind === 'income') incomeCents += entry.amountCents;
    else if (entry.transferDirection === 'deposit')
      depositsCents += entry.amountCents;
    else withdrawalsCents += entry.amountCents;
  }
  const savingsCents = depositsCents - withdrawalsCents;
  return {
    expensesCents,
    incomeCents,
    remainingCents:
      incomeCents - expensesCents - depositsCents + withdrawalsCents,
    savingsCents,
    savingsRate: incomeCents > 0 ? savingsCents / incomeCents : null,
  };
}

export function getBudgetSavingsBalance(
  entries: readonly Pick<
    BudgetSummaryInput,
    'amountCents' | 'kind' | 'transferDirection'
  >[],
  openingBalanceCents = 0,
): number {
  return entries.reduce((balance, entry) => {
    if (entry.kind !== 'savings_transfer') return balance;
    return (
      balance +
      (entry.transferDirection === 'deposit'
        ? entry.amountCents
        : -entry.amountCents)
    );
  }, openingBalanceCents);
}

export function getBudgetClosingProposal(input: {
  carryEnvelopeReservationCents: number;
  plannedReservationCents: number;
  remainingCents: number;
}): number {
  return Math.max(
    0,
    input.remainingCents -
      Math.max(0, input.carryEnvelopeReservationCents) -
      Math.max(0, input.plannedReservationCents),
  );
}

interface BudgetRecurrence {
  dueDay: number;
  dueMonth: number | null;
  endDate: string | null;
  frequency: 'monthly' | 'yearly';
  startDate: string;
}

export function getBudgetOccurrenceDates(
  recurrence: BudgetRecurrence,
  fromDate: string,
  throughDate: string,
): string[] {
  const dates: string[] = [];
  const from = parseDate(fromDate);
  const through = parseDate(throughDate);
  const start = parseDate(recurrence.startDate);
  const firstYear = Math.min(from.getUTCFullYear(), start.getUTCFullYear());
  const finalYear = through.getUTCFullYear();
  for (let year = firstYear; year <= finalYear; year += 1) {
    const months =
      recurrence.frequency === 'monthly'
        ? Array.from({ length: 12 }, (_, index) => index)
        : [(recurrence.dueMonth ?? 1) - 1];
    for (const month of months) {
      const date = clampedDate(year, month, recurrence.dueDay);
      if (
        date >= recurrence.startDate &&
        date >= fromDate &&
        date <= throughDate &&
        (recurrence.endDate === null || date <= recurrence.endDate)
      ) {
        dates.push(date);
      }
    }
  }
  return dates;
}

export function getSuggestedMonthlyProvision(
  remainingCents: number,
  currentDate: string,
  dueDate: string,
): number {
  if (remainingCents <= 0) return 0;
  const current = parseDate(currentDate);
  const due = parseDate(dueDate);
  const months = Math.max(
    1,
    (due.getUTCFullYear() - current.getUTCFullYear()) * 12 +
      due.getUTCMonth() -
      current.getUTCMonth() +
      1,
  );
  return Math.ceil(remainingCents / months);
}

export function getBudgetProvisionPlan(input: {
  amountCents: number;
  asOfMonth: string;
  monthlyProvisionCents: number;
  startMonth: string;
}): {
  installmentCents: number;
  provisionedCents: number;
  remainingCents: number;
} {
  if (input.amountCents <= 0 || input.monthlyProvisionCents <= 0) {
    return {
      installmentCents: 0,
      provisionedCents: 0,
      remainingCents: Math.max(0, input.amountCents),
    };
  }
  const start = parseDate(input.startMonth);
  const current = parseDate(input.asOfMonth);
  const elapsedMonths =
    (current.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    current.getUTCMonth() -
    start.getUTCMonth();
  if (elapsedMonths < 0) {
    return {
      installmentCents: 0,
      provisionedCents: 0,
      remainingCents: input.amountCents,
    };
  }
  const previousProvisionedCents = Math.min(
    input.amountCents,
    elapsedMonths * input.monthlyProvisionCents,
  );
  const provisionedCents = Math.min(
    input.amountCents,
    (elapsedMonths + 1) * input.monthlyProvisionCents,
  );
  return {
    installmentCents: provisionedCents - previousProvisionedCents,
    provisionedCents,
    remainingCents: input.amountCents - provisionedCents,
  };
}

export function buildBudgetPlanBalance(input: {
  envelopeAllocationsCents: number;
  fixedExpensesCents: number;
  forecastIncomeCents: number;
  projectProvisionsCents: number;
  savingsTargetCents: number;
}): { committedCents: number; unallocatedCents: number } {
  const committedCents =
    input.fixedExpensesCents +
    input.envelopeAllocationsCents +
    input.projectProvisionsCents +
    input.savingsTargetCents;
  return {
    committedCents,
    unallocatedCents: input.forecastIncomeCents - committedCents,
  };
}

export interface BudgetProjectionItem {
  amountCents: number;
  date: string;
  kind: 'expense' | 'income' | 'savings_deposit' | 'savings_withdrawal';
}

export interface BudgetProjectionMonth {
  expensesCents: number;
  incomeCents: number;
  month: string;
  remainingCents: number;
  savingsCents: number;
}

export function buildBudgetMonthlyProjection(
  firstMonth: string,
  items: readonly BudgetProjectionItem[],
  monthCount = 12,
): BudgetProjectionMonth[] {
  if (monthCount < 1 || monthCount > 24) {
    throw new Error('La projection doit couvrir entre 1 et 24 mois.');
  }
  const first = parseDate(`${firstMonth.slice(0, 7)}-01`);
  return Array.from({ length: monthCount }, (_, index) => {
    const date = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1),
    );
    const month = formatDate(date).slice(0, 7);
    const summary = buildBudgetSummary(
      items
        .filter((item) => item.date.startsWith(month))
        .map((item) => ({
          amountCents: item.amountCents,
          kind:
            item.kind === 'income'
              ? ('income' as const)
              : item.kind === 'expense'
                ? ('expense' as const)
                : ('savings_transfer' as const),
          transferDirection:
            item.kind === 'savings_deposit'
              ? ('deposit' as const)
              : item.kind === 'savings_withdrawal'
                ? ('withdrawal' as const)
                : null,
        })),
    );
    return {
      month,
      incomeCents: summary.incomeCents,
      expensesCents: summary.expensesCents,
      savingsCents: summary.savingsCents,
      remainingCents: summary.remainingCents,
    };
  });
}

export function getBudgetEnvelopeBalance(input: {
  allocationCents: number;
  reportCents?: number;
  spentCents: number;
}): number {
  return (input.reportCents ?? 0) + input.allocationCents - input.spentCents;
}

export function getEffectiveBudgetEntries<
  T extends { correctionOfId: string | null; id: string },
>(entries: readonly T[]): T[] {
  const replacedIds = new Set(
    entries
      .map((entry) => entry.correctionOfId)
      .filter((id): id is string => id !== null),
  );
  return entries.filter((entry) => !replacedIds.has(entry.id));
}

interface RecurrenceRule {
  anchorDate: string;
  interval: number;
  unit: 'day' | 'week' | 'month' | 'year';
}

export function getRecurrenceDates(
  firstDate: string,
  rule: RecurrenceRule & { endDate: string },
  maximumOccurrences = 500,
): string[] {
  const dates = [firstDate];
  let current = firstDate;
  while (true) {
    const next = getNextRecurrenceDate(current, rule);
    if (next > rule.endDate) return dates;
    if (dates.length >= maximumOccurrences) {
      throw new Error(
        `Cette récurrence dépasse ${maximumOccurrences} occurrences. Rapprochez la date de fin.`,
      );
    }
    dates.push(next);
    current = next;
  }
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

function formatDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function clampedDate(year: number, month: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatDate(new Date(Date.UTC(year, month, Math.min(day, lastDay))));
}

export function getNextRecurrenceDate(
  currentDate: string,
  rule: RecurrenceRule | 'daily' | 'weekly' | 'monthly',
): string {
  const normalized: RecurrenceRule =
    typeof rule === 'string'
      ? {
          anchorDate: currentDate,
          interval: 1,
          unit: rule === 'daily' ? 'day' : rule === 'weekly' ? 'week' : 'month',
        }
      : rule;
  const current = parseDate(currentDate);
  if (normalized.unit === 'day' || normalized.unit === 'week') {
    current.setUTCDate(
      current.getUTCDate() +
        normalized.interval * (normalized.unit === 'week' ? 7 : 1),
    );
    return formatDate(current);
  }

  const anchor = parseDate(normalized.anchorDate);
  if (normalized.unit === 'month') {
    return clampedDate(
      current.getUTCFullYear(),
      current.getUTCMonth() + 1,
      anchor.getUTCDate(),
    );
  }
  return clampedDate(
    current.getUTCFullYear() + 1,
    anchor.getUTCMonth(),
    anchor.getUTCDate(),
  );
}
