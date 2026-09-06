import type { InferenceStatus } from '@friday/contracts';

export function InferenceIndicator({ status }: { status: InferenceStatus }) {
  const labels = {
    chat: 'Chat',
    menus: 'Menus',
    watch: 'Veille',
    classification: 'classement des courses',
    photo: 'lecture de photo',
  };
  const activeLabel = status.active
    ? `IA occupée par ${{ chat: 'le Chat', menus: 'les Menus', watch: 'la Veille', classification: 'le classement', photo: 'la lecture de photo' }[status.active.kind]}`
    : 'IA en attente';
  const waiting = Object.entries(status.queued)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(
      ([kind, count]) =>
        `${count} traitement${count === 1 ? '' : 's'} ${labels[kind as keyof typeof labels]} en attente`,
    );
  return (
    <aside
      className="background-job-indicator is-active inference-indicator"
      aria-live="polite"
      role="status"
    >
      <span className="background-job-dot" aria-hidden="true" />
      <span className="background-job-copy">
        <strong>{activeLabel}</strong>
        {waiting.length > 0 ? <small>{waiting.join(' · ')}</small> : null}
      </span>
    </aside>
  );
}
