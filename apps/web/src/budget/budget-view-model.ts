import {
  buildBudgetMonthlyProjection,
  buildBudgetPlanBalance,
  buildBudgetSummary,
  getBudgetClosingProposal,
  getBudgetEnvelopeBalance,
  getBudgetOccurrenceDates,
  getBudgetProvisionPlan,
  getBudgetSavingsBalance,
  getEffectiveBudgetEntries,
} from '@friday/domain';
import { type BudgetState } from '../db/budget-repository.js';
import { monthBounds, today } from './budget-format.js';
export function buildBudgetViewModel({
  state,
  ownerFilter,
  currentProfileId,
  otherProfileId,
  bounds,
}: {
  state: BudgetState;
  ownerFilter: 'all' | 'household' | 'me' | 'other';
  currentProfileId: string;
  otherProfileId: string | null;
  bounds: ReturnType<typeof monthBounds>;
}) {
  const selectedOwnerId =
    ownerFilter === 'household'
      ? null
      : ownerFilter === 'me'
        ? currentProfileId
        : ownerFilter === 'other'
          ? otherProfileId
          : undefined;

  const matchesOwner = (ownerProfileId: string | null) =>
    selectedOwnerId === undefined || ownerProfileId === selectedOwnerId;

  const allEffectiveEntries = getEffectiveBudgetEntries(state.entries);

  const effectiveEntries = allEffectiveEntries.filter((entry) =>
    matchesOwner(entry.ownerProfileId),
  );

  const monthEntries = effectiveEntries.filter(
    (entry) =>
      entry.occurredOn >= bounds.start && entry.occurredOn <= bounds.end,
  );

  const summary = buildBudgetSummary(
    monthEntries.map((entry) => ({
      amountCents: entry.amountCents,
      kind: entry.kind,
      transferDirection: entry.transferDirection,
    })),
  );

  const allPlanned = state.plannedExpenses
    .filter((item) => item.status === 'planned' || item.status === 'draft')
    .toSorted((a, b) => a.dueDate.localeCompare(b.dueDate));

  const planned = allPlanned
    .filter((item) => matchesOwner(item.ownerProfileId))
    .toSorted((a, b) => a.dueDate.localeCompare(b.dueDate));

  const savingsTarget =
    state.savingsMonths.find((item) => item.month === bounds.start)
      ?.targetCents ?? 0;

  const monthProvision = (item: (typeof allPlanned)[number], month: string) =>
    item.provisionAccepted && item.provisionStartedMonth
      ? getBudgetProvisionPlan({
          amountCents: item.amountCents,
          monthlyProvisionCents: item.monthlyProvisionCents,
          startMonth: item.provisionStartedMonth,
          asOfMonth: month,
        })
      : {
          installmentCents: 0,
          provisionedCents: 0,
          remainingCents: item.amountCents,
        };

  const householdMonthEntries = allEffectiveEntries.filter(
    (entry) =>
      entry.occurredOn >= bounds.start && entry.occurredOn <= bounds.end,
  );

  const householdSummary = buildBudgetSummary(
    householdMonthEntries.map((entry) => ({
      amountCents: entry.amountCents,
      kind: entry.kind,
      transferDirection: entry.transferDirection,
    })),
  );

  const carryEnvelopeIdsUsedByPlans = new Set(
    allPlanned
      .filter((item) => item.provisionAccepted && item.envelopeId)
      .map((item) => item.envelopeId),
  );

  const carryReservationDelta = state.envelopes
    .filter(
      (envelope) =>
        envelope.active &&
        envelope.rollover === 'carry' &&
        !carryEnvelopeIdsUsedByPlans.has(envelope.id),
    )
    .reduce((sum, envelope) => {
      const currentSpent = householdMonthEntries
        .filter(
          (entry) =>
            entry.kind === 'expense' && entry.envelopeId === envelope.id,
        )
        .reduce((spent, entry) => spent + entry.amountCents, 0);
      return sum + Math.max(0, envelope.monthlyAllocationCents - currentSpent);
    }, 0);

  const plannedReservationDelta = allPlanned.reduce((sum, item) => {
    const provision = monthProvision(item, bounds.start);
    const installment = item.envelopeId ? 0 : provision.installmentCents;
    const dueRemainder =
      item.dueDate <= bounds.end
        ? item.provisionAccepted
          ? provision.remainingCents
          : item.amountCents
        : 0;
    return sum + installment + dueRemainder;
  }, 0);

  const closingProposal = getBudgetClosingProposal({
    remainingCents: householdSummary.remainingCents,
    carryEnvelopeReservationCents: carryReservationDelta,
    plannedReservationCents: plannedReservationDelta,
  });

  const isLastDayOfMonth = today() === bounds.end;

  const reserveTarget =
    state.recurringTemplates
      .filter(
        (item) => item.active && item.essential && item.kind === 'expense',
      )
      .reduce(
        (sum, item) =>
          sum +
          (item.frequency === 'monthly'
            ? item.amountCents
            : Math.ceil(item.amountCents / 12)),
        0,
      ) * 3;

  const dueThisMonth = planned
    .filter((item) => item.dueDate <= bounds.end)
    .reduce((sum, item) => sum + item.amountCents, 0);

  const tomorrowDate = new Date(`${today()}T12:00:00`);

  tomorrowDate.setDate(tomorrowDate.getDate() + 1);

  const tomorrow = tomorrowDate.toLocaleDateString('sv-SE');

  const recurringStillDue = state.recurringTemplates
    .filter(
      (template) =>
        template.active &&
        template.kind === 'expense' &&
        matchesOwner(template.ownerProfileId),
    )
    .reduce(
      (sum, template) =>
        sum +
        getBudgetOccurrenceDates(
          {
            frequency: template.frequency,
            dueDay: template.dueDay,
            dueMonth: template.dueMonth,
            startDate: template.startDate,
            endDate: template.endDate,
          },
          tomorrow,
          bounds.end,
        ).length *
          template.amountCents,
      0,
    );

  const forecastIncomeCents =
    state.recurringTemplates
      .filter((template) => template.active && template.kind === 'income')
      .reduce(
        (sum, template) =>
          sum +
          getBudgetOccurrenceDates(
            {
              frequency: template.frequency,
              dueDay: template.dueDay,
              dueMonth: template.dueMonth,
              startDate: template.startDate,
              endDate: template.endDate,
            },
            bounds.start,
            bounds.end,
          ).length *
            template.amountCents,
        0,
      ) +
    householdMonthEntries
      .filter((entry) => entry.kind === 'income' && !entry.recurringTemplateId)
      .reduce((sum, entry) => sum + entry.amountCents, 0);

  const forecastFixedCents = state.recurringTemplates
    .filter(
      (template) =>
        template.active &&
        template.kind === 'expense' &&
        template.category === 'fixed',
    )
    .reduce(
      (sum, template) =>
        sum +
        getBudgetOccurrenceDates(
          {
            frequency: template.frequency,
            dueDay: template.dueDay,
            dueMonth: template.dueMonth,
            startDate: template.startDate,
            endDate: template.endDate,
          },
          bounds.start,
          bounds.end,
        ).length *
          template.amountCents,
      0,
    );

  const envelopeAllocationsCents = state.envelopes
    .filter((envelope) => envelope.active)
    .reduce((sum, envelope) => sum + envelope.monthlyAllocationCents, 0);

  const projectProvisionsCents = allPlanned.reduce(
    (sum, item) =>
      sum +
      (item.envelopeId
        ? 0
        : monthProvision(item, bounds.start).installmentCents),
    0,
  );

  const planBalance = buildBudgetPlanBalance({
    forecastIncomeCents,
    fixedExpensesCents: forecastFixedCents,
    envelopeAllocationsCents,
    projectProvisionsCents,
    savingsTargetCents: savingsTarget,
  });

  const savingsSettings = state.savingsMonths.find(
    (item) => item.month === bounds.start,
  );

  const reserveActualCents = getBudgetSavingsBalance(
    allEffectiveEntries.filter(
      (entry) =>
        entry.occurredOn <= today() &&
        (!savingsSettings ||
          entry.occurredOn > savingsSettings.reserveAsOfDate),
    ),
    savingsSettings?.reserveOpeningBalanceCents ?? 0,
  );

  const recent = effectiveEntries
    .toSorted((a, b) => b.occurredOn.localeCompare(a.occurredOn))
    .slice(0, 8);

  const projection = (() => {
    const firstMonth = bounds.start.slice(0, 7);
    const endDate = new Date(`${bounds.start}T12:00:00`);
    endDate.setMonth(endDate.getMonth() + 12);
    endDate.setDate(0);
    const through = endDate.toLocaleDateString('sv-SE');
    const recurringItems = state.recurringTemplates
      .filter(
        (template) => template.active && matchesOwner(template.ownerProfileId),
      )
      .flatMap((template) =>
        getBudgetOccurrenceDates(
          {
            frequency: template.frequency,
            dueDay: template.dueDay,
            dueMonth: template.dueMonth,
            startDate: template.startDate,
            endDate: template.endDate,
          },
          bounds.start,
          through,
        ).map((date) => ({
          date,
          amountCents: template.amountCents,
          kind:
            template.kind === 'savings_transfer'
              ? template.transferDirection === 'withdrawal'
                ? ('savings_withdrawal' as const)
                : ('savings_deposit' as const)
              : template.kind,
        })),
      );
    const plannedItems = planned
      .filter((item) => item.dueDate <= through)
      .map((item) => ({
        date: item.dueDate,
        amountCents: item.amountCents,
        kind: 'expense' as const,
      }));
    const manualItems = effectiveEntries
      .filter(
        (entry) =>
          !entry.recurringTemplateId &&
          entry.occurredOn >= bounds.start &&
          entry.occurredOn <= through,
      )
      .map((entry) => ({
        date: entry.occurredOn,
        amountCents: entry.amountCents,
        kind:
          entry.kind === 'savings_transfer'
            ? entry.transferDirection === 'withdrawal'
              ? ('savings_withdrawal' as const)
              : ('savings_deposit' as const)
            : entry.kind,
      }));
    return buildBudgetMonthlyProjection(firstMonth, [
      ...recurringItems,
      ...plannedItems,
      ...manualItems,
    ]);
  })();

  const projectedPlanBalances = new Map(
    projection.map((projectionMonth) => {
      const monthStart = `${projectionMonth.month}-01`;
      const [year, month] = projectionMonth.month.split('-').map(Number);
      const monthEnd = `${projectionMonth.month}-${String(
        new Date(year!, month!, 0).getDate(),
      ).padStart(2, '0')}`;
      const occurrencesFor = (
        template: (typeof state.recurringTemplates)[number],
      ) =>
        getBudgetOccurrenceDates(
          {
            frequency: template.frequency,
            dueDay: template.dueDay,
            dueMonth: template.dueMonth,
            startDate: template.startDate,
            endDate: template.endDate,
          },
          monthStart,
          monthEnd,
        ).length;
      const incomeCents =
        state.recurringTemplates
          .filter(
            (template) =>
              template.active &&
              template.kind === 'income' &&
              matchesOwner(template.ownerProfileId),
          )
          .reduce(
            (sum, template) =>
              sum + occurrencesFor(template) * template.amountCents,
            0,
          ) +
        effectiveEntries
          .filter(
            (entry) =>
              entry.kind === 'income' &&
              !entry.recurringTemplateId &&
              entry.occurredOn.startsWith(projectionMonth.month),
          )
          .reduce((sum, entry) => sum + entry.amountCents, 0);
      const fixedCents =
        state.recurringTemplates
          .filter(
            (template) =>
              template.active &&
              template.kind === 'expense' &&
              template.category === 'fixed' &&
              matchesOwner(template.ownerProfileId),
          )
          .reduce(
            (sum, template) =>
              sum + occurrencesFor(template) * template.amountCents,
            0,
          ) +
        effectiveEntries
          .filter(
            (entry) =>
              entry.kind === 'expense' &&
              entry.category === 'fixed' &&
              !entry.recurringTemplateId &&
              entry.occurredOn.startsWith(projectionMonth.month),
          )
          .reduce((sum, entry) => sum + entry.amountCents, 0);
      const provisionsAndUncoveredCents = planned.reduce((sum, item) => {
        const provision = monthProvision(item, monthStart);
        const installment = item.envelopeId ? 0 : provision.installmentCents;
        const uncoveredAtDue = item.dueDate.startsWith(projectionMonth.month)
          ? provision.remainingCents
          : 0;
        return sum + installment + uncoveredAtDue;
      }, 0);
      const targetCents =
        state.savingsMonths.find((item) => item.month === monthStart)
          ?.targetCents ?? 0;
      return [
        projectionMonth.month,
        buildBudgetPlanBalance({
          forecastIncomeCents: incomeCents,
          fixedExpensesCents: fixedCents,
          envelopeAllocationsCents: state.envelopes
            .filter(
              (envelope) =>
                envelope.active && matchesOwner(envelope.ownerProfileId),
            )
            .reduce(
              (sum, envelope) => sum + envelope.monthlyAllocationCents,
              0,
            ),
          projectProvisionsCents: provisionsAndUncoveredCents,
          savingsTargetCents: targetCents,
        }),
      ] as const;
    }),
  );

  const envelopeBalances = state.envelopes
    .filter(
      (envelope) => envelope.active && matchesOwner(envelope.ownerProfileId),
    )
    .map((envelope) => {
      const expenses = effectiveEntries.filter(
        (entry) =>
          entry.kind === 'expense' &&
          entry.envelopeId === envelope.id &&
          (envelope.rollover === 'carry' || entry.occurredOn >= bounds.start),
      );
      const spent = expenses.reduce((sum, entry) => sum + entry.amountCents, 0);
      const createdMonth = envelope.createdAt.slice(0, 7);
      const currentMonth = bounds.start.slice(0, 7);
      const months =
        envelope.rollover === 'carry'
          ? Math.max(
              1,
              (Number(currentMonth.slice(0, 4)) -
                Number(createdMonth.slice(0, 4))) *
                12 +
                Number(currentMonth.slice(5)) -
                Number(createdMonth.slice(5)) +
                1,
            )
          : 1;
      const allocated = envelope.monthlyAllocationCents * months;
      return {
        ...envelope,
        allocated,
        spent,
        balance: getBudgetEnvelopeBalance({
          allocationCents: allocated,
          spentCents: spent,
        }),
      };
    });
  return {
    summary,
    planned,
    savingsTarget,
    monthProvision,
    closingProposal,
    isLastDayOfMonth,
    reserveTarget,
    dueThisMonth,
    recurringStillDue,
    planBalance,
    reserveActualCents,
    recent,
    projection,
    projectedPlanBalances,
    envelopeBalances,
  };
}
