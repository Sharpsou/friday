import { inputQuantity } from './maison-helpers.js';
import { useState } from 'react';
import {
  RecipeDraftSchema,
  type MaisonRecord,
  type Recipe,
  type RecipeDraft,
  type MaisonUnit,
} from '@friday/contracts';
import { saveRecipeDraft } from '../maison-actions.js';
import { MaisonDialog, UnitSelect } from './maison-ui.js';

export function RecipeEditor({
  recipe,
  records,
  initialDraft,
  provenance = 'manual',
  sources = [],
  onClose,
  onChanged,
}: {
  recipe: Recipe | null;
  records: readonly MaisonRecord[];
  initialDraft?: RecipeDraft;
  provenance?: Recipe['provenance'];
  sources?: Recipe['sources'];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(initialDraft?.name ?? recipe?.name ?? '');
  const [portions, setPortions] = useState(
    String(
      (initialDraft?.portionsMilli ?? recipe?.portionsMilli ?? 4000) / 1000,
    ),
  );
  const [duration, setDuration] = useState(
    String(initialDraft?.durationMinutes ?? recipe?.durationMinutes ?? ''),
  );
  const [steps, setSteps] = useState(
    initialDraft?.steps ?? recipe?.steps ?? '',
  );
  const [notes, setNotes] = useState(
    initialDraft?.notes ?? recipe?.notes ?? '',
  );
  const [ingredients, setIngredients] = useState(() =>
    (
      initialDraft?.ingredients ??
      recipe?.ingredients.map((i) => ({
        label:
          records.find((r) => r.id === i.productId && r.kind === 'product')
            ?.kind === 'product'
            ? (
                records.find((r) => r.id === i.productId) as Extract<
                  MaisonRecord,
                  { kind: 'product' }
                >
              ).name
            : '',
        quantity: i.quantity,
        note: i.note,
      })) ??
      []
    ).map((i) => ({
      id: crypto.randomUUID(),
      label: i.label,
      amount: i.quantity ? String(i.quantity.milli / 1000) : '',
      unit: i.quantity?.unit ?? ('g' as MaisonUnit),
      note: i.note,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function update(
    id: string,
    field: 'label' | 'amount' | 'unit' | 'note',
    value: string,
  ) {
    setIngredients((items) =>
      items.map((i) => (i.id === id ? { ...i, [field]: value } : i)),
    );
  }
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const draft = RecipeDraftSchema.parse({
        name,
        portionsMilli: inputQuantity(portions, 'portion')?.milli,
        durationMinutes: duration ? Number(duration) : null,
        steps,
        notes,
        ingredients: ingredients.map((i) => ({
          label: i.label,
          quantity: inputQuantity(i.amount, i.unit),
          note: i.note,
        })),
      });
      await saveRecipeDraft(
        draft,
        recipe,
        recipe && provenance === 'manual' ? recipe.provenance : provenance,
        sources.length ? sources : (recipe?.sources ?? []),
      );
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <MaisonDialog
      title={recipe ? `Modifier ${recipe.name}` : 'Nouvelle recette'}
      onClose={onClose}
    >
      <form
        className="maison-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Nom de la recette
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="maison-form-row">
          <label>
            Portions de référence
            <input
              required
              inputMode="decimal"
              value={portions}
              onChange={(e) => setPortions(e.target.value)}
            />
          </label>
          <label>
            Durée en minutes
            <input
              type="number"
              min="1"
              max="1440"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
        </div>
        <p>
          Les noms exacts proposés relient les ingrédients aux produits de votre
          réserve. Une quantité vide reste à vérifier.
        </p>
        <datalist id="maison-products">
          {records
            .filter((r) => r.kind === 'product' && !r.deletedAt)
            .map((r) => (
              <option key={r.id} value={r.kind === 'product' ? r.name : ''} />
            ))}
        </datalist>
        {ingredients.map((i, index) => (
          <fieldset className="maison-ingredient" key={i.id}>
            <legend>Ingrédient {index + 1}</legend>
            <label>
              Produit
              <input
                required
                list="maison-products"
                value={i.label}
                onChange={(e) => update(i.id, 'label', e.target.value)}
              />
            </label>
            <div className="maison-form-row">
              <label>
                Quantité
                <input
                  inputMode="decimal"
                  value={i.amount}
                  onChange={(e) => update(i.id, 'amount', e.target.value)}
                />
              </label>
              <UnitSelect
                value={i.unit}
                onChange={(v) => update(i.id, 'unit', v)}
              />
            </div>
            <label>
              Précision
              <input
                value={i.note}
                maxLength={240}
                placeholder="Au goût, facultatif…"
                onChange={(e) => update(i.id, 'note', e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setIngredients((items) => items.filter((x) => x.id !== i.id))
              }
            >
              Retirer cet ingrédient
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={ingredients.length >= 60}
          onClick={() =>
            setIngredients((items) => [
              ...items,
              {
                id: crypto.randomUUID(),
                label: '',
                amount: '',
                unit: 'g',
                note: '',
              },
            ])
          }
        >
          + Ingrédient
        </button>
        <label>
          Préparation
          <textarea
            value={steps}
            maxLength={12000}
            onChange={(e) => setSteps(e.target.value)}
            rows={4}
          />
        </label>
        <label>
          Notes
          <textarea
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </label>
        {sources.length ? (
          <p>
            Sources :{' '}
            {sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                {s.title}{' '}
              </a>
            ))}
          </p>
        ) : null}
        {!ingredients.length ? (
          <p>
            Cette recette sera enregistrée avec la mention « ingrédients à
            compléter ».
          </p>
        ) : null}
        {recipe ? (
          <p>
            Une nouvelle version sera créée. Les préparations déjà prévues
            garderont leur version actuelle.
          </p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={busy} type="submit">
          {busy ? 'Enregistrement…' : 'Enregistrer dans les recettes du foyer'}
        </button>
      </form>
    </MaisonDialog>
  );
}
