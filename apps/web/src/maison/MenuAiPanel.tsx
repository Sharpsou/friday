import { useEffect, useRef, useState } from 'react';
import {
  MenuAiJobSchema,
  type MenuAiJob,
  type RecipeDraft,
  type Recipe,
} from '@friday/contracts';

export function MenuAiPanel({
  available,
  onDraft,
}: {
  available: boolean;
  onDraft: (
    draft: RecipeDraft,
    provenance: Recipe['provenance'],
    sources: Recipe['sources'],
  ) => void;
}) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'local' | 'web'>('local');
  const [jobs, setJobs] = useState<MenuAiJob[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<{ name: string; mode: string; id: string } | null>(
    null,
  );
  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/menus/ai-jobs', {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as { jobs: unknown[] };
        if (!controller.signal.aborted)
          setJobs(body.jobs.map((j) => MenuAiJobSchema.parse(j)));
      } catch {
        /* The manual catalogue remains available. */
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [available]);
  async function enqueue() {
    setBusy(true);
    setError('');
    if (request.current?.name !== name || request.current.mode !== mode)
      request.current = { name, mode, id: crypto.randomUUID() };
    try {
      const response = await fetch('/api/menus/ai-jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: request.current.id, name, mode }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? 'La file IA est pleine. Attendez la fin d’une demande.'
            : 'Assistant recettes indisponible. Les recettes manuelles restent utilisables.',
        );
      const job = MenuAiJobSchema.parse(await response.json());
      setJobs((current) => [job, ...current.filter((j) => j.id !== job.id)]);
      request.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Demande non envoyée.');
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    try {
      const response = await fetch(`/api/menus/ai-jobs/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Annulation indisponible.');
      const job = MenuAiJobSchema.parse(await response.json());
      setJobs((current) => current.map((j) => (j.id === id ? job : j)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Annulation indisponible.');
    }
  }
  return (
    <section className="panel">
      <h3>Compléter une recette avec Friday</h3>
      <form
        className="maison-form"
        onSubmit={(e) => {
          e.preventDefault();
          void enqueue();
        }}
      >
        <label>
          Plat recherché
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Source
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="local">Connaissance locale — non vérifiée</option>
            <option value="web">Recherche Web — avec sources à vérifier</option>
          </select>
        </label>
        <p>
          La demande rejoint la file IA. Seule la recette que vous enregistrez
          sera partagée avec le foyer.
        </p>
        <button disabled={!available || busy}>Demander une proposition</button>
        {!available ? (
          <p>Le hub est nécessaire pour les propositions IA.</p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </form>
      {jobs.map((job) => (
        <article key={job.id}>
          <h4>{job.name}</h4>
          <p>{job.stage}</p>
          {job.error ? <p role="alert">{job.error}</p> : null}
          {job.status === 'queued' || job.status === 'running' ? (
            <button onClick={() => void cancel(job.id)}>
              Annuler la demande
            </button>
          ) : null}
          {job.draft ? (
            <>
              <p>
                Ingrédients, quantités et portions à vérifier avant utilisation.
              </p>
              <button
                onClick={() => onDraft(job.draft!, job.mode, job.sources)}
              >
                Vérifier et modifier la recette
              </button>
            </>
          ) : null}
        </article>
      ))}
    </section>
  );
}
