import type { Watch, WatchDiscovery } from '@friday/contracts';
import { useState } from 'react';
import {
  addDiscoveredWatchSources,
  discoverWatchSources,
} from '../sync/watch-client.js';

export function SourceExpansion({
  busy,
  onBusy,
  onChanged,
  watch,
}: {
  busy: boolean;
  onBusy: (action: () => Promise<void>) => Promise<boolean>;
  onChanged: () => Promise<void>;
  watch: Watch;
}) {
  const [discovery, setDiscovery] = useState<WatchDiscovery | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  if (!discovery)
    return (
      <div className="watch-source-addition">
        <button
          className="watch-source-search-button"
          type="button"
          disabled={busy}
          onClick={() =>
            void onBusy(async () => {
              const result = await discoverWatchSources({
                name: watch.name,
                question: watch.question,
                includeKeywords: watch.includeKeywords,
                excludeKeywords: watch.excludeKeywords,
                languages: watch.languages,
              });
              setDiscovery(result);
              setFeedback(null);
              setSelected(
                new Set(
                  result.candidates.flatMap((candidate) =>
                    candidate.status === 'validated' && candidate.feedUrl
                      ? [candidate.id]
                      : [],
                  ),
                ),
              );
            })
          }
        >
          Rechercher d’autres sources
        </button>
        {feedback ? (
          <p className="watch-source-feedback" role="status">
            {feedback}
          </p>
        ) : null}
      </div>
    );
  const candidates = discovery.candidates.filter(
    (candidate) => candidate.status === 'validated' && candidate.feedUrl,
  );
  return (
    <div className="watch-source-expansion">
      <p>
        {discovery.examinedCount} sites examinés · {discovery.validatedCount}{' '}
        flux validés
      </p>
      {candidates.map((candidate) => (
        <label key={candidate.id}>
          <input
            type="checkbox"
            checked={selected.has(candidate.id)}
            onChange={() =>
              setSelected((current) => {
                const next = new Set(current);
                if (next.has(candidate.id)) next.delete(candidate.id);
                else next.add(candidate.id);
                return next;
              })
            }
          />
          <span>{candidate.title}</span>
        </label>
      ))}
      <div className="watch-actions">
        <button
          type="button"
          onClick={() => {
            setDiscovery(null);
            setFeedback(null);
          }}
        >
          Annuler
        </button>
        <button
          className="primary-action"
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() =>
            void (async () => {
              setFeedback(null);
              const succeeded = await onBusy(async () => {
                const result = await addDiscoveredWatchSources(
                  watch.id,
                  discovery.id,
                  [...selected],
                );
                setDiscovery(null);
                setFeedback(
                  result.addedCount > 0
                    ? `${result.addedCount.toString()} source${result.addedCount > 1 ? 's ajoutées' : ' ajoutée'}.`
                    : 'Ces sources étaient déjà suivies.',
                );
                await onChanged();
              });
              if (!succeeded)
                setFeedback(
                  'Ajout impossible. Les sources existantes sont conservées.',
                );
            })()
          }
        >
          Ajouter les sources
        </button>
      </div>
    </div>
  );
}
