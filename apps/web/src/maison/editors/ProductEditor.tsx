import type { MaisonUnit, Product } from '@friday/contracts';
import { parseMilli } from '@friday/domain';
import { useState } from 'react';
import { saveMaisonCommand } from '../../db/maison-repository.js';
import { MaisonDialog, UnitSelect } from '../maison-ui.js';

export function ProductEditor({
  product,
  onChanged,
  onClose,
}: {
  product: Product;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [aliases, setAliases] = useState(product.aliases.join(', '));
  const [from, setFrom] = useState<MaisonUnit>('pack');
  const [to, setTo] = useState<MaisonUnit>('piece');
  const [factor, setFactor] = useState('');
  const [conversions, setConversions] = useState(product.conversions);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const next = [...conversions];
      if (factor) {
        if (from === to) throw new Error('Choisissez deux unités différentes.');
        next.push({ from, to, factorMilli: parseMilli(factor) });
      }
      await saveMaisonCommand([
        {
          ...product,
          name,
          aliases: aliases
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          conversions: next,
        },
      ]);
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Produit non enregistré.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <MaisonDialog title={`Produit : ${product.name}`} onClose={onClose}>
      <form
        className="maison-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Nom
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Autres noms (séparés par des virgules)
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </label>
        {conversions.map((c, index) => (
          <p key={index}>
            1 {c.from} = {c.factorMilli / 1000} {c.to}{' '}
            <button
              type="button"
              onClick={() =>
                setConversions((rows) => rows.filter((_, i) => i !== index))
              }
            >
              Retirer
            </button>
          </p>
        ))}
        <p>
          Correspondance explicite pour ce produit, par exemple 1 paquet = 12
          pièces.
        </p>
        <div className="maison-form-row">
          <UnitSelect value={from} onChange={setFrom} label="Une unité de" />
          <label>
            Correspond à
            <input
              inputMode="decimal"
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
            />
          </label>
          <UnitSelect value={to} onChange={setTo} />
        </div>
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={busy}>Enregistrer le produit</button>
      </form>
    </MaisonDialog>
  );
}
