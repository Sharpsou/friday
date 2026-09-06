import { ConflictReview } from './maison/ConflictReview.js';
import { useEffect, useState, useRef } from 'react';
import type {
  MaisonRecord,
  GroceryItemRecord,
  Recipe,
  Preparation,
  MealSlot,
  StockEntry,
  Product,
  MaisonCommand,
  RecipeDraft,
} from '@friday/contracts';
import {
  latestRecipes,
  LOCATION_LABELS,
  quantityLabel,
  displayMilli,
  restockSuggestions,
  preparationsForPeriod,
} from '@friday/domain';
import { addLocalDays, getTodayLocalDate } from './task-calendar.js';
import { listMaisonConflicts } from './db/maison-repository.js';
import { eatMeal, applyShoppingDecisions } from './maison-actions.js';
import { RecipeEditor } from './maison/RecipeEditor.js';
import { MealEditor, PreparationEditor } from './maison/MealEditor.js';
import {
  StockEditor,
  PurchaseDialog,
  PrepareDialog,
  ProductEditor,
} from './maison/ReserveEditors.js';
import { ShoppingPreview } from './maison/ShoppingPreview.js';
import { PlanSuggestion } from './maison/PlanSuggestion.js';
import { mealLabel } from './maison/maison-helpers.js';
import { copyMealPeriod } from './maison-actions.js';
import { MenuAiPanel } from './maison/MenuAiPanel.js';
import './maison/maison.css';

type Editor =
  | {
      type: 'recipe';
      record: Recipe | null;
      draft?: RecipeDraft;
      provenance?: Recipe['provenance'];
      sources?: Recipe['sources'];
    }
  | { type: 'meal'; record: MealSlot | null }
  | { type: 'stock'; record: StockEntry | null }
  | { type: 'prepare' | 'preparation'; record: Preparation }
  | { type: 'product'; record: Product }
  | { type: 'purchase' | 'shopping' | 'suggest' };
export default function MaisonView({
  tab,
  records,
  groceries,
  onChanged,
  focusMealId,
  available,
}: {
  tab: 'menus' | 'reserve';
  records: readonly MaisonRecord[];
  groceries: readonly GroceryItemRecord[];
  onChanged: () => Promise<void>;
  focusMealId: string | null;
  available: boolean;
}) {
  const lastFocus = useRef<string | null>(null);
  const today = getTodayLocalDate();
  const [view, setView] = useState<'planning' | 'recipes'>('planning');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addLocalDays(today, 6));
  const [slots, setSlots] = useState<MealSlot['slot'][]>(['lunch', 'dinner']);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copyDate, setCopyDate] = useState(addLocalDays(today, 7));
  const [query, setQuery] = useState('');
  const [conflicts, setConflicts] = useState<MaisonCommand[]>([]);
  const active = records.filter((r) => !r.deletedAt);
  const recipes = latestRecipes(records);
  const restockCandidates = restockSuggestions(records);
  const meals = active
    .filter(
      (r): r is MealSlot =>
        r.kind === 'meal' &&
        r.date >= from &&
        r.date <= to &&
        slots.includes(r.slot) &&
        r.status !== 'cancelled',
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || (a.slot === 'lunch' ? -1 : 1),
    );
  const prepIds = preparationsForPeriod(records, from, to, slots);
  const preparations = active.filter(
    (r): r is Preparation =>
      r.kind === 'preparation' &&
      r.status !== 'cancelled' &&
      (prepIds.has(r.id) || (r.date >= from && r.date <= to)),
  );
  useEffect(() => {
    let live = true;
    void listMaisonConflicts()
      .then((value) => {
        if (live) setConflicts(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [records]);
  useEffect(() => {
    if (!focusMealId || lastFocus.current === focusMealId) return;
    const meal = records.find(
      (r): r is MealSlot => r.kind === 'meal' && r.id === focusMealId,
    );
    if (meal) {
      lastFocus.current = focusMealId;
      queueMicrotask(() => {
        setFrom(meal.date);
        setTo(addLocalDays(meal.date, 6));
        setEditor({ type: 'meal', record: meal });
      });
    }
  }, [focusMealId, records]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }
  function open(type: 'shopping' | 'suggest') {
    if (
      !from ||
      !to ||
      from > to ||
      to > addLocalDays(from, 30) ||
      !slots.length
    ) {
      setError('Choisissez une période de 1 à 31 jours et au moins un repas.');
      return;
    }
    setError('');
    setEditor({ type });
  }
  const close = () => setEditor(null);
  return (
    <section
      className="maison-content"
      aria-label={tab === 'menus' ? 'Menus' : 'Réserve'}
    >
      {error ? (
        <p role="alert" className="error-message">
          {error}
        </p>
      ) : null}
      {conflicts.map((command) => (
        <ConflictReview
          key={command.operationId}
          command={command}
          records={records}
          disabled={busy || !available}
          onAccept={(action) => void act(action)}
        />
      ))}
      {tab === 'menus' ? (
        <>
          <div className="maison-toolbar">
            <div className="maison-tabs" aria-label="Vues des menus">
              <button
                aria-pressed={view === 'planning'}
                onClick={() => setView('planning')}
              >
                Planning
              </button>
              <button
                aria-pressed={view === 'recipes'}
                onClick={() => setView('recipes')}
              >
                Recettes ({recipes.length})
              </button>
            </div>
            <button onClick={() => setEditor({ type: 'recipe', record: null })}>
              + Recette
            </button>
          </div>
          {view === 'recipes' ? (
            <>
              <label>
                Rechercher une recette
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="maison-card-grid">
                {recipes
                  .filter((r) =>
                    r.name
                      .toLocaleLowerCase('fr')
                      .includes(query.toLocaleLowerCase('fr')),
                  )
                  .map((r) => (
                    <article className="panel" key={r.id}>
                      <h3>{r.name}</h3>
                      <p>
                        {displayMilli(r.portionsMilli)} portions · version{' '}
                        {r.version}
                        {r.durationMinutes ? ` · ${r.durationMinutes} min` : ''}
                      </p>
                      <p>
                        {r.ingredients.length
                          ? `${r.ingredients.length} ingrédients`
                          : 'Ingrédients à compléter'}{' '}
                        ·{' '}
                        {r.provenance === 'manual'
                          ? 'Recette du foyer'
                          : r.provenance === 'local'
                            ? 'Proposition locale, non vérifiée'
                            : 'Issue d’une recherche Web, validée par vous'}
                      </p>
                      {r.steps ? (
                        <details>
                          <summary>Préparation</summary>
                          <p className="maison-prose">{r.steps}</p>
                        </details>
                      ) : null}
                      <button
                        onClick={() => setEditor({ type: 'recipe', record: r })}
                      >
                        Ouvrir / modifier
                      </button>
                    </article>
                  ))}
              </div>
              {!recipes.length ? (
                <p className="empty-state">
                  Ajoutez les plats que vous cuisinez. Le nom suffit pour
                  commencer ; les ingrédients peuvent venir ensuite.
                </p>
              ) : null}
              <MenuAiPanel
                available={available}
                onDraft={(draft, provenance, sources) =>
                  setEditor({
                    type: 'recipe',
                    record: null,
                    draft,
                    provenance,
                    sources,
                  })
                }
              />
            </>
          ) : (
            <>
              <div className="panel maison-form">
                <div className="maison-form-row">
                  <label>
                    Du
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    Au
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                </div>
                <div className="maison-toolbar">
                  {(['lunch', 'dinner'] as const).map((slot) => (
                    <label className="maison-check" key={slot}>
                      <input
                        type="checkbox"
                        checked={slots.includes(slot)}
                        onChange={(e) =>
                          setSlots((current) =>
                            e.target.checked
                              ? [...current, slot]
                              : current.filter((s) => s !== slot),
                          )
                        }
                      />
                      {slot === 'lunch' ? 'Midi' : 'Soir'}
                    </label>
                  ))}
                </div>
                <div className="maison-toolbar">
                  <button
                    onClick={() => setEditor({ type: 'meal', record: null })}
                  >
                    + Repas
                  </button>
                  <button
                    onClick={() => open('suggest')}
                    disabled={!recipes.some((r) => r.ingredients.length)}
                  >
                    Proposer des menus
                  </button>
                  <button onClick={() => open('shopping')}>
                    Préparer / actualiser les courses
                  </button>
                </div>
                <details>
                  <summary>Réutiliser ce planning</summary>
                  <label>
                    Copier à partir du
                    <input
                      type="date"
                      value={copyDate}
                      onChange={(e) => setCopyDate(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        copyMealPeriod(records, from, to, copyDate),
                      )
                    }
                  >
                    Copier dans les créneaux libres
                  </button>
                </details>
              </div>
              <div className="maison-card-grid">
                {meals.map((meal) => (
                  <article className="panel" key={meal.id}>
                    <span className="eyebrow">
                      {meal.date} · {meal.slot === 'lunch' ? 'Midi' : 'Soir'}
                    </span>
                    <h3>{mealLabel(meal, records)}</h3>
                    <p>
                      {meal.people} personne(s)
                      {meal.status === 'eaten' ? ' · Mangé' : ''}
                    </p>
                    <button
                      onClick={() => setEditor({ type: 'meal', record: meal })}
                    >
                      Ouvrir le repas
                    </button>
                    {meal.status === 'planned' && meal.servings.length ? (
                      <button
                        disabled={busy}
                        onClick={() => void act(() => eatMeal(meal))}
                      >
                        Mangé
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
              {!meals.length ? (
                <p className="empty-state">
                  Aucun repas prévu sur cette période. Choisissez vos recettes
                  ou demandez une proposition.
                </p>
              ) : null}
              {preparations.length ? <h3>Préparations et portions</h3> : null}
              {preparations.map((p) => {
                const r = records.find((r) => r.id === p.recipeId);
                return (
                  <article className="panel maison-toolbar" key={p.id}>
                    <div>
                      <strong>
                        {r?.kind === 'recipe' ? r.name : 'Recette'}
                      </strong>
                      <p>
                        {p.date} ·{' '}
                        {displayMilli(p.actualPortionsMilli ?? p.portionsMilli)}{' '}
                        portions ·{' '}
                        {p.status === 'prepared' ? 'Préparé' : 'À préparer'}
                      </p>
                    </div>
                    {p.status === 'planned' ? (
                      <>
                        <button
                          onClick={() =>
                            setEditor({ type: 'preparation', record: p })
                          }
                        >
                          Ajuster
                        </button>
                        <button
                          onClick={() =>
                            setEditor({ type: 'prepare', record: p })
                          }
                        >
                          Préparé
                        </button>
                      </>
                    ) : (
                      <span>Restes disponibles dans Réserve</span>
                    )}
                  </article>
                );
              })}
            </>
          )}
        </>
      ) : (
        <>
          <div className="maison-toolbar">
            <h2>Réserve</h2>
            <button onClick={() => setEditor({ type: 'stock', record: null })}>
              + Produit en réserve
            </button>
            <button onClick={() => setEditor({ type: 'purchase' })}>
              Ranger les achats
            </button>
          </div>
          <p>
            Les quantités connues aident à préparer les courses. « Présent »
            sans quantité reste à vérifier.
          </p>
          <label>
            Rechercher dans la réserve
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {Object.entries(LOCATION_LABELS).map(([location, label]) => {
            const entries = active.filter(
              (r): r is StockEntry =>
                r.kind === 'stock' &&
                r.location === location &&
                r.label
                  .toLocaleLowerCase('fr')
                  .includes(query.toLocaleLowerCase('fr')),
            );
            return (
              <section key={location}>
                <h3>{label}</h3>
                {!entries.length ? (
                  <p className="empty-state">Rien de renseigné.</p>
                ) : (
                  <div className="maison-card-grid">
                    {entries.map((s) => {
                      const restock = restockCandidates.find(
                        (candidate) => candidate.stock.id === s.id,
                      );
                      const alreadyCovered = active.some(
                        (c) =>
                          c.kind === 'coverage' &&
                          c.productId === s.productId &&
                          c.originKey.startsWith('restock:') &&
                          !c.excluded &&
                          groceries.some(
                            (g) =>
                              g.id === c.groceryItemId &&
                              !g.deletedAt &&
                              (!g.checkedAt ||
                                !active.some(
                                  (receipt) =>
                                    receipt.kind === 'receipt' &&
                                    receipt.groceryItemId === g.id &&
                                    receipt.checkedAt === g.checkedAt,
                                )),
                          ),
                      );
                      return (
                        <article className="panel" key={s.id}>
                          <h4>
                            {s.label}
                            {s.preparationId ? ' · Restes' : ''}
                          </h4>
                          <p>
                            {quantityLabel(s.quantity)} ·{' '}
                            {
                              {
                                present: 'Présent',
                                low: 'Faible',
                                empty: 'Épuisé',
                                check: 'À vérifier',
                              }[s.status]
                            }
                          </p>
                          <small>
                            Confirmé le {s.confirmedAt.slice(0, 10)}
                            {s.expiresOn
                              ? ` · Date indiquée : ${s.expiresOn}${s.expiresOn < today ? ' (dépassée, à vérifier)' : ''}`
                              : ''}
                          </small>
                          <div className="maison-toolbar">
                            <button
                              onClick={() =>
                                setEditor({ type: 'stock', record: s })
                              }
                            >
                              {s.preparationId
                                ? 'Mangé / jeté / corriger'
                                : 'Corriger'}
                            </button>
                            {restock && s.productId ? (
                              <button
                                disabled={busy || alreadyCovered}
                                onClick={() =>
                                  void act(() =>
                                    applyShoppingDecisions(
                                      [
                                        {
                                          originKey: restock.originKey,
                                          productId: s.productId!,
                                          preparationId: null,
                                          ingredientId: null,
                                          label: s.label,
                                          quantity: null,
                                          excluded: false,
                                        },
                                      ],
                                      groceries,
                                    ),
                                  )
                                }
                              >
                                {alreadyCovered
                                  ? 'Déjà dans Courses'
                                  : 'À racheter : ajouter aux courses'}
                              </button>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          <details className="panel">
            <summary>Produits et correspondances d’unités</summary>
            {active
              .filter((r): r is Product => r.kind === 'product')
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => setEditor({ type: 'product', record: p })}
                >
                  {p.name}
                </button>
              ))}
          </details>
          <details className="panel">
            <summary>Historique des mouvements</summary>
            <ul>
              {active
                .filter((r) => r.kind === 'movement')
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 100)
                .map((r) =>
                  r.kind === 'movement' ? (
                    <li key={r.id}>
                      {r.createdAt.slice(0, 10)} ·{' '}
                      {active.find(
                        (s) => s.id === r.stockId && s.kind === 'stock',
                      )?.kind === 'stock'
                        ? (active.find((s) => s.id === r.stockId) as StockEntry)
                            .label
                        : 'Réserve'}{' '}
                      · {r.reason} : {quantityLabel(r.before)} →{' '}
                      {quantityLabel(r.after)}
                    </li>
                  ) : null,
                )}
            </ul>
          </details>
        </>
      )}
      {editor?.type === 'recipe' ? (
        <RecipeEditor
          recipe={editor.record}
          records={records}
          {...(editor.draft ? { initialDraft: editor.draft } : {})}
          {...(editor.provenance ? { provenance: editor.provenance } : {})}
          {...(editor.sources ? { sources: editor.sources } : {})}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
      {editor?.type === 'meal' ? (
        <MealEditor
          meal={editor.record}
          date={from}
          records={records}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
      {editor?.type === 'stock' ? (
        <StockEditor
          stock={editor.record}
          records={records}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
      {editor?.type === 'preparation' ? (
        <PreparationEditor
          preparation={editor.record}
          records={records}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
      {editor?.type === 'prepare' ? (
        <PrepareDialog
          preparation={editor.record}
          records={records}
          today={today}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
      {editor?.type === 'product' ? (
        <ProductEditor
          product={editor.record}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
      {editor?.type === 'purchase' ? (
        <PurchaseDialog
          groceries={groceries}
          records={records}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
      {editor?.type === 'shopping' ? (
        <ShoppingPreview
          groceries={groceries}
          records={records}
          from={from}
          to={to}
          slots={slots}
          today={today}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
      {editor?.type === 'suggest' ? (
        <PlanSuggestion
          records={records}
          from={from}
          to={to}
          slots={slots}
          today={today}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
    </section>
  );
}
