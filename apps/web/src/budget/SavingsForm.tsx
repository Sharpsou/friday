import { useState } from 'react';
import { upsertBudgetSavingsMonth } from '../db/budget-repository.js';
import { cents } from './budget-format.js';

export function SavingsForm({
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
