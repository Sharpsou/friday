import { useState } from 'react';
import type {
  MaisonRecord,
  MealSlot,
  Preparation,
  Recipe,
} from '@friday/contracts';
import { latestRecipes, parseMilli, displayMilli } from '@friday/domain';
import { maisonFields, saveMaisonCommand } from '../db/maison-repository.js';
import { MaisonDialog } from './maison-ui.js';

export function MealEditor({
  meal,
  date: initialDate,
  records,
  onChanged,
  onClose,
}: {
  meal: MealSlot | null;
  date: string;
  records: readonly MaisonRecord[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(meal?.date ?? initialDate);
  const [slot, setSlot] = useState<MealSlot['slot']>(meal?.slot ?? 'dinner');
  const [people, setPeople] = useState(String(meal?.people ?? 2));
  const [outside, setOutside] = useState(meal?.status === 'outside');
  const [rows, setRows] = useState(
    () =>
      meal?.servings.map((s) => ({
        id: crypto.randomUUID(),
        existing: s.preparationId,
        recipeId: '',
        date: meal.date,
        prepared: '',
        serving: String(s.portionsMilli / 1000),
      })) ?? [],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const recipes = latestRecipes(records);
  const preparations = records.filter(
    (r): r is Preparation =>
      r.kind === 'preparation' && !r.deletedAt && r.status !== 'cancelled',
  );
  function update(
    id: string,
    field: 'existing' | 'recipeId' | 'date' | 'prepared' | 'serving',
    value: string,
  ) {
    setRows((current) =>
      current.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );
  }
  async function save(cancel = false) {
    setBusy(true);
    setError('');
    try {
      const writes: MaisonRecord[] = [];
      const servings: MealSlot['servings'] = [];
      if (!outside && !cancel)
        for (const row of rows) {
          let id = row.existing;
          if (!id) {
            const p: Preparation = {
              ...(await maisonFields()),
              kind: 'preparation',
              recipeId: row.recipeId,
              date: row.date,
              portionsMilli: parseMilli(row.prepared || people),
              actualPortionsMilli: null,
              status: 'planned',
            };
            id = p.id;
            writes.push(p);
          }
          servings.push({
            preparationId: id,
            portionsMilli: parseMilli(row.serving || people),
          });
        }
      const next: MealSlot = {
        ...(meal ?? (await maisonFields())),
        kind: 'meal',
        date,
        slot,
        people: Number(people),
        status: cancel ? 'cancelled' : outside ? 'outside' : 'planned',
        servings,
      };
      writes.push(next);
      await saveMaisonCommand(writes);
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Repas non enregistré.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <MaisonDialog
      title={meal ? 'Modifier le repas' : 'Prévoir un repas'}
      onClose={onClose}
    >
      <form
        className="maison-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="maison-form-row">
          <label>
            Date
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Repas
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value as MealSlot['slot'])}
            >
              <option value="lunch">Midi</option>
              <option value="dinner">Soir</option>
            </select>
          </label>
          <label>
            Personnes
            <input
              type="number"
              min="1"
              max="100"
              required
              value={people}
              onChange={(e) => setPeople(e.target.value)}
            />
          </label>
        </div>
        <label className="maison-check">
          <input
            type="checkbox"
            checked={outside}
            onChange={(e) => setOutside(e.target.checked)}
          />
          Repas extérieur
        </label>
        {!outside ? (
          <>
            {rows.map((row, index) => (
              <fieldset key={row.id}>
                <legend>Plat {index + 1}</legend>
                <label>
                  Préparation
                  <select
                    value={row.existing}
                    onChange={(e) => update(row.id, 'existing', e.target.value)}
                  >
                    <option value="">Cuisiner une nouvelle préparation</option>
                    {preparations.map((p) => {
                      const r = records.find((r) => r.id === p.recipeId) as
                        Recipe | undefined;
                      return (
                        <option key={p.id} value={p.id}>
                          {r?.name} · {p.date} ·{' '}
                          {displayMilli(
                            p.actualPortionsMilli ?? p.portionsMilli,
                          )}{' '}
                          portions{' '}
                          {p.status === 'prepared' ? '(préparé)' : '(prévu)'}
                        </option>
                      );
                    })}
                  </select>
                </label>
                {!row.existing ? (
                  <>
                    <label>
                      Recette
                      <select
                        required
                        value={row.recipeId}
                        onChange={(e) =>
                          update(row.id, 'recipeId', e.target.value)
                        }
                      >
                        <option value="">Choisir une recette</option>
                        {recipes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                            {r.ingredients.length
                              ? ''
                              : ' · ingrédients à compléter'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="maison-form-row">
                      <label>
                        À préparer le
                        <input
                          required
                          type="date"
                          value={row.date}
                          onChange={(e) =>
                            update(row.id, 'date', e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Total à préparer (portions)
                        <input
                          inputMode="decimal"
                          placeholder={people}
                          value={row.prepared}
                          onChange={(e) =>
                            update(row.id, 'prepared', e.target.value)
                          }
                        />
                      </label>
                    </div>
                  </>
                ) : null}
                <label>
                  Portions pour ce repas
                  <input
                    inputMode="decimal"
                    placeholder={people}
                    value={row.serving}
                    onChange={(e) => update(row.id, 'serving', e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setRows((current) => current.filter((r) => r.id !== row.id))
                  }
                >
                  Retirer ce plat
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              onClick={() =>
                setRows((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    existing: '',
                    recipeId: '',
                    date,
                    prepared: people,
                    serving: people,
                  },
                ])
              }
            >
              + Plat ou restes
            </button>
          </>
        ) : null}
        {!rows.length && !outside ? (
          <p>Ce créneau restera à compléter.</p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || meal?.status === 'eaten'}>
          Enregistrer le repas
        </button>
        {meal?.status === 'eaten' ? (
          <p>Repas déjà consommé. Les corrections se font dans Réserve.</p>
        ) : meal ? (
          <button type="button" disabled={busy} onClick={() => void save(true)}>
            Annuler ce repas
          </button>
        ) : null}
      </form>
    </MaisonDialog>
  );
}

export function PreparationEditor({
  preparation,
  records,
  onChanged,
  onClose,
}: {
  preparation: Preparation;
  records: readonly MaisonRecord[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(preparation.date);
  const [portions, setPortions] = useState(
    String(preparation.portionsMilli / 1000),
  );
  const [recipeId, setRecipeId] = useState(preparation.recipeId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(cancel = false) {
    setBusy(true);
    try {
      await saveMaisonCommand([
        {
          ...preparation,
          date,
          portionsMilli: parseMilli(portions),
          recipeId,
          status: cancel ? 'cancelled' : preparation.status,
        },
      ]);
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Modification impossible.');
    } finally {
      setBusy(false);
    }
  }
  const recipes = records.filter(
    (r): r is Recipe => r.kind === 'recipe' && !r.deletedAt,
  );
  return (
    <MaisonDialog title="Ajuster la préparation" onClose={onClose}>
      <form
        className="maison-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Version de recette
          <select
            value={recipeId}
            onChange={(e) => setRecipeId(e.target.value)}
          >
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · version {r.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Portions à préparer
          <input
            required
            inputMode="decimal"
            value={portions}
            onChange={(e) => setPortions(e.target.value)}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={busy}>Enregistrer la préparation</button>
        <button type="button" disabled={busy} onClick={() => void save(true)}>
          Annuler la préparation
        </button>
      </form>
    </MaisonDialog>
  );
}
