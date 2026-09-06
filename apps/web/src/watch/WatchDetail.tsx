import type {
  Watch,
  WatchArticle,
  WatchArticleStateValue,
  WatchConceptState,
  WatchOverview,
} from '@friday/contracts';
import { useMemo, useState } from 'react';
import { deleteWatch, runWatch, updateWatch } from '../sync/watch-client.js';
import { SourceExpansion } from './SourceExpansion.js';
import { TopicCard } from './TopicCard.js';
import { WatchRunIndicator } from './WatchRunIndicator.js';
import {
  DATE_FORMAT,
  formatWatchSchedule,
  sourceHost,
} from './watch-format.js';

export function WatchDetail({
  busy,
  onArticleState,
  onBusy,
  onChanged,
  onConceptState,
  overview,
  watch,
}: {
  busy: boolean;
  onArticleState: (
    article: WatchArticle,
    state: WatchArticleStateValue,
  ) => Promise<void>;
  onBusy: (action: () => Promise<void>) => Promise<boolean>;
  onChanged: () => Promise<void>;
  onConceptState: (
    watchId: string,
    conceptId: string,
    state: WatchConceptState,
  ) => Promise<void>;
  overview: WatchOverview;
  watch: Watch;
}) {
  const digest = overview.digests.find((item) => item.watchId === watch.id);
  const topics = overview.topics.filter((topic) => topic.watchId === watch.id);
  const concepts = overview.concepts.filter(
    (concept) => concept.watchId === watch.id,
  );
  const articles = useMemo(
    () =>
      overview.articles.filter(
        (article) => article.watchId === watch.id && article.state !== 'hidden',
      ),
    [overview.articles, watch.id],
  );
  const articleById = useMemo(
    () => new Map(articles.map((article) => [article.id, article])),
    [articles],
  );
  const run = overview.runs.find((item) => item.watchId === watch.id);
  const referenceReady = run?.stage === 'completed' && topics.length > 0;
  const [cadence, setCadence] = useState(watch.cadence);
  const [weekday, setWeekday] = useState(watch.weekday ?? 1);
  const [localTime, setLocalTime] = useState(watch.localTime);
  const scheduleChanged =
    cadence !== watch.cadence ||
    localTime !== watch.localTime ||
    (cadence === 'weekly' && weekday !== watch.weekday);
  return (
    <div className="watch-stack">
      {run ? <WatchRunIndicator run={run} /> : null}
      <article className="panel watch-synthesis">
        <span className="eyebrow">
          {digest
            ? `Synthèse du ${DATE_FORMAT.format(new Date(digest.createdAt))}`
            : referenceReady
              ? 'Référence constituée'
              : 'Référence en cours'}
        </span>
        <h3>
          {digest?.title ??
            (referenceReady
              ? `${topics.length.toString()} thème${topics.length > 1 ? 's' : ''} suivi${topics.length > 1 ? 's' : ''}`
              : 'Pas encore de nouveauté significative')}
        </h3>
        <p>
          {digest?.summary ??
            (referenceReady
              ? 'Cette première analyse sert de point de comparaison. Les prochaines mises à jour signaleront uniquement les nouveautés et évolutions.'
              : watch.question)}
        </p>
      </article>

      {topics.length > 0 ? (
        <section aria-labelledby="watch-topics-title">
          <h3 id="watch-topics-title">Thèmes suivis</h3>
          <div className="watch-topic-list">
            {topics.map((topic) => (
              <TopicCard
                articles={topic.articleIds.flatMap((articleId) => {
                  const article = articleById.get(articleId);
                  return article ? [article] : [];
                })}
                key={topic.id}
                onArticleState={onArticleState}
                topic={topic}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="assistant-empty">Aucun thème n’a encore été défini.</p>
      )}

      <details className="panel watch-concepts watch-disclosure">
        <summary>
          <span>
            <strong>Filtres et concepts</strong>
            <small>{concepts.length} critères ciblables</small>
          </span>
        </summary>
        <p>
          Suivi cible la synthèse, secondaire garde un œil discret, masqué
          l’écarte.
        </p>
        <div className="watch-concept-list">
          {concepts.map((concept) => (
            <label key={concept.id}>
              <span>
                <strong>{concept.label}</strong>
                <small>{concept.articleCount} sujet(s)</small>
              </span>
              <select
                aria-label={`Priorité de ${concept.label}`}
                disabled={busy}
                value={concept.state}
                onChange={(event) =>
                  void onConceptState(
                    watch.id,
                    concept.id,
                    event.target.value as WatchConceptState,
                  )
                }
              >
                <option value="tracked">Suivi</option>
                <option value="secondary">Secondaire</option>
                <option value="muted">Masqué</option>
              </select>
            </label>
          ))}
        </div>
      </details>

      <details className="panel watch-settings-panel watch-disclosure">
        <summary>
          <span>
            <strong>Sources et réglages</strong>
            <small>
              {watch.sources.length} source
              {watch.sources.length > 1 ? 's' : ''} · prochaine mise à jour{' '}
              {formatWatchSchedule(watch)}
            </small>
          </span>
        </summary>

        <section
          className="watch-settings-section"
          aria-labelledby="schedule-title"
        >
          <div className="watch-settings-section-heading">
            <div>
              <h4 id="schedule-title">Planification</h4>
              <p>Fuseau utilisé : {watch.timeZone}</p>
            </div>
            <span className={watch.status === 'active' ? 'is-active' : ''}>
              {watch.status === 'active' ? 'Active' : 'En pause'}
            </span>
          </div>
          <form
            className="watch-schedule-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onBusy(async () => {
                await updateWatch(watch.id, {
                  cadence,
                  localTime,
                  weekday: cadence === 'weekly' ? weekday : null,
                });
                await onChanged();
              });
            }}
          >
            <label>
              <span>Récurrence</span>
              <select
                aria-label="Récurrence"
                disabled={busy}
                value={cadence}
                onChange={(event) =>
                  setCadence(
                    event.target.value === 'weekly' ? 'weekly' : 'daily',
                  )
                }
              >
                <option value="daily">Tous les jours</option>
                <option value="weekly">Chaque semaine</option>
              </select>
            </label>
            {cadence === 'weekly' ? (
              <label>
                <span>Jour</span>
                <select
                  aria-label="Jour"
                  disabled={busy}
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
              <span>Heure de mise à jour</span>
              <input
                aria-label="Heure de mise à jour"
                disabled={busy}
                required
                type="time"
                value={localTime}
                onChange={(event) => setLocalTime(event.target.value)}
              />
            </label>
            <button
              className="primary-action"
              disabled={busy || !scheduleChanged}
              type="submit"
            >
              {busy ? 'Enregistrement…' : 'Enregistrer la planification'}
            </button>
          </form>
        </section>

        <section
          className="watch-settings-section"
          aria-labelledby="sources-title"
        >
          <h4 id="sources-title">Sources suivies</h4>
          <ul className="watch-source-list">
            {watch.sources.map((source) => (
              <li key={source.id}>
                <span>{source.title}</span>
                <small>{sourceHost(source.siteUrl)}</small>
              </li>
            ))}
          </ul>
          <SourceExpansion
            busy={busy}
            onBusy={onBusy}
            onChanged={onChanged}
            watch={watch}
          />
        </section>

        <div className="watch-settings-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void onBusy(async () => {
                await updateWatch(watch.id, {
                  status: watch.status === 'active' ? 'paused' : 'active',
                });
                await onChanged();
              })
            }
          >
            {watch.status === 'active' ? 'Mettre en pause' : 'Reprendre'}
          </button>
          <button
            type="button"
            disabled={busy || watch.status === 'paused'}
            onClick={() =>
              void onBusy(async () => {
                await runWatch(watch.id);
                await onChanged();
              })
            }
          >
            Actualiser maintenant
          </button>
          <button
            className="danger-action"
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Supprimer la veille « ${watch.name} » ?`))
                void onBusy(async () => {
                  await deleteWatch(watch.id);
                  await onChanged();
                });
            }}
          >
            Supprimer
          </button>
        </div>
      </details>
    </div>
  );
}
