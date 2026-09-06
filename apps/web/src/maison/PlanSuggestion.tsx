import { useState } from 'react';
import type { MaisonRecord, MealSlot, Preparation } from '@friday/contracts';
import { latestRecipes, suggestRecipes } from '@friday/domain';
import { addLocalDays } from '../task-calendar.js';
import { maisonFields, saveMaisonCommand } from '../db/maison-repository.js';
import { MaisonDialog } from './maison-ui.js';

export function PlanSuggestion({
  records,
  from,
  to,
  slots,
  today,
  onChanged,
  onClose,
}: {
  records: readonly MaisonRecord[];
  from: string;
  to: string;
  slots: readonly MealSlot['slot'][];
  today: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const recipes = latestRecipes(records);
  const [rows, setRows] = useState(() => {
    const ranked = suggestRecipes(records, today);
    const result: Array<{
      date: string;
      slot: MealSlot['slot'];
      recipeId: string;
      people: number;
      include: boolean;
    }> = [];
    for (
      let date = from;
      date <= to && result.length < 62;
      date = addLocalDays(date, 1)
    )
      for (const slot of slots) {
        if (
          records.some(
            (r) =>
              r.kind === 'meal' &&
              r.date === date &&
              r.slot === slot &&
              r.status !== 'cancelled' &&
              !r.deletedAt,
          )
        )
          continue;
        result.push({
          date,
          slot,
          recipeId: ranked[result.length % ranked.length]?.id ?? '',
          people: 2,
          include: true,
        });
      }
    return result;
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function apply() {
    setBusy(true);
    try {
      const writes: MaisonRecord[] = [];
      for (const row of rows.filter((r) => r.include)) {
        const p: Preparation = {
          ...(await maisonFields()),
          kind: 'preparation',
          recipeId: row.recipeId,
          date: row.date,
          portionsMilli: row.people * 1000,
          actualPortionsMilli: null,
          status: 'planned',
        };
        writes.push(p, {
          ...(await maisonFields()),
          kind: 'meal',
          date: row.date,
          slot: row.slot,
          people: row.people,
          status: 'planned',
          servings: [{ preparationId: p.id, portionsMilli: row.people * 1000 }],
        });
      }
      if (writes.length) await saveMaisonCommand(writes);
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Planning non enregistré.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <MaisonDialog title="Proposition de menus" onClose={onClose}>
      <form
        className="maison-form"
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
      >
        <p>
          Proposition à partir du catalogue, sans IA. Les repas déjà choisis
          sont préservés. Ajustez les plats et les personnes avant confirmation.
        </p>
        {rows.map((row, index) => (
          <fieldset key={`${row.date}:${row.slot}`}>
            <legend>
              {row.date} · {row.slot === 'lunch' ? 'Midi' : 'Soir'}
            </legend>
            <label className="maison-check">
              <input
                type="checkbox"
                checked={row.include}
                onChange={(e) =>
                  setRows((current) =>
                    current.map((r, i) =>
                      i === index ? { ...r, include: e.target.checked } : r,
                    ),
                  )
                }
              />
              Prévoir ce repas
            </label>
            <label>
              Recette
              <select
                required={row.include}
                value={row.recipeId}
                onChange={(e) =>
                  setRows((current) =>
                    current.map((r, i) =>
                      i === index ? { ...r, recipeId: e.target.value } : r,
                    ),
                  )
                }
              >
                <option value="">Choisir</option>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Personnes
              <input
                type="number"
                min="1"
                max="100"
                value={row.people}
                onChange={(e) =>
                  setRows((current) =>
                    current.map((r, i) =>
                      i === index
                        ? { ...r, people: Number(e.target.value) }
                        : r,
                    ),
                  )
                }
              />
            </label>
          </fieldset>
        ))}
        {!rows.length ? <p>Tous les créneaux sont déjà prévus.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={busy || !rows.some((r) => r.include)}>
          Confirmer le planning
        </button>
      </form>
    </MaisonDialog>
  );
}
