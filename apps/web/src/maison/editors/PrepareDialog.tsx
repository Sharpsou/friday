import type {
  MaisonRecord,
  MealSlot,
  Preparation,
  StockEntry,
} from '@friday/contracts';
import { parseMilli, quantityLabel } from '@friday/domain';
import { useState } from 'react';
import {
  confirmPreparation,
  defaultPreparationUses,
} from '../../maison-actions.js';
import { MaisonDialog } from '../maison-ui.js';

export function PrepareDialog({
  preparation,
  records,
  today,
  onChanged,
  onClose,
}: {
  preparation: Preparation;
  records: readonly MaisonRecord[];
  today: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [portions, setPortions] = useState(
    String(preparation.portionsMilli / 1000),
  );
  const [immediate, setImmediate] = useState('');
  const [location, setLocation] = useState<StockEntry['location']>('fridge');
  const [uses, setUses] = useState(() =>
    defaultPreparationUses(records, preparation.id, today).map((u) => ({
      ...u,
      amount: String(u.milli / 1000),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stocks = records.filter(
    (r): r is StockEntry =>
      r.kind === 'stock' && !!r.productId && !!r.quantity && !r.deletedAt,
  );
  const meals = records.filter(
    (r): r is MealSlot =>
      r.kind === 'meal' &&
      r.status === 'planned' &&
      !r.deletedAt &&
      r.servings.length === 1 &&
      r.servings[0]?.preparationId === preparation.id,
  );
  async function save() {
    setBusy(true);
    try {
      await confirmPreparation(
        preparation,
        parseMilli(portions),
        uses.map((u) => ({ stockId: u.stockId, milli: parseMilli(u.amount) })),
        immediate || null,
        location,
      );
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Préparation non enregistrée.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <MaisonDialog title="Confirmer la préparation" onClose={onClose}>
      <form
        className="maison-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Portions réellement préparées
          <input
            required
            inputMode="decimal"
            value={portions}
            onChange={(e) => setPortions(e.target.value)}
          />
        </label>
        <p>
          Vérifiez les prélèvements proposés. Les ingrédients non suivis dans
          Réserve ne sont pas déduits.
        </p>
        {uses.map((use, index) => {
          const stock = stocks.find((s) => s.id === use.stockId);
          return (
            <div key={use.stockId} className="maison-form-row">
              <label>
                {stock?.label} · disponible{' '}
                {quantityLabel(stock?.quantity ?? null)}
                <input
                  inputMode="decimal"
                  required
                  value={use.amount}
                  onChange={(e) =>
                    setUses((rows) =>
                      rows.map((r, i) =>
                        i === index ? { ...r, amount: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setUses((rows) => rows.filter((_, i) => i !== index))
                }
              >
                Ne pas déduire
              </button>
            </div>
          );
        })}
        <label>
          Autre réserve utilisée
          <select
            value=""
            onChange={(e) => {
              if (e.target.value)
                setUses((rows) => [
                  ...rows,
                  { stockId: e.target.value, milli: 0, amount: '0' },
                ]);
            }}
          >
            <option value="">Ajouter un prélèvement</option>
            {stocks
              .filter((s) => !uses.some((u) => u.stockId === s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · {quantityLabel(s.quantity)}
                </option>
              ))}
          </select>
        </label>
        <label>
          Déjà mangé maintenant
          <select
            value={immediate}
            onChange={(e) => setImmediate(e.target.value)}
          >
            <option value="">Rien pour le moment</option>
            {meals.map((m) => (
              <option key={m.id} value={m.id}>
                {m.date} · {m.slot === 'lunch' ? 'Midi' : 'Soir'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Conserver les portions restantes dans
          <select
            value={location}
            onChange={(e) =>
              setLocation(e.target.value as StockEntry['location'])
            }
          >
            <option value="fridge">Frigo</option>
            <option value="freezer">Congélateur</option>
          </select>
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={busy}>Confirmer les quantités et les restes</button>
      </form>
    </MaisonDialog>
  );
}
