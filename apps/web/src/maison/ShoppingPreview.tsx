import { inputQuantity } from './maison-helpers.js';
import { useState } from 'react';
import type {
  MaisonRecord,
  GroceryItemRecord,
  ShoppingCoverage,
  MealSlot,
} from '@friday/contracts';
import {
  shoppingNeeds,
  preparationsForPeriod,
  quantityLabel,
  coverageIsProtected,
} from '@friday/domain';
import {
  applyShoppingDecisions,
  canonicalShoppingQuantity,
} from '../maison-actions.js';
import { MaisonDialog } from './maison-ui.js';

export function ShoppingPreview({
  records,
  groceries,
  from,
  to,
  slots,
  today,
  onChanged,
  onClose,
}: {
  records: readonly MaisonRecord[];
  groceries: readonly GroceryItemRecord[];
  from: string;
  to: string;
  slots: readonly MealSlot['slot'][];
  today: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(() => {
    const needs = shoppingNeeds(records, from, to, slots, today);
    const ids = preparationsForPeriod(records, from, to, slots);
    const coverage = records.filter(
      (r): r is ShoppingCoverage => r.kind === 'coverage' && !r.deletedAt,
    );
    const result = needs.map((n) => {
      const old = coverage.find((c) => c.originKey === n.originKey);
      const q = canonicalShoppingQuantity(n.missing);
      return {
        ...n,
        amount: q ? String(q.milli / 1000) : '',
        unit: q?.unit ?? ('piece' as const),
        excluded: old?.excluded ?? false,
        old,
        protected: old ? coverageIsProtected(old, groceries) : false,
        existingGroceryId: '',
        removed: false,
      };
    });
    for (const old of coverage) {
      const p = records.find((r) => r.id === old.preparationId);
      if (
        !old.preparationId ||
        needs.some((n) => n.originKey === old.originKey) ||
        !(
          ids.has(old.preparationId) ||
          (p?.kind === 'preparation' &&
            p.date >= from &&
            p.date <= to &&
            p.status === 'cancelled')
        )
      )
        continue;
      result.push({
        originKey: old.originKey,
        preparationId: old.preparationId,
        ingredientId: old.ingredientId!,
        productId: old.productId,
        label: old.labelSnapshot,
        quantity: old.quantity,
        reserved: 0,
        missing: old.quantity ? { ...old.quantity, milli: 0 } : null,
        note: 'Retiré du planning',
        allocations: [],
        amount: '0',
        unit: old.quantity?.unit ?? 'piece',
        excluded: true,
        old,
        protected: coverageIsProtected(old, groceries),
        existingGroceryId: '',
        removed: true,
      });
    }
    return result;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const prepIds = preparationsForPeriod(records, from, to, slots);
  const incomplete = records
    .filter((r) => r.kind === 'preparation' && prepIds.has(r.id))
    .flatMap((p) =>
      p.kind === 'preparation'
        ? records.filter(
            (r) =>
              r.kind === 'recipe' &&
              r.id === p.recipeId &&
              !r.ingredients.length,
          )
        : [],
    );
  function update(index: number, patch: Partial<(typeof rows)[number]>) {
    setRows((items) =>
      items.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }
  async function apply() {
    setBusy(true);
    try {
      await applyShoppingDecisions(
        rows
          .filter((r) => !r.protected)
          .map((r) => ({
            originKey: r.originKey,
            productId: r.productId,
            preparationId: r.preparationId,
            ingredientId: r.ingredientId,
            label: r.label,
            quantity: inputQuantity(r.amount, r.unit),
            excluded: r.excluded,
            ...(r.existingGroceryId
              ? { existingGroceryId: r.existingGroceryId }
              : {}),
          })),
        groceries,
      );
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bilan non appliqué.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <MaisonDialog title="Vérifier les courses des menus" onClose={onClose}>
      <form
        className="maison-form"
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
      >
        <p>
          {from} → {to}. Les quantités sont calculées par préparation. Vérifiez
          ce qui reste réellement, les achats déjà prévus et les ingrédients non
          quantifiés.
        </p>
        {incomplete.map((r) => (
          <p role="alert" key={r.id}>
            {r.kind === 'recipe' ? r.name : ''} : ingrédients à compléter,
            besoins non calculés.
          </p>
        ))}
        {rows.map((r, index) => (
          <fieldset key={r.originKey}>
            <legend>
              {r.label}
              {r.removed ? ' · retiré du planning' : ''}
            </legend>
            <p>
              Besoin : {quantityLabel(r.quantity)} · Réserve mobilisée :{' '}
              {r.quantity
                ? quantityLabel({ ...r.quantity, milli: r.reserved })
                : 'À vérifier'}{' '}
              · Manque : {quantityLabel(r.missing)}
            </p>
            {r.note ? <small>{r.note}</small> : null}
            {records.some(
              (s) =>
                s.kind === 'stock' &&
                s.productId === r.productId &&
                (!s.quantity || s.status === 'check'),
            ) ? (
              <p>Réserve non quantifiée : vérifiez avant d’acheter.</p>
            ) : null}
            {r.old?.groceryItemId ? (
              <p>
                Déjà couvert par :{' '}
                {groceries.find((g) => g.id === r.old?.groceryItemId)?.label ??
                  'article supprimé'}{' '}
                ·{' '}
                {groceries.find((g) => g.id === r.old?.groceryItemId)
                  ?.quantityText ?? 'quantité à vérifier'}
              </p>
            ) : null}
            {r.protected ? (
              <p>
                Article acheté, modifié, supprimé ou relié manuellement : il est
                conservé. Ajustez directement Courses si nécessaire.
              </p>
            ) : (
              <>
                <label className="maison-check">
                  <input
                    type="checkbox"
                    checked={r.excluded}
                    onChange={(e) =>
                      update(index, { excluded: e.target.checked })
                    }
                  />
                  Exclure ce besoin (choix mémorisé)
                </label>
                {!r.excluded ? (
                  <>
                    <label>
                      Quantité à couvrir ({r.unit})
                      <input
                        inputMode="decimal"
                        placeholder="À vérifier"
                        value={r.amount}
                        onChange={(e) =>
                          update(index, { amount: e.target.value })
                        }
                      />
                    </label>
                    {!r.old?.groceryItemId ? (
                      <label>
                        Ce besoin est déjà couvert par une course
                        <select
                          value={r.existingGroceryId}
                          onChange={(e) =>
                            update(index, { existingGroceryId: e.target.value })
                          }
                        >
                          <option value="">
                            Créer ou actualiser les courses des menus
                          </option>
                          {groceries
                            .filter(
                              (g) =>
                                !g.checkedAt &&
                                !g.deletedAt &&
                                !records.some(
                                  (c) =>
                                    c.kind === 'coverage' &&
                                    c.groceryItemId === g.id,
                                ),
                            )
                            .map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.label} ·{' '}
                                {g.quantityText ?? 'quantité inconnue'}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </fieldset>
        ))}
        {!rows.length ? (
          <p>Aucun ingrédient à ajouter pour cette période.</p>
        ) : null}
        <p>
          La confirmation applique aussi les réductions et exclusions
          présentées. Les produits identiques avec unités compatibles seront
          regroupés.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={busy || !rows.some((r) => !r.protected)}>
          Confirmer les changements de courses
        </button>
      </form>
    </MaisonDialog>
  );
}
