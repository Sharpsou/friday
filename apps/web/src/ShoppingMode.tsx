import { useEffect } from 'react';

import type { LocalGroceryItem } from './db/grocery-repository.js';
import type { GroceryAisleGroup } from './grocery-classification-groups.js';

export function ShoppingMode({
  changingItemId,
  groups,
  initialItemCount,
  onCheck,
  onClose,
}: {
  changingItemId: string | null;
  groups: readonly GroceryAisleGroup[];
  initialItemCount: number;
  onCheck: (item: LocalGroceryItem) => void;
  onClose: () => void;
}) {
  const remainingCount = groups.reduce(
    (total, group) => total + group.items.length,
    0,
  );
  const completedCount = Math.max(0, initialItemCount - remainingCount);
  const progress =
    initialItemCount === 0
      ? 100
      : Math.round((completedCount / initialItemCount) * 100);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return (
    <section
      className="shopping-mode"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shopping-mode-title"
    >
      <header className="shopping-mode-header">
        <div>
          <span className="eyebrow">Mode magasin</span>
          <h2 id="shopping-mode-title">En course</h2>
        </div>
        <button type="button" onClick={onClose}>
          Quitter
        </button>
      </header>

      <div className="shopping-progress" aria-live="polite">
        <div>
          <strong>{remainingCount}</strong>
          <span>
            produit{remainingCount > 1 ? 's' : ''} restant
            {remainingCount > 1 ? 's' : ''}
          </span>
        </div>
        <div
          className="shopping-progress-track"
          role="progressbar"
          aria-label="Progression des courses"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      {remainingCount === 0 ? (
        <div className="shopping-complete">
          <span aria-hidden="true">✓</span>
          <h3>Courses terminées</h3>
          <p>Tous les produits de la liste sont cochés.</p>
          <button type="button" onClick={onClose}>
            Revenir à Friday
          </button>
        </div>
      ) : (
        <div className="shopping-groups">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`shopping-${group.id}`}>
              <div className="shopping-group-heading">
                <div>
                  {group.familyLabel ? (
                    <small>{group.familyLabel}</small>
                  ) : null}
                  <h3 id={`shopping-${group.id}`}>{group.label}</h3>
                </div>
                <span>{group.items.length}</span>
              </div>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={changingItemId !== null}
                      aria-label={`Prendre ${item.label}`}
                      onClick={() => onCheck(item)}
                    >
                      <span className="shopping-checkbox" aria-hidden="true" />
                      <span className="shopping-item-copy">
                        <strong>{item.label}</strong>
                        {item.quantityText ? (
                          <small>{item.quantityText}</small>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
