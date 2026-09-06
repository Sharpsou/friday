import type {
  WatchArticle,
  WatchArticleStateValue,
  WatchTopic,
} from '@friday/contracts';

export function TopicCard({
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
