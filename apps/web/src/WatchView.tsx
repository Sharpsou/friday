import type {
  WatchArticle,
  WatchArticleStateValue,
  WatchConceptState,
  WatchOverview,
} from '@friday/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getWatchOverview,
  setWatchArticleState,
  setWatchConceptState,
} from './sync/watch-client.js';
import { WatchCreator } from './watch/WatchCreator.js';
import { WatchDetail } from './watch/WatchDetail.js';
import { WatchList } from './watch/WatchList.js';

const EMPTY_OVERVIEW: WatchOverview = {
  watches: [],
  articles: [],
  digests: [],
  concepts: [],
  topics: [],
  runs: [],
  unreadRelevantCount: 0,
};

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
