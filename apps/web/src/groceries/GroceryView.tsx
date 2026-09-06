import { type LocalGroceryItem } from '../db/grocery-repository.js';
import { type GroceryAisleGroup } from '../grocery-classification-groups.js';
import { TASK_SYNC_LABELS } from '../tasks/task-sync.js';

export function GroceryView({
  aisleGroups,
  changingItemId,
  editing,
  inputRef,
  label,
  purchasedItems,
  quantity,
  onCheckedChange,
  onDelete,
  onEdit,
  onLabelChange,
  onQuantityChange,
  onSubmit,
}: {
  aisleGroups: readonly GroceryAisleGroup[];
  changingItemId: string | null;
  editing: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  label: string;
  purchasedItems: readonly LocalGroceryItem[];
  quantity: string;
  onCheckedChange: (itemId: string, checked: boolean) => void;
  onDelete: (itemId: string) => void;
  onEdit: (item: LocalGroceryItem) => void;
  onLabelChange: (value: string) => void;
  onQuantityChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <>
      {editing ? (
        <div className="edit-notice" role="status">
          <strong>Mode modification</strong>
          <span>
            Touchez un produit pour modifier son nom, sa quantité ou son rayon.
            Le bouton Supprimer reste disponible directement.
          </span>
        </div>
      ) : (
        <form className="quick-form grocery-form" onSubmit={onSubmit}>
          <label htmlFor="grocery-label">Ajouter un produit</label>
          <div className="grocery-input-row">
            <input
              ref={inputRef}
              id="grocery-label"
              value={label}
              maxLength={200}
              autoComplete="off"
              placeholder="Ex. Lait"
              onChange={(event) => onLabelChange(event.target.value)}
            />
            <input
              aria-label="Quantité facultative"
              value={quantity}
              maxLength={80}
              autoComplete="off"
              placeholder="Quantité (facultatif)"
              onChange={(event) => onQuantityChange(event.target.value)}
            />
            <button type="submit" disabled={!label.trim()}>
              Ajouter
            </button>
          </div>
          <p>Le produit apparaît immédiatement, même hors connexion.</p>
        </form>
      )}

      {aisleGroups.length === 0 ? (
        <section className="panel grocery-panel">
          <p className="empty-state">La liste de courses est vide.</p>
        </section>
      ) : (
        <div className="grocery-aisle-groups" aria-label="Courses par rayon">
          {aisleGroups.map((group) => (
            <section className="panel grocery-panel aisle-panel" key={group.id}>
              <div className="task-section-heading">
                <div>
                  {group.familyLabel ? (
                    <small>{group.familyLabel}</small>
                  ) : null}
                  <h3>{group.label}</h3>
                </div>
                <span className="count-badge">{group.items.length}</span>
              </div>
              <GroceryList
                items={group.items}
                editing={editing}
                changingItemId={changingItemId}
                onDelete={onDelete}
                onEdit={onEdit}
                onCheckedChange={onCheckedChange}
                emptyMessage=""
              />
            </section>
          ))}
        </div>
      )}

      <section
        className="panel grocery-panel purchased-grocery-panel"
        aria-labelledby="grocery-purchased-title"
      >
        <div className="task-section-heading">
          <h3 id="grocery-purchased-title">Déjà acheté</h3>
          <span className="count-badge">{purchasedItems.length}</span>
        </div>
        <GroceryList
          items={purchasedItems}
          editing={editing}
          changingItemId={changingItemId}
          onDelete={onDelete}
          onEdit={onEdit}
          onCheckedChange={onCheckedChange}
          emptyMessage="Aucun produit acheté."
        />
      </section>
    </>
  );
}

function GroceryList({
  items,
  changingItemId,
  editing,
  emptyMessage,
  onCheckedChange,
  onDelete,
  onEdit,
}: {
  items: readonly LocalGroceryItem[];
  changingItemId: string | null;
  editing: boolean;
  emptyMessage: string;
  onCheckedChange: (itemId: string, checked: boolean) => void;
  onDelete: (itemId: string) => void;
  onEdit: (item: LocalGroceryItem) => void;
}) {
  if (items.length === 0) return <p className="empty-state">{emptyMessage}</p>;

  return (
    <ul className="grocery-list">
      {items.map((item) => {
        const checked = item.checkedAt !== null;
        return (
          <li className={checked ? 'is-checked' : ''} key={item.id}>
            {!editing ? (
              <button
                className="grocery-check-button"
                type="button"
                aria-label={`${checked ? 'Remettre' : 'Marquer comme acheté'} ${item.label}`}
                disabled={changingItemId !== null}
                onClick={() => onCheckedChange(item.id, !checked)}
              >
                <span aria-hidden="true">{checked ? '✓' : ''}</span>
              </button>
            ) : null}
            {editing ? (
              <button
                className="item-edit-target grocery-copy"
                type="button"
                aria-label={`Modifier ${item.label}`}
                onClick={() => onEdit(item)}
              >
                <strong>{item.label}</strong>
                {item.quantityText ? <small>{item.quantityText}</small> : null}
                <small className={`task-sync is-${item.syncState}`}>
                  {TASK_SYNC_LABELS[item.syncState]}
                </small>
              </button>
            ) : (
              <span className="grocery-copy">
                <strong>{item.label}</strong>
                {item.quantityText ? <small>{item.quantityText}</small> : null}
                <small className={`task-sync is-${item.syncState}`}>
                  {TASK_SYNC_LABELS[item.syncState]}
                </small>
              </span>
            )}
            {editing ? (
              <button
                className="delete-task-button"
                type="button"
                aria-label={`Supprimer ${item.label}`}
                disabled={changingItemId !== null}
                onClick={() => onDelete(item.id)}
              >
                {changingItemId === item.id ? 'Suppression…' : 'Supprimer'}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
