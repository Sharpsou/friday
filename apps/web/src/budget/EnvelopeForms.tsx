import type { BudgetCategory, BudgetEnvelopeRecord } from '@friday/contracts';
import { useState } from 'react';
import {
  createBudgetEnvelope,
  updateBudgetEnvelope,
} from '../db/budget-repository.js';
import { CATEGORY_LABELS, cents } from './budget-format.js';

export function EnvelopeForm({
  currentProfileId,
  onChanged,
}: {
  currentProfileId: string;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<BudgetCategory>('groceries');
  const [rollover, setRollover] = useState<'carry' | 'reset'>('reset');
  const [personal, setPersonal] = useState(false);
  return (
    <form
      className="budget-form compact"
      onSubmit={(event) => {
        event.preventDefault();
        void createBudgetEnvelope({
          name,
          category,
          monthlyAllocationCents: cents(amount),
          rollover,
          ownerProfileId: personal ? currentProfileId : null,
        }).then(() => {
          setName('');
          setAmount('');
          return onChanged();
        });
      }}
    >
      <label>
        <span>Nom</span>
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <span>Allocation mensuelle</span>
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label>
        <span>Catégorie</span>
        <select
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as BudgetCategory)
          }
        >
          {Object.entries(CATEGORY_LABELS)
            .filter(([value]) => value !== 'fixed')
            .map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
        </select>
      </label>
      <label>
        <span>Report</span>
        <select
          value={rollover}
          onChange={(event) =>
            setRollover(event.target.value as typeof rollover)
          }
        >
          <option value="reset">Repart à zéro</option>
          <option value="carry">Cumulable</option>
        </select>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={personal}
          onChange={(event) => setPersonal(event.target.checked)}
        />{' '}
        Perso & loisirs
      </label>
      <button type="submit">Créer</button>
    </form>
  );
}

export function EnvelopeEditForm({
  envelope,
  currentProfileId,
  otherProfileId,
  profileNames,
  onChanged,
}: {
  envelope: BudgetEnvelopeRecord;
  currentProfileId: string;
  otherProfileId: string | null;
  profileNames: { current: string; other: string };
  onChanged: () => Promise<void>;
}) {
  const initialOwner =
    envelope.ownerProfileId === null
      ? 'household'
      : envelope.ownerProfileId === currentProfileId
        ? 'me'
        : 'other';
  const [name, setName] = useState(envelope.name);
  const [amount, setAmount] = useState(
    String(envelope.monthlyAllocationCents / 100),
  );
  const [category, setCategory] = useState(envelope.category);
  const [rollover, setRollover] = useState(envelope.rollover);
  const [owner, setOwner] = useState<'household' | 'me' | 'other'>(
    initialOwner,
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  return (
    <form
      className="budget-form compact"
      onSubmit={(event) => {
        event.preventDefault();
        const details = event.currentTarget.closest('details');
        setSaving(true);
        setFormError(null);
        const ownerProfileId =
          owner === 'household'
            ? null
            : owner === 'me'
              ? currentProfileId
              : (otherProfileId ?? envelope.ownerProfileId);
        void updateBudgetEnvelope(envelope.id, {
          name,
          category,
          monthlyAllocationCents: cents(amount),
          rollover,
          ownerProfileId,
        })
          .then(async () => {
            details?.removeAttribute('open');
            await onChanged();
          })
          .catch((caught: unknown) => {
            setFormError(
              caught instanceof Error
                ? caught.message
                : "L'enveloppe n'a pas pu être modifiée.",
            );
          })
          .finally(() => setSaving(false));
      }}
    >
      <label>
        <span>Nom</span>
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <span>Allocation mensuelle</span>
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label>
        <span>Catégorie</span>
        <select
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as BudgetCategory)
          }
        >
          {Object.entries(CATEGORY_LABELS)
            .filter(([value]) => value !== 'fixed')
            .map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
        </select>
      </label>
      <label>
        <span>Report</span>
        <select
          value={rollover}
          onChange={(event) =>
            setRollover(event.target.value as typeof rollover)
          }
        >
          <option value="reset" disabled={envelope.kind === 'project'}>
            Repart à zéro
          </option>
          <option value="carry">Cumulable</option>
        </select>
      </label>
      <label>
        <span>Attribution</span>
        <select
          value={owner}
          onChange={(event) => setOwner(event.target.value as typeof owner)}
        >
          <option value="household">Maison</option>
          <option value="me">{profileNames.current}</option>
          <option value="other" disabled={!otherProfileId}>
            {profileNames.other}
          </option>
        </select>
      </label>
      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}
      <button type="submit" disabled={saving}>
        {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
      </button>
    </form>
  );
}
