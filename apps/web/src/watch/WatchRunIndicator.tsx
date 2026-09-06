import type { WatchRunProgress } from '@friday/contracts';
import { runStageLabel } from './watch-format.js';

export function WatchRunIndicator({ run }: { run: WatchRunProgress }) {
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
