import { useMemo, useState } from 'react';

import {
  GROCERY_TAXONOMY,
  type GroceryClassificationApplyRequest,
  type GroceryClassificationJob,
} from '@friday/contracts';

import type { LocalGroceryItem } from './db/grocery-repository.js';

export function GroceryClassificationIndicator({
  busy,
  job,
  onDismiss,
  onOpen,
  onRetry,
  onStop,
}: {
  busy: boolean;
  job: GroceryClassificationJob;
  onDismiss: () => void;
  onOpen: () => void;
  onRetry: () => void;
  onStop: () => void;
}) {
  const active = ['queued', 'running', 'cancelling'].includes(job.status);
  const label =
    job.status === 'queued'
      ? 'Classement en arrière-plan · en attente'
      : job.status === 'running'
        ? `Classement en arrière-plan · ${job.progress.completed.toString()}/${job.progress.total.toString()}`
        : job.status === 'cancelling'
          ? 'Arrêt du classement en cours…'
          : job.status === 'completed'
            ? 'Classement prêt'
            : job.status === 'cancelled'
              ? 'Classement interrompu'
              : 'Le classement a échoué';

  return (
    <aside
      className={`background-job-indicator ${active ? 'is-active' : ''}`}
      aria-live="polite"
    >
      <span className="background-job-dot" aria-hidden="true" />
      <span className="background-job-copy">
        <strong>{label}</strong>
        {job.status === 'failed' && job.error ? (
          <small>{job.error.message}</small>
        ) : null}
      </span>
      {job.status === 'queued' || job.status === 'running' ? (
        <button type="button" disabled={busy} onClick={onStop}>
          Arrêter
        </button>
      ) : job.status === 'completed' ? (
        <button type="button" disabled={busy} onClick={onOpen}>
          Voir
        </button>
      ) : job.status === 'failed' || job.status === 'cancelled' ? (
        <>
          <button type="button" disabled={busy} onClick={onRetry}>
            Relancer
          </button>
          <button
            className="job-dismiss-button"
            type="button"
            aria-label="Masquer l’indicateur"
            onClick={onDismiss}
          >
            ×
          </button>
        </>
      ) : null}
    </aside>
  );
}

export function GroceryClassificationDialog({
  busy,
  items,
  job,
  onApply,
  onClose,
  onDiscard,
}: {
  busy: boolean;
  items: readonly LocalGroceryItem[];
  job: GroceryClassificationJob;
  onApply: (
    classifications: GroceryClassificationApplyRequest['classifications'],
  ) => void;
  onClose: () => void;
  onDiscard: () => void;
}) {
  const proposal = useMemo(() => job.proposal ?? [], [job.proposal]);
  const [draft, setDraft] = useState(
    () =>
      new Map(
        proposal.map((item) => [
          item.itemId,
          {
            storeFamilyId: item.storeFamilyId,
            aisleId: item.aisleId,
          },
        ]),
      ),
  );
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const applicable = proposal.filter((item) => {
    const current = itemsById.get(item.itemId);
    return (
      current &&
      current.checkedAt === null &&
      current.deletedAt === null &&
      current.revision === item.groceryRevision &&
      current.label === item.label
    );
  });
  const staleCount = proposal.length - applicable.length;

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <section
        className="settings-dialog classification-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="classification-preview-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-heading">
          <div>
            <span className="eyebrow">Proposition locale</span>
            <h2 id="classification-preview-title">Vérifier les rayons</h2>
          </div>
          <button type="button" aria-label="Fermer" onClick={onClose}>
            ×
          </button>
        </div>
        <p>
          Seuls les nouveaux produits sans rayon sont proposés. Corrigez si
          besoin : les corrections seront retenues pour les prochains produits
          portant le même nom.
        </p>
        {staleCount > 0 ? (
          <p className="classification-stale-notice" role="status">
            {staleCount} produit{staleCount > 1 ? 's ont' : ' a'} changé pendant
            le classement et {staleCount > 1 ? 'seront ignorés' : 'sera ignoré'}
            .
          </p>
        ) : null}
        <ul className="classification-preview-list">
          {applicable.map((item) => {
            const choice = draft.get(item.itemId);
            const family =
              GROCERY_TAXONOMY.find(
                (candidate) => candidate.id === choice?.storeFamilyId,
              ) ?? GROCERY_TAXONOMY.at(-1)!;
            return (
              <li key={item.itemId}>
                <strong>{item.label}</strong>
                <label>
                  <span>Type de magasin</span>
                  <select
                    value={family.id}
                    onChange={(event) => {
                      const nextFamily = GROCERY_TAXONOMY.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      if (!nextFamily) return;
                      setDraft((current) => {
                        const next = new Map(current);
                        next.set(item.itemId, {
                          storeFamilyId: nextFamily.id,
                          aisleId: nextFamily.aisles[0][0],
                        });
                        return next;
                      });
                    }}
                  >
                    {GROCERY_TAXONOMY.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Rayon</span>
                  <select
                    value={choice?.aisleId ?? family.aisles[0][0]}
                    onChange={(event) => {
                      setDraft((current) => {
                        const next = new Map(current);
                        next.set(item.itemId, {
                          storeFamilyId: family.id,
                          aisleId: event.target.value,
                        });
                        return next;
                      });
                    }}
                  >
                    {family.aisles.map(([aisleId, aisleLabel]) => (
                      <option key={aisleId} value={aisleId}>
                        {aisleLabel}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="settings-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={onDiscard}
          >
            Conserver le classement actuel
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={busy || applicable.length === 0}
            onClick={() =>
              onApply(
                applicable.flatMap((item) => {
                  const choice = draft.get(item.itemId);
                  return choice
                    ? [
                        {
                          itemId: item.itemId,
                          expectedClassificationRevision:
                            item.expectedClassificationRevision,
                          ...choice,
                        },
                      ]
                    : [];
                }),
              )
            }
          >
            {busy ? 'Application…' : 'Appliquer'}
          </button>
        </div>
      </section>
    </div>
  );
}
