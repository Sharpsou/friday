import { useState } from 'react';
import {
  MaisonRecordSchema,
  type MaisonCommand,
  type MaisonRecord,
} from '@friday/contracts';
import { quantityLabel, displayMilli } from '@friday/domain';
import { acceptMaisonServer } from '../db/maison-repository.js';
import { mealLabel } from './maison-helpers.js';

function describe(
  record: MaisonRecord,
  records: readonly MaisonRecord[],
): string {
  switch (record.kind) {
    case 'product':
      return `Produit : ${record.name}`;
    case 'recipe':
      return `Recette : ${record.name} · version ${record.version} · ${record.ingredients.length} ingrédients`;
    case 'preparation': {
      const recipe = records.find((r) => r.id === record.recipeId);
      return `Préparation : ${recipe?.kind === 'recipe' ? recipe.name : 'recette'} · ${record.date} · ${displayMilli(record.actualPortionsMilli ?? record.portionsMilli)} portions`;
    }
    case 'meal':
      return `Repas : ${record.date} · ${record.slot === 'lunch' ? 'midi' : 'soir'} · ${mealLabel(record, records)}`;
    case 'stock':
      return `Réserve : ${record.label} · ${quantityLabel(record.quantity)}`;
    case 'movement':
      return `Mouvement de réserve : ${quantityLabel(record.before)} → ${quantityLabel(record.after)}`;
    case 'coverage':
      return `Contribution aux courses : ${quantityLabel(record.quantity)}${record.excluded ? ' · exclue' : ''}`;
    case 'receipt':
      return record.ignored ? 'Achat ignoré au rangement' : 'Achat rangé';
  }
}

export function ConflictReview({
  command,
  records,
  disabled,
  onAccept,
}: {
  command: MaisonCommand;
  records: readonly MaisonRecord[];
  disabled: boolean;
  onAccept: (action: () => Promise<void>) => void;
}) {
  const [server, setServer] = useState<MaisonRecord[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  return (
    <details className="panel">
      <summary>
        Un bilan Maison est en conflit — vérifier les changements
      </summary>
      <p>
        Ce bilan n’a pas été appliqué au foyer. Vos changements restent
        conservés sur cet appareil. Reprenez les quantités souhaitées après la
        comparaison.
      </p>
      <ul>
        {command.payload.writes.map(({ record }) => (
          <li key={record.id}>
            <strong>Sur cet appareil : </strong>
            {describe(record, records)}
            {server ? (
              <p>
                <strong>Dans le foyer : </strong>
                {server.some((r) => r.id === record.id && !r.deletedAt)
                  ? describe(
                      server.find((r) => r.id === record.id)!,
                      server,
                    )
                  : 'Absent ou supprimé'}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {command.payload.groceryWrites.length ? (
        <p>
          Courses proposées :{' '}
          {command.payload.groceryWrites
            .map(
              (w) => `${w.label} (${w.quantityText ?? 'quantité à vérifier'})`,
            )
            .join(', ')}
          .
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <button
        disabled={disabled || loading}
        onClick={() => {
          setLoading(true);
          setError('');
          void fetch('/api/sync/maison-snapshot')
            .then(async (response) => {
              if (!response.ok)
                throw new Error('Connexion au foyer nécessaire pour comparer.');
              const body = (await response.json()) as { records: unknown[] };
              setServer(body.records.map((r) => MaisonRecordSchema.parse(r)));
            })
            .catch((e: unknown) =>
              setError(
                e instanceof Error ? e.message : 'Comparaison indisponible.',
              ),
            )
            .finally(() => setLoading(false));
        }}
      >
        Comparer avec le foyer
      </button>
      {server ? (
        <>
          <p>
            Reprendre la version du foyer écarte ce bilan local et les bilans en
            conflit qui lui sont liés. Leur historique chiffré reste conservé.
          </p>
          <button
            disabled={disabled}
            onClick={() => onAccept(() => acceptMaisonServer(command))}
          >
            Reprendre la version du foyer
          </button>
        </>
      ) : null}
    </details>
  );
}
