import { useEffect, useRef, useState } from 'react';
import { type BudgetState } from '../db/budget-repository.js';

export function BudgetTodayAlert({
  onOpen,
  state,
}: {
  onOpen: () => void;
  state: BudgetState;
}) {
  const now = new Date();
  const month = now.toLocaleDateString('sv-SE').slice(0, 7);
  const overspent = state.envelopes.find((envelope) => {
    const spent = state.entries
      .filter(
        (entry) =>
          entry.kind === 'expense' &&
          entry.envelopeId === envelope.id &&
          entry.occurredOn.startsWith(month),
      )
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    return (
      envelope.rollover === 'reset' && spent > envelope.monthlyAllocationCents
    );
  });
  const soon = state.plannedExpenses.find((expense) => {
    if (expense.status !== 'planned') return false;
    const days = Math.ceil(
      (Date.parse(`${expense.dueDate}T12:00:00`) - now.getTime()) / 86_400_000,
    );
    return days >= 0 && days <= 30 && !expense.provisionAccepted;
  });
  const label = overspent
    ? `L’enveloppe ${overspent.name} est dépassée.`
    : soon
      ? `${soon.label} approche sans provision validée.`
      : null;
  if (!label) return null;
  return (
    <aside className="budget-today-alert" aria-live="polite">
      <span>
        <strong>Budget</strong>
        {label}
      </span>
      <button type="button" onClick={onOpen}>
        Voir
      </button>
    </aside>
  );
}

export function WatchTodaySummary({ onOpen }: { onOpen: () => void }) {
  const refreshInFlight = useRef(false);
  const [summary, setSummary] = useState<{
    count: number;
    detail: string;
    kind: 'active' | 'completed' | 'failed' | 'news';
    latestAt: string | null;
    title: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const reload = async (refresh = false) => {
      if (refresh && refreshInFlight.current) return;
      if (refresh) refreshInFlight.current = true;
      try {
        const { getWatchOverview } = await import('../sync/watch-client.js');
        const overview = await getWatchOverview({ refresh });
        if (!active) return;
        const run = overview.runs[0] ?? null;
        const topicCount = overview.topics.length;
        const latestAt =
          overview.digests[0]?.createdAt ?? run?.updatedAt ?? null;
        if (run?.stage === 'failed') {
          setSummary({
            count: 0,
            detail: 'Ouvrez la veille pour consulter le problème et relancer.',
            kind: 'failed',
            latestAt,
            title: 'Veille interrompue',
          });
        } else if (run && !['completed', 'failed'].includes(run.stage)) {
          setSummary({
            count: 0,
            detail:
              run.total > 0
                ? `${runStageLabelForToday(run.stage)} · ${run.current.toString()}/${run.total.toString()}`
                : runStageLabelForToday(run.stage),
            kind: 'active',
            latestAt,
            title: 'Actualisation de la veille',
          });
        } else if (overview.unreadRelevantCount > 0) {
          setSummary({
            count: overview.unreadRelevantCount,
            detail: latestAt
              ? `Mise à jour du ${new Date(latestAt).toLocaleDateString('fr-FR')}`
              : 'Une nouvelle synthèse est disponible.',
            kind: 'news',
            latestAt,
            title: `${overview.unreadRelevantCount.toString()} nouveauté${overview.unreadRelevantCount > 1 ? 's' : ''}`,
          });
        } else if (
          run?.stage === 'completed' &&
          overview.digests.length === 0 &&
          topicCount > 0
        ) {
          setSummary({
            count: topicCount,
            detail:
              'Référence constituée. Les prochaines analyses signaleront les évolutions.',
            kind: 'completed',
            latestAt,
            title: `${topicCount.toString()} thème${topicCount > 1 ? 's' : ''} suivi${topicCount > 1 ? 's' : ''}`,
          });
        } else if (latestAt) {
          setSummary({
            count: 0,
            detail: `Dernière mise à jour le ${new Date(latestAt).toLocaleDateString('fr-FR')}`,
            kind: 'completed',
            latestAt,
            title: 'Veille à jour',
          });
        } else {
          setSummary(null);
        }
      } catch {
        // Today remains usable with the last rendered Watch status.
      } finally {
        if (refresh) refreshInFlight.current = false;
      }
    };
    void reload().then(() => {
      if (navigator.onLine) void reload(true);
    });
    const onOnline = () => void reload(true);
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible')
        void reload(true);
    }, 5_000);
    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, []);

  if (!summary) return null;
  return (
    <aside
      className={`budget-today-alert watch-today-alert is-${summary.kind}`}
      aria-live="polite"
    >
      <div>
        <strong>{summary.title}</strong>
        <span>{summary.detail}</span>
      </div>
      <button type="button" onClick={onOpen}>
        Ouvrir
      </button>
    </aside>
  );
}

function runStageLabelForToday(stage: string): string {
  return (
    {
      queued: 'En attente',
      discovering: 'Recherche des sources',
      collecting: 'Collecte des articles',
      extracting: 'Analyse des articles',
      clustering: 'Classement par thèmes',
      synthesizing: 'Rédaction de la synthèse',
    }[stage] ?? 'Traitement en cours'
  );
}
