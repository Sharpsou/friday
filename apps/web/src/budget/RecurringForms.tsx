import type {
  BudgetCategory,
  BudgetRecurringTemplateRecord,
} from '@friday/contracts';
import { useState } from 'react';
import {
  createBudgetEntry,
  createBudgetRecurringTemplate,
  updateBudgetRecurringTemplate,
} from '../db/budget-repository.js';
import { CATEGORY_LABELS, cents, today } from './budget-format.js';

export function RecurringForm({
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

export function RecurringEditForm({
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
