import type {
  GroceryItemRecord,
  MaisonRecord,
  MaisonUnit,
  StockEntry,
} from '@friday/contracts';
import { LOCATION_LABELS } from '@friday/domain';
import { useState } from 'react';
import { receivePurchases } from '../../maison-actions.js';
import { inputQuantity } from '../maison-helpers.js';
import { MaisonDialog, UnitSelect } from '../maison-ui.js';

export function PurchaseDialog({
  groceries,
  records,
  onChanged,
  onClose,
}: {
  groceries: readonly GroceryItemRecord[];
  records: readonly MaisonRecord[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(() =>
    groceries
      .filter(
        (g) =>
          g.checkedAt &&
          !g.deletedAt &&
          !records.some(
            (r) =>
              r.kind === 'receipt' &&
              r.groceryItemId === g.id &&
              r.checkedAt === g.checkedAt,
          ),
      )
      .slice(0, 60)
      .map((item) => {
        const coverage = records.find(
          (r) => r.kind === 'coverage' && r.groceryItemId === item.id,
        );
        // Aggregated grocery text is only a hint; the actual purchased amount is confirmed here.
        return {
          item,
          label: item.label,
          amount: '',
          unit:
            coverage?.kind === 'coverage'
              ? (coverage.quantity?.unit ?? ('piece' as MaisonUnit))
              : ('piece' as MaisonUnit),
          location: 'dry' as StockEntry['location'],
          ignored: false,
        };
      }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function update(index: number, patch: Partial<(typeof rows)[number]>) {
    setRows((current) =>
      current.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }
  async function save() {
    setBusy(true);
    try {
      await receivePurchases(
        rows.map((r) => ({ ...r, quantity: inputQuantity(r.amount, r.unit) })),
      );
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rangement impossible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <MaisonDialog title="Ranger les achats" onClose={onClose}>
      <form
        className="maison-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p>
          Confirmez les quantités réellement achetées. Sans quantité, le produit
          sera simplement « présent ». Les noms exacts reprennent les produits
          existants.
        </p>
        {rows.map((r, index) => (
          <fieldset key={r.item.id}>
            <legend>
              {r.item.label}
              {r.item.quantityText ? ` · prévu : ${r.item.quantityText}` : ''}
            </legend>
            <label className="maison-check">
              <input
                type="checkbox"
                checked={r.ignored}
                onChange={(e) => update(index, { ignored: e.target.checked })}
              />
              Ne pas suivre dans Réserve
            </label>
            {!r.ignored ? (
              <>
                <label>
                  Produit
                  <input
                    required
                    value={r.label}
                    onChange={(e) => update(index, { label: e.target.value })}
                  />
                </label>
                <div className="maison-form-row">
                  <label>
                    Quantité achetée
                    <input
                      inputMode="decimal"
                      value={r.amount}
                      onChange={(e) =>
                        update(index, { amount: e.target.value })
                      }
                    />
                  </label>
                  <UnitSelect
                    value={r.unit}
                    onChange={(unit) => update(index, { unit })}
                  />
                </div>
                <label>
                  Emplacement
                  <select
                    value={r.location}
                    onChange={(e) =>
                      update(index, {
                        location: e.target.value as StockEntry['location'],
                      })
                    }
                  >
                    {Object.entries(LOCATION_LABELS).map(([id, text]) => (
                      <option key={id} value={id}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </fieldset>
        ))}
        {!rows.length ? <p>Aucun nouvel achat à ranger.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={busy || !rows.length}>Confirmer le rangement</button>
      </form>
    </MaisonDialog>
  );
}
