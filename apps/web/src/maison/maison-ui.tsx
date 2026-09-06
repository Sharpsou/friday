import { useEffect, useRef, type ReactNode } from 'react';
import type { MaisonUnit, MaisonRecord, MealSlot } from '@friday/contracts';
import { UNIT_LABELS } from '@friday/domain';
import { mealLabel } from './maison-helpers.js';

export function MaisonDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="maison-dialog"
      aria-label={title}
      onCancel={onClose}
    >
      <div className="settings-heading">
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Fermer">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function UnitSelect({
  value,
  onChange,
  label = 'Unité',
}: {
  value: MaisonUnit;
  onChange: (v: MaisonUnit) => void;
  label?: string;
}) {
  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as MaisonUnit)}
      >
        {Object.entries(UNIT_LABELS).map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
export function MealSummary({
  records,
  date,
  onOpen,
}: {
  records: readonly MaisonRecord[];
  date?: string;
  onOpen: (id: string) => void;
}) {
  const meals = records
    .filter(
      (r): r is MealSlot =>
        r.kind === 'meal' &&
        !r.deletedAt &&
        r.status !== 'cancelled' &&
        (!date || r.date === date),
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || (a.slot === 'lunch' ? -1 : 1),
    );
  return (
    <div className="maison-meal-summary">
      {meals.map((meal) => (
        <button type="button" key={meal.id} onClick={() => onOpen(meal.id)}>
          <span>
            {date ? '' : `${meal.date} · `}
            {meal.slot === 'lunch' ? 'Midi' : 'Soir'}
          </span>
          <strong>{mealLabel(meal, records)}</strong>
          <small>
            {meal.people} personne(s){meal.status === 'eaten' ? ' · Mangé' : ''}
          </small>
        </button>
      ))}
    </div>
  );
}
