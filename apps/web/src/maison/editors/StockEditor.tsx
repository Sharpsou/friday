import type {
  MaisonRecord,
  MaisonUnit,
  Product,
  StockEntry,
} from '@friday/contracts';
import { LOCATION_LABELS } from '@friday/domain';
import { useState } from 'react';
import { maisonFields, saveMaisonCommand } from '../../db/maison-repository.js';
import {
  productForLabel,
  saveStock,
  stockMovement,
} from '../../maison-actions.js';
import { inputQuantity } from '../maison-helpers.js';
import { MaisonDialog, UnitSelect } from '../maison-ui.js';

export function StockEditor({
  stock,
  records,
  onChanged,
  onClose,
}: {
  stock: StockEntry | null;
  records: readonly MaisonRecord[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(stock?.label ?? '');
  const [amount, setAmount] = useState(
    stock?.quantity ? String(stock.quantity.milli / 1000) : '',
  );
  const [unit, setUnit] = useState<MaisonUnit>(
    stock?.quantity?.unit ?? 'piece',
  );
  const [location, setLocation] = useState<StockEntry['location']>(
    stock?.location ?? 'dry',
  );
  const [status, setStatus] = useState<StockEntry['status']>(
    stock?.status ?? 'present',
  );
  const [expiry, setExpiry] = useState(stock?.expiresOn ?? '');
  const [threshold, setThreshold] = useState(
    stock?.threshold ? String(stock.threshold.milli / 1000) : '',
  );
  const [reason, setReason] = useState<'correction' | 'discard' | 'eat'>(
    'correction',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try {
      const all = [...records];
      const product = stock?.preparationId
        ? null
        : stock?.productId
          ? all.find(
              (r): r is Product =>
                r.kind === 'product' && r.id === stock.productId,
            )!
          : await productForLabel(name, all);
      const quantity =
        status === 'empty' ? { unit, milli: 0 } : inputQuantity(amount, unit);
      const next: StockEntry = {
        ...(stock ?? (await maisonFields())),
        kind: 'stock',
        productId: product?.id ?? null,
        preparationId: stock?.preparationId ?? null,
        label: product?.name ?? name,
        quantity,
        location,
        status,
        confirmedAt: new Date().toISOString(),
        expiresOn: expiry || null,
        threshold: inputQuantity(threshold, unit),
      };
      if (product && !records.some((r) => r.id === product.id))
        await saveMaisonCommand([
          product,
          next,
          await stockMovement(next, next, 'initial'),
        ]);
      else await saveStock(next, reason);
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Réserve non enregistrée.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <MaisonDialog
      title={stock ? `Corriger ${stock.label}` : 'Ajouter à la réserve'}
      onClose={onClose}
    >
      <form
        className="maison-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Produit
          <input
            required
            disabled={!!stock}
            list="reserve-products"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <datalist id="reserve-products">
          {records
            .filter((r) => r.kind === 'product' && !r.deletedAt)
            .map((r) => (
              <option key={r.id} value={r.kind === 'product' ? r.name : ''} />
            ))}
        </datalist>
        {!stock ? (
          <p>
            Un nom exact existant reprend le même produit ; un nouveau nom crée
            un produit.
          </p>
        ) : null}
        <label>
          Emplacement
          <select
            value={location}
            onChange={(e) =>
              setLocation(e.target.value as StockEntry['location'])
            }
          >
            {Object.entries(LOCATION_LABELS).map(([id, text]) => (
              <option key={id} value={id}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <div className="maison-form-row">
          <label>
            Quantité restante (facultative)
            <input
              inputMode="decimal"
              value={amount}
              disabled={status === 'empty'}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          {stock?.preparationId ? (
            <span>Portions</span>
          ) : (
            <UnitSelect value={unit} onChange={setUnit} />
          )}
        </div>
        <label>
          État
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StockEntry['status'])}
          >
            <option value="present">Présent</option>
            <option value="low">Faible</option>
            <option value="empty">Épuisé</option>
            <option value="check">À vérifier</option>
          </select>
        </label>
        <div className="maison-form-row">
          <label>
            Date limite (facultative)
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </label>
          {!stock?.preparationId ? (
            <label>
              Seuil « à racheter » (même unité)
              <input
                inputMode="decimal"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </label>
          ) : null}
        </div>
        {stock ? (
          <label>
            Motif
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
            >
              <option value="correction">Corriger le compte</option>
              <option value="discard">Jeté</option>
              <option value="eat">Mangé hors du planning</option>
            </select>
          </label>
        ) : null}
        {stock?.preparationId ? (
          <p>
            Si des repas réclament plus de portions que les restes, ajustez
            d’abord ces repas.
          </p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={busy}>Enregistrer la réserve</button>
      </form>
    </MaisonDialog>
  );
}
