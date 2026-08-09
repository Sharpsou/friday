import { useState } from 'react';

import {
  GROCERY_TAXONOMY,
  type GroceryClassificationRecord,
} from '@friday/contracts';

import type { LocalGroceryItem } from './db/grocery-repository.js';
import type { LocalTask, UpdateLocalTaskInput } from './db/task-repository.js';
import { getAssigneeProfileId, type AssigneeChoice } from './task-assignee.js';

interface DialogChromeProps {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}

function DialogChrome({ children, onClose, title }: DialogChromeProps) {
  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="settings-dialog item-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-heading">
          <h2>{title}</h2>
          <button type="button" aria-label="Fermer" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function TaskEditorDialog({
  assigneeChoices,
  busy,
  onClose,
  onSave,
  task,
}: {
  assigneeChoices: readonly { label: string; value: AssigneeChoice }[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: UpdateLocalTaskInput, scope: 'occurrence' | 'series') => void;
  task: LocalTask;
}) {
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task.dueTime ?? '');
  const [durationMinutes, setDurationMinutes] = useState(
    task.durationMinutes?.toString() ?? '',
  );
  const [assignee, setAssignee] = useState<AssigneeChoice>(
    task.assigneeProfileId === null
      ? 'unassigned'
      : task.assigneeProfileId === getAssigneeProfileId('current')
        ? 'current'
        : 'other',
  );
  const [note, setNote] = useState(task.note ?? '');
  const [scope, setScope] = useState<'occurrence' | 'series'>('occurrence');
  const recurring = task.recurrence !== null;

  return (
    <DialogChrome title={`Modifier ${task.title}`} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(
            {
              assigneeProfileId: getAssigneeProfileId(assignee),
              title,
              dueDate: dueDate || null,
              dueTime: dueDate && dueTime ? dueTime : null,
              durationMinutes:
                dueDate && dueTime && durationMinutes
                  ? Number(durationMinutes)
                  : null,
              note,
            },
            scope,
          );
        }}
      >
        <div className="editor-grid">
          <label>
            <span>Titre</span>
            <input
              value={title}
              maxLength={200}
              required
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>Date</span>
            <input
              type="date"
              value={dueDate}
              required={recurring}
              onChange={(event) => {
                setDueDate(event.target.value);
                if (!event.target.value) {
                  setDueTime('');
                  setDurationMinutes('');
                }
              }}
            />
          </label>
          <label>
            <span>Heure</span>
            <input
              type="time"
              value={dueTime}
              disabled={!dueDate}
              onChange={(event) => {
                setDueTime(event.target.value);
                if (!event.target.value) setDurationMinutes('');
              }}
            />
          </label>
          <label>
            <span>Durée</span>
            <select
              value={durationMinutes}
              disabled={!dueDate || !dueTime}
              onChange={(event) => setDurationMinutes(event.target.value)}
            >
              <option value="">Sans durée</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">1 h</option>
              <option value="90">1 h 30</option>
              <option value="120">2 h</option>
            </select>
          </label>
          <label>
            <span>Responsable</span>
            <select
              value={assignee}
              onChange={(event) =>
                setAssignee(event.target.value as AssigneeChoice)
              }
            >
              {assigneeChoices.map((choice) => (
                <option value={choice.value} key={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label className="editor-note-field">
            <span>Note</span>
            <textarea
              value={note}
              maxLength={2000}
              rows={4}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>

        {recurring ? (
          <fieldset className="editor-scope">
            <legend>Appliquer à</legend>
            <label>
              <input
                type="radio"
                name="task-edit-scope"
                checked={scope === 'occurrence'}
                onChange={() => setScope('occurrence')}
              />
              Cette occurrence
            </label>
            <label>
              <input
                type="radio"
                name="task-edit-scope"
                checked={scope === 'series'}
                onChange={() => setScope('series')}
              />
              Toute la série
            </label>
          </fieldset>
        ) : null}

        <div className="settings-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" disabled={busy || !title.trim()}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </DialogChrome>
  );
}

export function GroceryEditorDialog({
  automaticClassification,
  busy,
  item,
  onClose,
  onSave,
}: {
  automaticClassification: GroceryClassificationRecord | null;
  busy: boolean;
  item: LocalGroceryItem;
  onClose: () => void;
  onSave: (input: {
    aisleId: string | null;
    label: string;
    quantityText: string;
    storeFamilyId: string | null;
  }) => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [quantityText, setQuantityText] = useState(item.quantityText ?? '');
  const initialCategory =
    item.manualStoreFamilyId && item.manualAisleId
      ? `${item.manualStoreFamilyId}:${item.manualAisleId}`
      : '';
  const [category, setCategory] = useState(initialCategory);

  return (
    <DialogChrome title={`Modifier ${item.label}`} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const separator = category.indexOf(':');
          onSave({
            label,
            quantityText,
            storeFamilyId: separator < 0 ? null : category.slice(0, separator),
            aisleId: separator < 0 ? null : category.slice(separator + 1),
          });
        }}
      >
        <div className="editor-grid">
          <label>
            <span>Produit</span>
            <input
              value={label}
              maxLength={200}
              required
              autoFocus
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label>
            <span>Quantité</span>
            <input
              value={quantityText}
              maxLength={80}
              onChange={(event) => setQuantityText(event.target.value)}
            />
          </label>
          <label className="editor-category-field">
            <span>Rayon</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">
                {automaticClassification
                  ? 'Conserver le classement automatique'
                  : 'À classer automatiquement'}
              </option>
              {GROCERY_TAXONOMY.map((family) => (
                <optgroup label={family.label} key={family.id}>
                  {family.aisles.map(([aisleId, aisleLabel]) => (
                    <option
                      value={`${family.id}:${aisleId}`}
                      key={`${family.id}:${aisleId}`}
                    >
                      {aisleLabel}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <p className="editor-help">
          Un rayon choisi ici est prioritaire et se synchronise avec le foyer,
          même si la modification a été faite hors ligne.
        </p>
        <div className="settings-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" disabled={busy || !label.trim()}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </DialogChrome>
  );
}
