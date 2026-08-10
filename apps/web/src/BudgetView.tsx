import { useEffect, useRef, useState } from 'react';

import type {
  BudgetCategory,
  BudgetEntryRecord,
  BudgetEnvelopeRecord,
  BudgetRecurringTemplateRecord,
} from '@friday/contracts';
import {
  buildBudgetMonthlyProjection,
  buildBudgetPlanBalance,
  buildBudgetSummary,
  getBudgetEnvelopeBalance,
  getBudgetClosingProposal,
  getEffectiveBudgetEntries,
  getBudgetOccurrenceDates,
  getBudgetProvisionPlan,
  getBudgetSavingsBalance,
  getSuggestedMonthlyProvision,
} from '@friday/domain';

import {
  createBudgetEntry,
  createBudgetClosing,
  createBudgetEnvelope,
  createBudgetPlannedExpense,
  createBudgetRecurringTemplate,
  deleteBudgetEntry,
  deleteBudgetEnvelope,
  deleteBudgetRecurringSeriesFromEntry,
  deleteBudgetRecurringTemplate,
  payBudgetPlannedExpense,
  setBudgetPlannedProvision,
  setBudgetRecurringTemplateActive,
  updateBudgetEnvelope,
  updateBudgetRecurringTemplate,
  upsertBudgetSavingsMonth,
  type BudgetState,
} from './db/budget-repository.js';

const CATEGORY_LABELS: Record<BudgetCategory, string> = {
  fixed: 'Frais fixes',
  groceries: 'Courses',
  health: 'Santé',
  leisure: 'Loisirs',
  extra: 'Extras',
};

const CURRENCY = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
});

function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

function monthBounds(date = today()): { end: string; start: string } {
  const [year, month] = date.split('-').map(Number);
  const endDay = new Date(year!, month!, 0).getDate();
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
}

function cents(value: string): number {
  return Math.round(Number(value.replace(',', '.')) * 100);
}

function formatCents(value: number): string {
  return CURRENCY.format(value / 100);
}

function plannedHorizon(dueDate: string): string {
  const days = Math.ceil(
    (Date.parse(`${dueDate}T12:00:00`) - Date.parse(`${today()}T12:00:00`)) /
      86_400_000,
  );
  if (days < 0) return 'En retard';
  if (days <= 30) return 'Sous 30 jours';
  if (days <= 60) return '31–60 jours';
  if (days <= 90) return '61–90 jours';
  return 'Après 90 jours';
}

export function BudgetView({
  currentProfileId,
  otherProfileId,
  quickOpen,
  profileNames,
  state,
  onChanged,
  onQuickOpenChange,
}: {
  currentProfileId: string;
  otherProfileId: string | null;
  quickOpen: boolean;
  profileNames: { current: string; other: string };
  state: BudgetState;
  onChanged: () => Promise<void>;
  onQuickOpenChange: (open: boolean) => void;
}) {
  const [kind, setKind] = useState<
    'expense' | 'income' | 'planned' | 'savings'
  >('expense');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<BudgetCategory>('groceries');
  const [owner, setOwner] = useState<'household' | 'me' | 'other'>('household');
  const [ownerFilter, setOwnerFilter] = useState<
    'all' | 'household' | 'me' | 'other'
  >('all');
  const [date, setDate] = useState(today());
  const [envelopeId, setEnvelopeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [transferDirection, setTransferDirection] = useState<
    'deposit' | 'withdrawal'
  >('deposit');
  const [incomeType, setIncomeType] = useState<'extra' | 'regular'>('regular');
  const [correctionOfId, setCorrectionOfId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [envelopeError, setEnvelopeError] = useState<string | null>(null);
  const [deletingEnvelopeId, setDeletingEnvelopeId] = useState<string | null>(
    null,
  );
  const [entryPendingDeletion, setEntryPendingDeletion] =
    useState<BudgetEntryRecord | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [movementError, setMovementError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bounds = monthBounds();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (quickOpen && !dialog.open) dialog.showModal();
    if (!quickOpen && dialog.open) dialog.close();
  }, [quickOpen]);

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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = cents(amount);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      setError('Saisissez un montant supérieur à zéro.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ownerProfileId =
        owner === 'household'
          ? null
          : owner === 'me'
            ? currentProfileId
            : otherProfileId;
      if (kind === 'planned') {
        const suggestion = getSuggestedMonthlyProvision(
          amountCents,
          today(),
          date,
        );
        await createBudgetPlannedExpense({
          amountCents,
          category,
          dueDate: date,
          envelopeId: envelopeId || null,
          label,
          monthlyProvisionCents: suggestion,
          ownerProfileId,
          provisionAccepted: false,
        });
      } else {
        await createBudgetEntry({
          amountCents,
          category: kind === 'expense' ? category : null,
          envelopeId: kind === 'expense' && envelopeId ? envelopeId : null,
          incomeType: kind === 'income' ? incomeType : null,
          kind: kind === 'savings' ? 'savings_transfer' : kind,
          label,
          occurredOn: date,
          ownerProfileId,
          transferDirection: kind === 'savings' ? transferDirection : null,
          correctionOfId,
        });
      }
      setAmount('');
      setLabel('');
      setEnvelopeId('');
      setCorrectionOfId(null);
      onQuickOpenChange(false);
      await onChanged();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(entry: BudgetEntryRecord, stopSeries = false) {
    setDeletingEntryId(entry.id);
    setMovementError(null);
    try {
      if (stopSeries) {
        await deleteBudgetRecurringSeriesFromEntry(entry.id);
      } else {
        await deleteBudgetEntry(entry.id);
      }
      setEntryPendingDeletion(null);
      await onChanged();
    } catch (deleteError) {
      setMovementError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Suppression impossible.',
      );
    } finally {
      setDeletingEntryId(null);
    }
  }

  return (
    <section className="screen budget-screen" aria-labelledby="budget-title">
      <div className="section-heading page-heading">
        <div>
          <span className="eyebrow">Mois en cours</span>
          <h2 id="budget-title">Budget</h2>
        </div>
        <label className="budget-owner-filter">
          <span>Attribution</span>
          <select
            aria-label="Filtrer le budget par attribution"
            value={ownerFilter}
            onChange={(event) =>
              setOwnerFilter(event.target.value as typeof ownerFilter)
            }
          >
            <option value="all">Tout le foyer</option>
            <option value="household">Maison</option>
            <option value="me">{profileNames.current}</option>
            <option value="other" disabled={!otherProfileId}>
              {profileNames.other}
            </option>
          </select>
        </label>
      </div>

      <div className="budget-summary" aria-label="Synthèse du mois">
        <article>
          <span>Reste réel</span>
          <strong>{formatCents(summary.remainingCents)}</strong>
        </article>
        <article>
          <span>À payer</span>
          <strong>{formatCents(dueThisMonth + recurringStillDue)}</strong>
        </article>
        <article>
          <span>Épargne réelle / objectif</span>
          <strong>
            {formatCents(summary.savingsCents)} / {formatCents(savingsTarget)}
          </strong>
        </article>
      </div>

      <aside
        className={`budget-plan-balance ${planBalance.unallocatedCents < 0 ? 'is-over' : ''}`}
        role="status"
      >
        <span>
          {planBalance.unallocatedCents < 0
            ? 'Budget prévisionnel dépassé'
            : 'Montant non affecté'}
        </span>
        <strong>{formatCents(planBalance.unallocatedCents)}</strong>
        <small>
          Revenus prévus − frais fixes − enveloppes − provisions − objectif
          d’épargne
        </small>
      </aside>

      <section className="panel budget-panel" aria-labelledby="envelopes-title">
        <details className="budget-collapsible">
          <summary>
            <span>
              <span className="eyebrow">Allocation</span>
              <strong id="envelopes-title">Enveloppes</strong>
            </span>
            <small>{envelopeBalances.length}</small>
          </summary>
          <div className="budget-collapsible-content">
            {envelopeBalances.length === 0 ? (
              <p className="empty-state">
                Créez Courses, Santé, Imprévus ou vos enveloppes personnelles.
              </p>
            ) : (
              <ul className="budget-list budget-envelope-list">
                {envelopeBalances.map((item) => (
                  <li
                    key={item.id}
                    className={item.balance < 0 ? 'is-over' : ''}
                  >
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {formatCents(item.spent)} /{' '}
                        {formatCents(item.allocated)}
                      </small>
                    </span>
                    <span className="budget-envelope-actions">
                      <b>{formatCents(item.balance)}</b>
                      <details className="budget-inline-editor">
                        <summary>Modifier</summary>
                        <EnvelopeEditForm
                          envelope={item}
                          currentProfileId={currentProfileId}
                          otherProfileId={otherProfileId}
                          profileNames={profileNames}
                          onChanged={onChanged}
                        />
                      </details>
                      <button
                        className="text-button"
                        type="button"
                        disabled={deletingEnvelopeId === item.id}
                        aria-label={`Supprimer l’enveloppe ${item.name}`}
                        onClick={() => {
                          setEnvelopeError(null);
                          setDeletingEnvelopeId(item.id);
                          void deleteBudgetEnvelope(item.id)
                            .then(onChanged)
                            .catch((caught: unknown) => {
                              setEnvelopeError(
                                caught instanceof Error
                                  ? caught.message
                                  : "L'enveloppe n'a pas pu être supprimée.",
                              );
                            })
                            .finally(() => setDeletingEnvelopeId(null));
                        }}
                      >
                        {deletingEnvelopeId === item.id
                          ? 'Suppression…'
                          : 'Supprimer'}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {envelopeError ? (
              <p className="form-error" role="alert">
                {envelopeError}
              </p>
            ) : null}
            <details className="budget-setup">
              <summary>Ajouter une enveloppe</summary>
              <EnvelopeForm
                currentProfileId={currentProfileId}
                onChanged={onChanged}
              />
            </details>
          </div>
        </details>
      </section>

      <section className="panel budget-panel" aria-labelledby="series-title">
        <details className="budget-collapsible">
          <summary>
            <span>
              <span className="eyebrow">Prévision récurrente</span>
              <strong id="series-title">Revenus et frais</strong>
            </span>
            <small>{state.recurringTemplates.length}</small>
          </summary>
          <div className="budget-collapsible-content">
            {state.recurringTemplates.length > 0 ? (
              <ul className="budget-list budget-series-list">
                {state.recurringTemplates
                  .toSorted((a, b) => a.label.localeCompare(b.label, 'fr'))
                  .map((template) => (
                    <li key={template.id}>
                      <span>
                        <strong>{template.label}</strong>
                        <small>
                          {formatCents(template.amountCents)} ·{' '}
                          {template.frequency === 'monthly'
                            ? 'mensuel'
                            : 'annuel'}
                          {template.endDate ? ` · fin ${template.endDate}` : ''}
                          {!template.active ? ' · suspendu' : ''}
                        </small>
                      </span>
                      <span className="budget-series-actions">
                        <details className="budget-inline-editor">
                          <summary>Modifier</summary>
                          <RecurringEditForm
                            template={template}
                            onChanged={onChanged}
                          />
                        </details>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() =>
                            void setBudgetRecurringTemplateActive(
                              template.id,
                              !template.active,
                            ).then(onChanged)
                          }
                        >
                          {template.active ? 'Suspendre' : 'Réactiver'}
                        </button>
                        <button
                          className="text-button danger-text-button"
                          type="button"
                          onClick={() =>
                            void deleteBudgetRecurringTemplate(
                              template.id,
                            ).then(onChanged)
                          }
                        >
                          Supprimer
                        </button>
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="empty-state">Aucune récurrence configurée.</p>
            )}
            <details className="budget-setup">
              <summary>Ajouter un revenu ou frais</summary>
              <RecurringForm
                currentProfileId={currentProfileId}
                onChanged={onChanged}
              />
            </details>
          </div>
        </details>
      </section>

      <section className="panel budget-panel" aria-labelledby="planned-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">30 / 60 / 90 jours</span>
            <h3 id="planned-title">Prochaines échéances et projets</h3>
          </div>
        </div>
        {planned.length === 0 ? (
          <p className="empty-state">Aucune dépense future.</p>
        ) : (
          <ul className="budget-list">
            {planned.slice(0, 8).map((item) => {
              const provision = monthProvision(item, bounds.start);
              return (
                <li key={item.id}>
                  <span>
                    <strong>{item.label}</strong>
                    <small>
                      {plannedHorizon(item.dueDate)} ·{' '}
                      {new Date(`${item.dueDate}T12:00:00`).toLocaleDateString(
                        'fr-FR',
                      )}{' '}
                      · provision suggérée{' '}
                      {formatCents(item.monthlyProvisionCents)}/mois
                      {item.provisionAccepted
                        ? ` · ${formatCents(provision.provisionedCents)} réservés, ${formatCents(provision.remainingCents)} restants`
                        : ''}
                    </small>
                    <span className="budget-inline-actions">
                      <button
                        type="button"
                        onClick={() =>
                          void setBudgetPlannedProvision(
                            item.id,
                            !item.provisionAccepted,
                          ).then(onChanged)
                        }
                      >
                        {item.provisionAccepted
                          ? 'Retirer du plan'
                          : 'Valider la provision'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void payBudgetPlannedExpense(item.id).then(onChanged)
                        }
                      >
                        Marquer payée
                      </button>
                    </span>
                  </span>
                  <b>{formatCents(item.amountCents)}</b>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel budget-panel" aria-labelledby="movements-title">
        <details className="budget-collapsible" open>
          <summary>
            <span>
              <span className="eyebrow">Historique</span>
              <strong id="movements-title">Mouvements récents</strong>
            </span>
            <small>{recent.length}</small>
          </summary>
          <div className="budget-collapsible-content">
            {recent.length === 0 ? (
              <p className="empty-state">Aucun mouvement.</p>
            ) : (
              <ul className="budget-list budget-movement-list">
                {recent.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      <strong>{entry.label}</strong>
                      <small>
                        {entry.occurredOn} ·{' '}
                        {entry.ownerProfileId === null
                          ? 'Maison'
                          : entry.ownerProfileId === currentProfileId
                            ? profileNames.current
                            : profileNames.other}
                      </small>
                      <span className="budget-inline-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setKind(
                              entry.kind === 'savings_transfer'
                                ? 'savings'
                                : entry.kind,
                            );
                            setAmount(
                              (entry.amountCents / 100)
                                .toFixed(2)
                                .replace('.', ','),
                            );
                            setLabel(entry.label);
                            setCategory(entry.category ?? 'groceries');
                            setIncomeType(entry.incomeType ?? 'regular');
                            setDate(entry.occurredOn);
                            setCorrectionOfId(entry.id);
                            onQuickOpenChange(true);
                          }}
                        >
                          Corriger
                        </button>
                        {entry.kind === 'expense' || entry.kind === 'income' ? (
                          <button
                            className="danger-text-button"
                            type="button"
                            disabled={deletingEntryId === entry.id}
                            onClick={() => {
                              if (entry.recurringTemplateId) {
                                setEntryPendingDeletion(entry);
                              } else {
                                void removeEntry(entry);
                              }
                            }}
                          >
                            {deletingEntryId === entry.id
                              ? 'Suppression…'
                              : 'Supprimer'}
                          </button>
                        ) : null}
                      </span>
                    </span>
                    <b
                      className={
                        entry.kind === 'income' ||
                        entry.transferDirection === 'withdrawal'
                          ? 'is-positive'
                          : ''
                      }
                    >
                      {entry.kind === 'income' ||
                      entry.transferDirection === 'withdrawal'
                        ? '+'
                        : '−'}
                      {formatCents(entry.amountCents)}
                    </b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </section>

      <section
        className="panel budget-panel"
        aria-labelledby="projection-title"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">12 mois glissants</span>
            <h3 id="projection-title">Prévision mensuelle</h3>
          </div>
        </div>
        <div className="budget-projection">
          {Array.from({ length: 4 }, (_, quarterIndex) => {
            const months = projection.slice(
              quarterIndex * 3,
              quarterIndex * 3 + 3,
            );
            const firstMonth = months[0];
            const lastMonth = months.at(-1);
            if (!firstMonth || !lastMonth) return null;
            const quarterTitle = [firstMonth, lastMonth]
              .map((item) =>
                new Date(`${item.month}-01T12:00:00`).toLocaleDateString(
                  'fr-FR',
                  { month: 'long' },
                ),
              )
              .join(' – ');
            const titleId = `budget-quarter-${quarterIndex}`;
            return (
              <article
                key={firstMonth.month}
                className="budget-quarter"
                aria-labelledby={titleId}
              >
                <header>
                  <strong id={titleId}>{quarterTitle}</strong>
                  <span>Trimestre {quarterIndex + 1}</span>
                </header>
                <div className="budget-quarter-months">
                  {months.map((item) => {
                    const available =
                      projectedPlanBalances.get(item.month)?.unallocatedCents ??
                      0;
                    return (
                      <div
                        key={item.month}
                        className={
                          available < 0
                            ? 'budget-month-forecast is-negative'
                            : 'budget-month-forecast'
                        }
                      >
                        <time dateTime={item.month}>
                          {new Date(
                            `${item.month}-01T12:00:00`,
                          ).toLocaleDateString('fr-FR', { month: 'short' })}
                        </time>
                        <strong>{formatCents(available)}</strong>
                        <small>disponible</small>
                        <span>{formatCents(item.remainingCents)} de flux</span>
                      </div>
                    );
                  })}
                </div>
                <details>
                  <summary>Détail des flux</summary>
                  <dl>
                    {months.map((item) => (
                      <div key={item.month}>
                        <dt>
                          {new Date(
                            `${item.month}-01T12:00:00`,
                          ).toLocaleDateString('fr-FR', { month: 'short' })}
                        </dt>
                        <dd>
                          {formatCents(item.incomeCents)} revenus ·{' '}
                          {formatCents(item.expensesCents)} sorties
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel budget-panel" aria-labelledby="savings-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Réserve</span>
            <h3 id="savings-title">Objectif d’épargne</h3>
          </div>
        </div>
        <p>
          Cible de sécurité suggérée : {formatCents(reserveTarget)} (trois mois
          de frais essentiels récurrents).
        </p>
        <p>
          Réserve réelle suivie :{' '}
          <strong>{formatCents(reserveActualCents)}</strong>
        </p>
        <SavingsForm month={bounds.start} onChanged={onChanged} />
        {isLastDayOfMonth && closingProposal > 0 ? (
          <div className="budget-closing">
            <span>
              Surplus net disponible :{' '}
              <strong>{formatCents(closingProposal)}</strong>. Les provisions
              cumulables validées sont déjà exclues.
            </span>
            <button
              type="button"
              onClick={() =>
                void createBudgetClosing(bounds.start, closingProposal).then(
                  onChanged,
                )
              }
            >
              Confirmer le versement
            </button>
          </div>
        ) : null}
      </section>

      <dialog
        ref={dialogRef}
        className="budget-dialog"
        onClose={() => onQuickOpenChange(false)}
      >
        <form method="dialog" className="dialog-close-row">
          <button type="submit" aria-label="Fermer">
            Fermer
          </button>
        </form>
        <form className="budget-form" onSubmit={(event) => void submit(event)}>
          <h3>Ajouter au budget</h3>
          <div
            className="budget-kind-switch"
            role="group"
            aria-label="Type de mouvement"
          >
            {(
              [
                ['expense', 'Dépense'],
                ['income', 'Revenu'],
                ['savings', 'Versement / retrait'],
                ['planned', 'Dépense future'],
              ] as const
            ).map(([value, text]) => (
              <button
                type="button"
                key={value}
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
              >
                {text}
              </button>
            ))}
          </div>
          <label>
            <span>Montant</span>
            <input
              autoFocus
              required
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label>
            <span>Libellé</span>
            <input
              required
              maxLength={200}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          {kind === 'expense' || kind === 'planned' ? (
            <label>
              <span>Catégorie</span>
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as BudgetCategory)
                }
              >
                {Object.entries(CATEGORY_LABELS).map(([value, text]) => (
                  <option value={value} key={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {kind === 'savings' ? (
            <label>
              <span>Mouvement</span>
              <select
                value={transferDirection}
                onChange={(event) =>
                  setTransferDirection(
                    event.target.value as typeof transferDirection,
                  )
                }
              >
                <option value="deposit">Versement vers la réserve</option>
                <option value="withdrawal">Retrait de la réserve</option>
              </select>
            </label>
          ) : null}
          {kind === 'income' ? (
            <label>
              <span>Type de revenu</span>
              <select
                value={incomeType}
                onChange={(event) =>
                  setIncomeType(event.target.value as typeof incomeType)
                }
              >
                <option value="regular">Régulier</option>
                <option value="extra">Occasionnel</option>
              </select>
            </label>
          ) : null}
          {kind === 'expense' ? (
            <label>
              <span>Enveloppe</span>
              <select
                value={envelopeId}
                onChange={(event) => setEnvelopeId(event.target.value)}
              >
                <option value="">Aucune</option>
                {state.envelopes
                  .filter((item) => item.active)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <details>
            <summary>Détails facultatifs</summary>
            <label>
              <span>Date</span>
              <input
                type="date"
                min={kind === 'planned' ? today() : undefined}
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label>
              <span>Attribution</span>
              <select
                value={owner}
                onChange={(event) =>
                  setOwner(event.target.value as typeof owner)
                }
              >
                <option value="household">Maison</option>
                <option value="me">{profileNames.current}</option>
                <option value="other" disabled={!otherProfileId}>
                  {profileNames.other}
                </option>
              </select>
            </label>
          </details>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button" disabled={saving} type="submit">
            {saving
              ? 'Enregistrement…'
              : correctionOfId
                ? 'Enregistrer la correction'
                : 'Enregistrer'}
          </button>
        </form>
      </dialog>
      {entryPendingDeletion ? (
        <div
          className="settings-backdrop"
          onMouseDown={() => {
            if (deletingEntryId === null) setEntryPendingDeletion(null);
          }}
        >
          <section
            className="settings-dialog deletion-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="budget-deletion-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-heading">
              <div>
                <span className="eyebrow">Mouvement récurrent</span>
                <h2 id="budget-deletion-title">Que supprimer&nbsp;?</h2>
              </div>
            </div>
            <p>
              Retirez seulement «&nbsp;{entryPendingDeletion.label}&nbsp;» à la
              date du {entryPendingDeletion.occurredOn}, ou retirez cette
              occurrence et arrêtez les prochaines échéances. Les mouvements
              déjà comptabilisés restent dans l’historique.
            </p>
            {movementError ? (
              <p className="form-error" role="alert">
                {movementError}
              </p>
            ) : null}
            <div className="deletion-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={deletingEntryId !== null}
                onClick={() => setEntryPendingDeletion(null)}
              >
                Annuler
              </button>
              <button
                className="secondary-button deletion-choice-button"
                type="button"
                disabled={deletingEntryId !== null}
                onClick={() => void removeEntry(entryPendingDeletion)}
              >
                Cette occurrence
              </button>
              <button
                className="delete-series-button"
                type="button"
                disabled={deletingEntryId !== null}
                onClick={() => void removeEntry(entryPendingDeletion, true)}
              >
                {deletingEntryId !== null
                  ? 'Suppression…'
                  : 'Cette occurrence et arrêter la série'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function EnvelopeForm({
  currentProfileId,
  onChanged,
}: {
  currentProfileId: string;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<BudgetCategory>('groceries');
  const [rollover, setRollover] = useState<'carry' | 'reset'>('reset');
  const [personal, setPersonal] = useState(false);
  return (
    <form
      className="budget-form compact"
      onSubmit={(event) => {
        event.preventDefault();
        void createBudgetEnvelope({
          name,
          category,
          monthlyAllocationCents: cents(amount),
          rollover,
          ownerProfileId: personal ? currentProfileId : null,
        }).then(() => {
          setName('');
          setAmount('');
          return onChanged();
        });
      }}
    >
      <label>
        <span>Nom</span>
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <span>Allocation mensuelle</span>
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label>
        <span>Catégorie</span>
        <select
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as BudgetCategory)
          }
        >
          {Object.entries(CATEGORY_LABELS)
            .filter(([value]) => value !== 'fixed')
            .map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
        </select>
      </label>
      <label>
        <span>Report</span>
        <select
          value={rollover}
          onChange={(event) =>
            setRollover(event.target.value as typeof rollover)
          }
        >
          <option value="reset">Repart à zéro</option>
          <option value="carry">Cumulable</option>
        </select>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={personal}
          onChange={(event) => setPersonal(event.target.checked)}
        />{' '}
        Perso & loisirs
      </label>
      <button type="submit">Créer</button>
    </form>
  );
}

function EnvelopeEditForm({
  envelope,
  currentProfileId,
  otherProfileId,
  profileNames,
  onChanged,
}: {
  envelope: BudgetEnvelopeRecord;
  currentProfileId: string;
  otherProfileId: string | null;
  profileNames: { current: string; other: string };
  onChanged: () => Promise<void>;
}) {
  const initialOwner =
    envelope.ownerProfileId === null
      ? 'household'
      : envelope.ownerProfileId === currentProfileId
        ? 'me'
        : 'other';
  const [name, setName] = useState(envelope.name);
  const [amount, setAmount] = useState(
    String(envelope.monthlyAllocationCents / 100),
  );
  const [category, setCategory] = useState(envelope.category);
  const [rollover, setRollover] = useState(envelope.rollover);
  const [owner, setOwner] = useState<'household' | 'me' | 'other'>(
    initialOwner,
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  return (
    <form
      className="budget-form compact"
      onSubmit={(event) => {
        event.preventDefault();
        const details = event.currentTarget.closest('details');
        setSaving(true);
        setFormError(null);
        const ownerProfileId =
          owner === 'household'
            ? null
            : owner === 'me'
              ? currentProfileId
              : (otherProfileId ?? envelope.ownerProfileId);
        void updateBudgetEnvelope(envelope.id, {
          name,
          category,
          monthlyAllocationCents: cents(amount),
          rollover,
          ownerProfileId,
        })
          .then(async () => {
            details?.removeAttribute('open');
            await onChanged();
          })
          .catch((caught: unknown) => {
            setFormError(
              caught instanceof Error
                ? caught.message
                : "L'enveloppe n'a pas pu être modifiée.",
            );
          })
          .finally(() => setSaving(false));
      }}
    >
      <label>
        <span>Nom</span>
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <span>Allocation mensuelle</span>
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label>
        <span>Catégorie</span>
        <select
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as BudgetCategory)
          }
        >
          {Object.entries(CATEGORY_LABELS)
            .filter(([value]) => value !== 'fixed')
            .map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
        </select>
      </label>
      <label>
        <span>Report</span>
        <select
          value={rollover}
          onChange={(event) =>
            setRollover(event.target.value as typeof rollover)
          }
        >
          <option value="reset" disabled={envelope.kind === 'project'}>
            Repart à zéro
          </option>
          <option value="carry">Cumulable</option>
        </select>
      </label>
      <label>
        <span>Attribution</span>
        <select
          value={owner}
          onChange={(event) => setOwner(event.target.value as typeof owner)}
        >
          <option value="household">Maison</option>
          <option value="me">{profileNames.current}</option>
          <option value="other" disabled={!otherProfileId}>
            {profileNames.other}
          </option>
        </select>
      </label>
      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}
      <button type="submit" disabled={saving}>
        {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
      </button>
    </form>
  );
}

function RecurringForm({
  currentProfileId,
  onChanged,
}: {
  currentProfileId: string;
  onChanged: () => Promise<void>;
}) {
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<BudgetCategory>('fixed');
  const [frequency, setFrequency] = useState<'once' | 'monthly' | 'yearly'>(
    'monthly',
  );
  const [date, setDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [essential, setEssential] = useState(true);
  const [personal, setPersonal] = useState(false);
  return (
    <form
      className="budget-form compact"
      onSubmit={(event) => {
        event.preventDefault();
        const [, month, day] = date.split('-').map(Number);
        const ownerProfileId = personal ? currentProfileId : null;
        const save =
          frequency === 'once'
            ? createBudgetEntry({
                kind,
                label,
                amountCents: cents(amount),
                category: kind === 'expense' ? category : null,
                incomeType: kind === 'income' ? 'extra' : null,
                occurredOn: date,
                ownerProfileId,
              })
            : createBudgetRecurringTemplate({
                kind,
                label,
                amountCents: cents(amount),
                category: kind === 'expense' ? category : null,
                incomeType: kind === 'income' ? 'regular' : null,
                frequency,
                dueDay: day!,
                dueMonth: frequency === 'yearly' ? month! : null,
                startDate: date,
                endDate: endDate || null,
                essential: kind === 'expense' && essential,
                ownerProfileId,
              });
        void save.then(() => {
          setLabel('');
          setAmount('');
          setEndDate('');
          return onChanged();
        });
      }}
    >
      <label>
        <span>Type</span>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          <option value="expense">Frais</option>
          <option value="income">Revenu</option>
        </select>
      </label>
      <label>
        <span>Libellé</span>
        <input
          required
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label>
        <span>Montant</span>
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      {kind === 'expense' ? (
        <label>
          <span>Catégorie</span>
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as BudgetCategory)
            }
          >
            {Object.entries(CATEGORY_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        <span>Fréquence</span>
        <select
          value={frequency}
          onChange={(event) =>
            setFrequency(event.target.value as typeof frequency)
          }
        >
          <option value="once">Ponctuelle</option>
          <option value="monthly">Mensuelle</option>
          <option value="yearly">Annuelle</option>
        </select>
      </label>
      <label>
        <span>
          {frequency === 'once' ? 'Date du mouvement' : 'Première échéance'}
        </span>
        <input
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      {frequency !== 'once' ? (
        <label>
          <span>Date de fin facultative</span>
          <input
            type="date"
            min={date}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
      ) : null}
      {kind === 'expense' ? (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={essential}
            onChange={(event) => setEssential(event.target.checked)}
          />{' '}
          Frais essentiel
        </label>
      ) : null}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={personal}
          onChange={(event) => setPersonal(event.target.checked)}
        />{' '}
        Attribuer à {currentProfileId ? 'mon profil' : 'Maison'}
      </label>
      <button type="submit">
        {frequency === 'once' ? 'Créer le mouvement' : 'Créer la série'}
      </button>
    </form>
  );
}

function RecurringEditForm({
  template,
  onChanged,
}: {
  template: BudgetRecurringTemplateRecord;
  onChanged: () => Promise<void>;
}) {
  const [label, setLabel] = useState(template.label);
  const [amount, setAmount] = useState(String(template.amountCents / 100));
  const [frequency, setFrequency] = useState(template.frequency);
  const [date, setDate] = useState(template.startDate);
  const [endDate, setEndDate] = useState(template.endDate ?? '');
  const [essential, setEssential] = useState(template.essential);

  return (
    <form
      className="budget-form compact"
      onSubmit={(event) => {
        event.preventDefault();
        const details = event.currentTarget.closest('details');
        const [, month, day] = date.split('-').map(Number);
        void updateBudgetRecurringTemplate(template.id, {
          label,
          amountCents: cents(amount),
          frequency,
          dueDay: day!,
          dueMonth: frequency === 'yearly' ? month! : null,
          startDate: date,
          endDate: endDate || null,
          essential: template.kind === 'expense' && essential,
        }).then(async () => {
          details?.removeAttribute('open');
          await onChanged();
        });
      }}
    >
      <label>
        <span>Libellé</span>
        <input
          required
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label>
        <span>Montant</span>
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label>
        <span>Fréquence</span>
        <select
          value={frequency}
          onChange={(event) =>
            setFrequency(event.target.value as typeof frequency)
          }
        >
          <option value="monthly">Mensuelle</option>
          <option value="yearly">Annuelle</option>
        </select>
      </label>
      <label>
        <span>Prochaine règle d'échéance</span>
        <input
          required
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <label>
        <span>Fin facultative</span>
        <input
          type="date"
          min={date}
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
        />
      </label>
      {template.kind === 'expense' ? (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={essential}
            onChange={(event) => setEssential(event.target.checked)}
          />{' '}
          Frais essentiel
        </label>
      ) : null}
      <button type="submit">Appliquer aux échéances futures</button>
    </form>
  );
}

function SavingsForm({
  month,
  onChanged,
}: {
  month: string;
  onChanged: () => Promise<void>;
}) {
  const [target, setTarget] = useState('');
  return (
    <form
      className="budget-form compact budget-savings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void upsertBudgetSavingsMonth({
          month,
          targetCents: cents(target),
          reserveTargetMonths: 3,
        }).then(onChanged);
      }}
    >
      <label>
        <span>Objectif du mois</span>
        <input
          required
          inputMode="decimal"
          placeholder="0,00"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
      </label>
      <button type="submit">Enregistrer l’objectif</button>
    </form>
  );
}
