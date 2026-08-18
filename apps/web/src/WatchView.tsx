import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import type {
  Watch,
  WatchArticle,
  WatchArticleStateValue,
  WatchConceptState,
  WatchCreateRequest,
  WatchDiscovery,
  WatchOverview,
  WatchRunProgress,
  WatchTopic,
} from '@friday/contracts';

import {
  addDiscoveredWatchSources,
  createWatch,
  deleteWatch,
  discoverWatchSources,
  getWatchOverview,
  runWatch,
  setWatchArticleState,
  setWatchConceptState,
  updateWatch,
  validateWatchSource,
  type WatchSourceInput,
} from './sync/watch-client.js';

const EMPTY_OVERVIEW: WatchOverview = {
  watches: [],
  articles: [],
  digests: [],
  concepts: [],
  topics: [],
  runs: [],
  unreadRelevantCount: 0,
};

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export default function WatchView({
  creatorOpen,
  onCreatorOpenChange,
}: {
  creatorOpen: boolean;
  onCreatorOpenChange: (open: boolean) => void;
}) {
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [selectedWatchId, setSelectedWatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const reload = useCallback(async (refresh = true) => {
    if (refresh && refreshInFlight.current) return;
    if (refresh) refreshInFlight.current = true;
    try {
      setError(null);
      setOverview(await getWatchOverview({ refresh }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Veille indisponible.');
    } finally {
      if (refresh) refreshInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    window.queueMicrotask(() => {
      void reload(false).then(() => {
        if (navigator.onLine) void reload();
      });
    });
    const onOnline = () => void reload();
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible')
        void reload();
    }, 2_500);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [reload]);

  const selectedWatch = overview.watches.find(
    (watch) => watch.id === selectedWatchId,
  );

  const withBusy = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action impossible.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const changeArticleState = useCallback(
    async (article: WatchArticle, state: WatchArticleStateValue) => {
      await withBusy(async () => {
        setOverview(
          await setWatchArticleState(
            overview,
            article.watchId,
            article.id,
            state,
          ),
        );
      });
    },
    [overview, withBusy],
  );

  const changeConceptState = useCallback(
    async (watchId: string, conceptId: string, state: WatchConceptState) => {
      await withBusy(async () => {
        setOverview(
          await setWatchConceptState(overview, watchId, conceptId, state),
        );
      });
    },
    [overview, withBusy],
  );

  return (
    <section className="watch-view" aria-label="Veille">
      {selectedWatch ? (
        <header className="section-heading watch-heading">
          <h2>{selectedWatch.name}</h2>
          <button
            aria-label="Retour aux veilles"
            className="watch-back-button"
            type="button"
            onClick={() => setSelectedWatchId(null)}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="M11.75 5.25 7 10l4.75 4.75" />
            </svg>
            <span>Veilles</span>
          </button>
        </header>
      ) : null}

      {error ? (
        <p className="assistant-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="assistant-empty">Chargement…</p> : null}

      {!loading && creatorOpen ? (
        <WatchCreator
          busy={busy}
          onCancel={() => onCreatorOpenChange(false)}
          onComplete={async () => {
            onCreatorOpenChange(false);
            await reload();
          }}
          onError={setError}
          onBusy={setBusy}
        />
      ) : null}

      {!loading && !creatorOpen && selectedWatch ? (
        <WatchDetail
          busy={busy}
          overview={overview}
          watch={selectedWatch}
          onArticleState={changeArticleState}
          onConceptState={changeConceptState}
          onChanged={reload}
          onBusy={withBusy}
        />
      ) : null}

      {!loading && !creatorOpen && !selectedWatch ? (
        <WatchList
          overview={overview}
          onCreate={() => onCreatorOpenChange(true)}
          onSelect={setSelectedWatchId}
        />
      ) : null}
    </section>
  );
}

function WatchList({
  onCreate,
  onSelect,
  overview,
}: {
  onCreate: () => void;
  onSelect: (id: string) => void;
  overview: WatchOverview;
}) {
  if (overview.watches.length === 0)
    return (
      <div className="panel watch-empty">
        <h3>Aucune veille</h3>
        <p>
          Créez un dossier thématique. Friday cherchera des sources variées,
          puis rassemblera leurs nouveautés dans une synthèse.
        </p>
        <button className="primary-action" type="button" onClick={onCreate}>
          Créer une veille
        </button>
      </div>
    );
  return (
    <div className="watch-stack watch-home-list">
      {overview.watches.map((watch) => {
        const digest = overview.digests.find(
          (item) => item.watchId === watch.id,
        );
        const topics = overview.topics.filter(
          (topic) => topic.watchId === watch.id,
        );
        const articleCount = new Set(
          topics.flatMap((topic) => topic.articleIds),
        ).size;
        const unread = overview.articles.filter(
          (article) =>
            article.watchId === watch.id &&
            article.relevant &&
            !article.baseline &&
            article.state === 'unread',
        ).length;
        const run = overview.runs.find((item) => item.watchId === watch.id);
        return (
          <button
            className="panel watch-home-card"
            key={watch.id}
            type="button"
            onClick={() => onSelect(watch.id)}
          >
            <span className="eyebrow">
              {unread > 0
                ? `${unread.toString()} nouveauté${unread > 1 ? 's' : ''}`
                : 'À jour'}
            </span>
            <h3>{watch.name}</h3>
            <p>
              {digest?.summary ??
                (run?.stage === 'completed' && topics.length > 0
                  ? `Référence constituée · ${topics.length.toString()} thème${topics.length > 1 ? 's' : ''} suivi${topics.length > 1 ? 's' : ''}.`
                  : 'La première collecte constitue une référence silencieuse.')}
            </p>
            <small>
              {topics.length} thème{topics.length > 1 ? 's' : ''} ·{' '}
              {articleCount} article{articleCount > 1 ? 's' : ''} source
              {articleCount > 1 ? 's' : ''}
            </small>
            <small>Prochaine mise à jour {formatWatchSchedule(watch)}</small>
            {run && run.stage !== 'failed' ? (
              <small role="status">
                {runTriggerLabel(run.trigger)} · {runStageLabel(run.stage)}
                {run.total > 0
                  ? ` · ${run.current.toString()}/${run.total.toString()}`
                  : ''}
              </small>
            ) : null}
            {run?.stage === 'failed' ? (
              <small className="assistant-error">
                Actualisation interrompue · ouvrez la veille pour la relancer
              </small>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function WatchDetail({
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

function WatchRunIndicator({ run }: { run: WatchRunProgress }) {
  if (run.stage === 'failed')
    return (
      <aside className="watch-run-indicator is-failed" role="alert">
        <strong>Actualisation interrompue</strong>
        <span>
          Une réponse imprévue de l’IA a arrêté l’analyse. Vos sources et les
          articles déjà collectés sont conservés. Vous pouvez relancer depuis «
          Sources et réglages ».
        </span>
      </aside>
    );
  if (run.stage === 'completed') return null;
  return (
    <aside className="watch-run-indicator" aria-live="polite" role="status">
      <span className="background-job-dot" aria-hidden="true" />
      <span>
        <strong>Actualisation en cours</strong>
        <small>
          {runStageLabel(run.stage)}
          {run.total > 0
            ? ` · ${run.current.toString()}/${run.total.toString()}`
            : ''}
        </small>
      </span>
    </aside>
  );
}

function SourceExpansion({
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

function TopicCard({
  articles,
  onArticleState,
  topic,
}: {
  articles: WatchArticle[];
  onArticleState: (
    article: WatchArticle,
    state: WatchArticleStateValue,
  ) => Promise<void>;
  topic: WatchTopic;
}) {
  const labels: Record<WatchTopic['eventKind'], string> = {
    new_topic: 'Thème suivi',
    major_update: 'Évolution importante',
    additional_detail: 'Complément',
    confirmation: 'Confirmé',
    contradiction: 'Sources divergentes',
    duplicate: 'Déjà couvert',
    noise: 'Secondaire',
  };
  return (
    <article className="panel watch-topic">
      <span className="eyebrow">{labels[topic.eventKind]}</span>
      <h4>{topic.title}</h4>
      <p>{topic.summary}</p>
      {articles.length > 0 ? (
        <details>
          <summary>
            {articles.length} article{articles.length > 1 ? 's' : ''} source
            {articles.length > 1 ? 's' : ''}
          </summary>
          <div className="watch-article-list">
            {articles.map((article) => (
              <article className="watch-article" key={article.id}>
                <a href={article.url} target="_blank" rel="noreferrer">
                  {article.title}
                </a>
                <small>{article.sourceTitle}</small>
                <div className="watch-actions">
                  <button
                    type="button"
                    className={article.state === 'read' ? 'is-active' : ''}
                    onClick={() => void onArticleState(article, 'read')}
                  >
                    Lu
                  </button>
                  <button
                    type="button"
                    className={article.state === 'useful' ? 'is-active' : ''}
                    onClick={() => void onArticleState(article, 'useful')}
                  >
                    Utile
                  </button>
                  <button
                    type="button"
                    className={article.state === 'follow_up' ? 'is-active' : ''}
                    onClick={() => void onArticleState(article, 'follow_up')}
                  >
                    À suivre
                  </button>
                </div>
              </article>
            ))}
          </div>
        </details>
      ) : (
        <small>Aucun article classé pour le moment.</small>
      )}
    </article>
  );
}

function WatchCreator({
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

function splitKeywords(input: string): string[] {
  return [
    ...new Set(
      input
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].slice(0, 30);
}

function sourceKindLabel(kind: string): string {
  return (
    {
      official: 'Officiel',
      research: 'Recherche',
      specialized_press: 'Presse spécialisée',
      general_press: 'Presse généraliste',
      community: 'Communauté',
    }[kind] ?? kind
  );
}

function runStageLabel(stage: string): string {
  return (
    {
      queued: 'En attente',
      discovering: 'Recherche des sources',
      collecting: 'Collecte',
      extracting: 'Analyse des articles',
      clustering: 'Classement par thèmes',
      synthesizing: 'Rédaction de la synthèse',
      completed: 'Terminé',
      failed: 'Échec de la mise à jour',
    }[stage] ?? stage
  );
}

function runTriggerLabel(trigger: string): string {
  return (
    {
      initialization: 'Initialisation',
      scheduled: 'Mise à jour planifiée',
      catch_up: 'Rattrapage',
      manual: 'Mise à jour manuelle',
      resume: 'Reprise',
    }[trigger] ?? trigger
  );
}

function formatWatchSchedule(watch: Watch): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: watch.timeZone,
  }).format(new Date(watch.nextDigestAt));
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
}
