import type { WatchOverview } from '@friday/contracts';
import {
  formatWatchSchedule,
  runStageLabel,
  runTriggerLabel,
} from './watch-format.js';

export function WatchList({
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
