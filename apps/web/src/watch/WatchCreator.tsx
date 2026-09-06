import type { WatchCreateRequest, WatchDiscovery } from '@friday/contracts';
import { useState, type FormEvent } from 'react';
import {
  createWatch,
  discoverWatchSources,
  validateWatchSource,
  type WatchSourceInput,
} from '../sync/watch-client.js';
import { sourceKindLabel, splitKeywords } from './watch-format.js';

export function WatchCreator({
  busy,
  onBusy,
  onCancel,
  onComplete,
  onError,
}: {
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onCancel: () => void;
  onComplete: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [question, setQuestion] = useState('');
  const [includes, setIncludes] = useState('');
  const [excludes, setExcludes] = useState('');
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('daily');
  const [weekday, setWeekday] = useState(1);
  const [localTime, setLocalTime] = useState('07:30');
  const [discovery, setDiscovery] = useState<WatchDiscovery | null>(null);
  const [selectedFeeds, setSelectedFeeds] = useState<Set<string>>(new Set());
  const [manualUrl, setManualUrl] = useState('');
  const [manualSources, setManualSources] = useState<WatchSourceInput[]>([]);

  const run = async (action: () => Promise<void>) => {
    onBusy(true);
    onError(null);
    try {
      await action();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Action impossible.');
    } finally {
      onBusy(false);
    }
  };

  const discover = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await discoverWatchSources({
        name,
        question,
        includeKeywords: splitKeywords(includes),
        excludeKeywords: splitKeywords(excludes),
        languages: ['fr', 'en'],
      });
      setDiscovery(result);
      setSelectedFeeds(
        new Set(
          result.candidates.flatMap((candidate) =>
            candidate.status === 'validated' && candidate.feedUrl
              ? [candidate.feedUrl]
              : [],
          ),
        ),
      );
    });
  };

  const activate = () =>
    void run(async () => {
      if (!discovery) return;
      const discoveredSources = discovery.candidates.flatMap((candidate) =>
        candidate.feedUrl && selectedFeeds.has(candidate.feedUrl)
          ? [
              {
                title: candidate.title,
                siteUrl: candidate.siteUrl,
                feedUrl: candidate.feedUrl,
              },
            ]
          : [],
      );
      const sources = [...discoveredSources, ...manualSources]
        .filter(
          (source, index, all) =>
            all.findIndex((item) => item.feedUrl === source.feedUrl) === index,
        )
        .slice(0, 15);
      if (sources.length === 0)
        throw new Error('Sélectionnez au moins une source validée.');
      const payload: WatchCreateRequest = {
        name,
        question,
        includeKeywords: splitKeywords(includes),
        excludeKeywords: splitKeywords(excludes),
        concepts: discovery.concepts,
        themes: discovery.themes,
        languages: ['fr', 'en'],
        cadence,
        localTime,
        weekday: cadence === 'weekly' ? weekday : null,
        timeZone: 'Europe/Paris',
        sources,
      };
      await createWatch(payload);
      await onComplete();
    });

  if (discovery)
    return (
      <section className="watch-creator">
        <div className="panel watch-discovery-summary">
          <span className="eyebrow">Sources proposées</span>
          <h3>{name}</h3>
          <p>
            {discovery.examinedCount} sites examinés ·{' '}
            {discovery.validatedCount} flux validés · {discovery.creditsUsed}{' '}
            crédit(s) Tavily
          </p>
          <strong>Thèmes proposés</strong>
          <div className="watch-concept-chips">
            {discovery.themes.map((theme) => (
              <span key={theme.title}>{theme.title}</span>
            ))}
          </div>
        </div>
        <div className="watch-source-preview">
          {discovery.candidates
            .filter((candidate) => candidate.status === 'validated')
            .map((candidate) => (
              <label className="panel" key={candidate.id}>
                <input
                  type="checkbox"
                  checked={Boolean(
                    candidate.feedUrl && selectedFeeds.has(candidate.feedUrl),
                  )}
                  onChange={() => {
                    if (!candidate.feedUrl) return;
                    setSelectedFeeds((current) => {
                      const next = new Set(current);
                      if (next.has(candidate.feedUrl!))
                        next.delete(candidate.feedUrl!);
                      else next.add(candidate.feedUrl!);
                      return next;
                    });
                  }}
                />
                <span>
                  <strong>{candidate.title}</strong>
                  <small>
                    {sourceKindLabel(candidate.kind)} · {candidate.reason}
                  </small>
                </span>
              </label>
            ))}
        </div>
        <details className="panel watch-disclosure">
          <summary>
            Sites sans flux exploitable (
            {
              discovery.candidates.filter(
                (candidate) => candidate.status === 'rejected',
              ).length
            }
            )
          </summary>
          <ul>
            {discovery.candidates
              .filter((candidate) => candidate.status === 'rejected')
              .map((candidate) => (
                <li key={candidate.id}>
                  {candidate.title} — {candidate.reason}
                </li>
              ))}
          </ul>
        </details>
        <div className="watch-source-entry panel">
          <label>
            <span>Ajouter un site ou flux</span>
            <input
              type="url"
              value={manualUrl}
              onChange={(event) => setManualUrl(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !manualUrl}
            onClick={() =>
              void run(async () => {
                const source = await validateWatchSource(manualUrl);
                setManualSources((current) => [...current, source]);
                setManualUrl('');
              })
            }
          >
            Vérifier
          </button>
        </div>
        <div className="watch-creator-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => setDiscovery(null)}
          >
            Modifier
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={busy}
            onClick={activate}
          >
            {busy ? 'Activation…' : 'Activer la veille'}
          </button>
        </div>
      </section>
    );

  return (
    <form className="panel watch-form" onSubmit={discover}>
      <span className="eyebrow">Nouvelle veille</span>
      <h3>Que voulez-vous suivre&nbsp;?</h3>
      <label>
        <span>Nom</span>
        <input
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <span>Description du besoin</span>
        <textarea
          required
          maxLength={500}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
      </label>
      <label>
        <span>Mots-clés facultatifs, séparés par des virgules</span>
        <input
          value={includes}
          onChange={(event) => setIncludes(event.target.value)}
        />
      </label>
      <label>
        <span>Exclusions facultatives</span>
        <input
          value={excludes}
          onChange={(event) => setExcludes(event.target.value)}
        />
      </label>
      <div className="watch-form-grid">
        <label>
          <span>Récurrence</span>
          <select
            value={cadence}
            onChange={(event) =>
              setCadence(event.target.value === 'weekly' ? 'weekly' : 'daily')
            }
          >
            <option value="daily">Quotidienne</option>
            <option value="weekly">Hebdomadaire</option>
          </select>
        </label>
        {cadence === 'weekly' ? (
          <label>
            <span>Jour</span>
            <select
              value={weekday}
              onChange={(event) => setWeekday(Number(event.target.value))}
            >
              <option value={1}>Lundi</option>
              <option value={2}>Mardi</option>
              <option value={3}>Mercredi</option>
              <option value={4}>Jeudi</option>
              <option value={5}>Vendredi</option>
              <option value={6}>Samedi</option>
              <option value={7}>Dimanche</option>
            </select>
          </label>
        ) : null}
        <label>
          <span>Heure</span>
          <input
            type="time"
            required
            value={localTime}
            onChange={(event) => setLocalTime(event.target.value)}
          />
        </label>
      </div>
      <div className="watch-creator-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Annuler
        </button>
        <button className="primary-action" type="submit" disabled={busy}>
          {busy ? 'Recherche…' : 'Rechercher les sources'}
        </button>
      </div>
    </form>
  );
}
