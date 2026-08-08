import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createLocalTask,
  deleteLocalTask,
  getOutboxCounts,
  listTasks,
  type LocalTask,
} from './db/task-repository.js';
import { updateServiceWorker } from './pwa.js';
import { cancelActiveSync, syncNow } from './sync/sync-client.js';

type Destination = 'today' | 'home' | 'watch';

const TASK_SYNC_LABELS: Record<LocalTask['syncState'], string> = {
  pending: 'À synchroniser',
  sent: 'Synchronisation en cours',
  acknowledged: 'Synchronisée avec le foyer',
  conflict: 'À vérifier',
};

export function App() {
  const [destination, setDestination] = useState<Destination>('today');
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [editingTasks, setEditingTasks] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [message, setMessage] = useState('Chargement des données locales…');
  const [syncing, setSyncing] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reloadLocalState = useCallback(async () => {
    const [localTasks, counts] = await Promise.all([
      listTasks(),
      getOutboxCounts(),
    ]);
    setTasks(localTasks);
    setPending(counts.pending);
    setConflicts(counts.conflicts);
    return localTasks;
  }, []);

  const synchronize = useCallback(async () => {
    if (!navigator.onLine) {
      setMessage('Hors ligne — les changements restent sur ce téléphone');
      await reloadLocalState();
      return;
    }

    setSyncing(true);
    try {
      const result = await syncNow();
      setLastSync(result.syncedAt);
      setMessage(
        result.pending === 0
          ? 'Toutes les modifications sont synchronisées'
          : `${result.pending} modification${result.pending > 1 ? 's' : ''} en attente de synchronisation`,
      );
      await reloadLocalState();
    } catch {
      setMessage('Hub indisponible — changements conservés localement');
      await reloadLocalState();
    } finally {
      setSyncing(false);
    }
  }, [reloadLocalState]);

  useEffect(() => {
    window.queueMicrotask(() => {
      void reloadLocalState();
      void synchronize();
    });
    if (navigator.storage?.persist) void navigator.storage.persist();
  }, [reloadLocalState, synchronize]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void synchronize();
    };
    const onOffline = () => {
      void cancelActiveSync();
      setOnline(false);
      setSyncing(false);
      setMessage(
        'Hors ligne — les modifications seront synchronisées plus tard',
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void synchronize();
    };
    const onUpdate = () => setUpdateAvailable(true);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('friday:update-available', onUpdate);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void synchronize();
    }, 60_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('friday:update-available', onUpdate);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [synchronize]);

  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status === 'todo'),
    [tasks],
  );

  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createLocalTask(title);
      setTitle('');
      setMessage('Enregistré sur ce téléphone');
      await reloadLocalState();
      void synchronize();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Écriture impossible',
      );
    }
  }

  async function deleteTask(taskId: string) {
    setDeletingTaskId(taskId);
    try {
      await cancelActiveSync();
      setSyncing(false);
      await deleteLocalTask(taskId);
      setMessage(
        navigator.onLine
          ? 'Suppression enregistrée — synchronisation en cours'
          : 'Tâche supprimée sur ce téléphone — synchronisation en attente',
      );
      const remainingTasks = await reloadLocalState();
      if (remainingTasks.length === 0) setEditingTasks(false);
      void synchronize();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Suppression impossible',
      );
    } finally {
      setDeletingTaskId(null);
    }
  }

  function openQuickAdd() {
    setEditingTasks(false);
    setDestination('home');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  const syncLabel = online
    ? pending > 0
      ? `${pending} changement${pending > 1 ? 's' : ''} en attente`
      : lastSync
        ? 'Synchronisé'
        : 'Connexion au hub'
    : `Hors ligne — ${pending} en attente`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Friday</h1>
        <button
          className={`status-pill ${online ? 'is-online' : 'is-offline'}`}
          type="button"
          onClick={() => void synchronize()}
          disabled={syncing}
        >
          <span aria-hidden="true" />
          {syncing ? 'Synchronisation…' : syncLabel}
        </button>
      </header>

      <main>
        {destination === 'today' && (
          <section className="screen" aria-labelledby="today-title">
            <div className="hero-card">
              <span className="eyebrow">Aujourd’hui</span>
              <h2 id="today-title">
                {activeTasks.length === 0
                  ? 'Aucune tâche en cours.'
                  : `${activeTasks.length} tâche${activeTasks.length > 1 ? 's' : ''} en cours.`}
              </h2>
              <p>{message}</p>
            </div>

            <section className="panel" aria-labelledby="tasks-summary-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Tâches</span>
                  <h3 id="tasks-summary-title">Tâches en cours</h3>
                </div>
                <button
                  className="text-button"
                  onClick={openQuickAdd}
                  type="button"
                >
                  Ajouter
                </button>
              </div>
              <TaskList tasks={activeTasks.slice(0, 4)} />
            </section>

            {conflicts > 0 ? (
              <aside className="conflict-notice" aria-live="polite">
                <div>
                  <strong>
                    {conflicts} modification{conflicts > 1 ? 's' : ''} à
                    vérifier
                  </strong>
                  <span>
                    {conflicts === 1
                      ? 'Une tâche a changé sur plusieurs appareils.'
                      : 'Des tâches ont changé sur plusieurs appareils.'}
                  </span>
                </div>
                <button type="button" onClick={() => setDestination('home')}>
                  Voir
                </button>
              </aside>
            ) : null}

            {lastSync ? (
              <p className="last-sync-note">
                Dernière synchro à{' '}
                {new Date(lastSync).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            ) : null}
          </section>
        )}

        {destination === 'home' && (
          <section className="screen" aria-labelledby="home-title">
            <div className="section-heading page-heading">
              <div>
                <span className="eyebrow">Maison</span>
                <h2 id="home-title">Les tâches</h2>
              </div>
              <div className="page-actions">
                <span className="count-badge">{tasks.length}</span>
                {tasks.length > 0 && (
                  <button
                    className="edit-toggle"
                    type="button"
                    aria-pressed={editingTasks}
                    onClick={() => setEditingTasks((current) => !current)}
                  >
                    {editingTasks ? 'Terminer' : 'Modifier'}
                  </button>
                )}
              </div>
            </div>

            {editingTasks ? (
              <div className="edit-notice" role="status">
                <strong>Mode modification</strong>
                <span>
                  Sélectionnez Supprimer sur une tâche. La suppression est
                  immédiate, sans confirmation.
                </span>
              </div>
            ) : (
              <form
                className="quick-form"
                onSubmit={(event) => void submitTask(event)}
              >
                <label htmlFor="task-title">Nouvelle tâche</label>
                <div className="input-row">
                  <input
                    ref={inputRef}
                    id="task-title"
                    name="title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Ex. Sortir les poubelles"
                    maxLength={200}
                    autoComplete="off"
                  />
                  <button type="submit" disabled={!title.trim()}>
                    Ajouter
                  </button>
                </div>
                <p>
                  Le titre est obligatoire. La tâche est enregistrée localement
                  avant synchronisation.
                </p>
              </form>
            )}

            <section
              className="panel task-panel"
              aria-label="Tâches enregistrées"
            >
              <TaskList
                tasks={tasks}
                editing={editingTasks}
                deletingTaskId={deletingTaskId}
                actionsDisabled={deletingTaskId !== null}
                onDelete={(taskId) => void deleteTask(taskId)}
              />
            </section>
          </section>
        )}

        {destination === 'watch' && (
          <section className="screen centered" aria-labelledby="watch-title">
            <div className="placeholder-mark">V</div>
            <span className="eyebrow">Veille</span>
            <h2 id="watch-title">Fonction non disponible dans ce lot.</h2>
            <p>
              La veille sera implémentée après validation de la synchronisation
              hors ligne.
            </p>
          </section>
        )}
      </main>

      {updateAvailable && (
        <aside className="update-banner" aria-live="polite">
          <span>Une mise à jour est prête.</span>
          <button type="button" onClick={() => void updateServiceWorker(true)}>
            Installer
          </button>
        </aside>
      )}

      <button
        className="fab"
        type="button"
        onClick={openQuickAdd}
        aria-label="Ajouter rapidement"
      >
        +
      </button>

      <nav className="bottom-nav" aria-label="Navigation principale">
        <NavButton
          active={destination === 'today'}
          label="Aujourd’hui"
          onClick={() => setDestination('today')}
        />
        <NavButton
          active={destination === 'home'}
          label="Maison"
          onClick={() => setDestination('home')}
        />
        <NavButton
          active={destination === 'watch'}
          label="Veille"
          onClick={() => setDestination('watch')}
        />
      </nav>
    </div>
  );
}

function TaskList({
  tasks,
  editing = false,
  deletingTaskId = null,
  actionsDisabled = false,
  onDelete,
}: {
  tasks: readonly LocalTask[];
  editing?: boolean;
  deletingTaskId?: string | null;
  actionsDisabled?: boolean;
  onDelete?: (taskId: string) => void;
}) {
  if (tasks.length === 0) {
    return <p className="empty-state">Aucune tâche enregistrée.</p>;
  }

  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <li key={task.id}>
          <span className="task-check" aria-hidden="true" />
          <span className="task-copy">
            <strong>{task.title}</strong>
            <small className={`task-sync is-${task.syncState}`}>
              {TASK_SYNC_LABELS[task.syncState]}
            </small>
          </span>
          {editing && onDelete ? (
            <button
              className="delete-task-button"
              type="button"
              aria-label={`Supprimer ${task.title}`}
              disabled={actionsDisabled}
              onClick={() => onDelete(task.id)}
            >
              {deletingTaskId === task.id ? 'Suppression…' : 'Supprimer'}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function NavButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? 'active' : ''}
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
