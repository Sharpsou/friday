import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createLocalTask,
  deleteLocalTask,
  getOutboxCounts,
  listTasks,
  setLocalTaskStatus,
  type LocalTask,
} from './db/task-repository.js';
import { updateServiceWorker } from './pwa.js';
import { cancelActiveSync, syncNow } from './sync/sync-client.js';
import { TaskCalendar } from './TaskCalendar.js';

type Destination = 'today' | 'home' | 'watch';
type TaskView = 'list' | 'week' | 'month';

const TASK_SYNC_LABELS: Record<LocalTask['syncState'], string> = {
  pending: 'À synchroniser',
  sent: 'Synchronisation en cours',
  acknowledged: 'Synchronisée avec le foyer',
  conflict: 'À vérifier',
};

const TASK_DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function formatTaskSchedule(task: LocalTask): string | null {
  if (!task.dueDate) return null;
  const [year, month, day] = task.dueDate.split('-').map(Number);
  const dateLabel = TASK_DATE_FORMATTER.format(
    new Date(year ?? 0, (month ?? 1) - 1, day ?? 1),
  );
  if (!task.dueTime) return dateLabel;
  if (!task.durationMinutes) return `${dateLabel} à ${task.dueTime}`;
  const hours = Math.floor(task.durationMinutes / 60);
  const minutes = task.durationMinutes % 60;
  const durationLabel =
    hours === 0
      ? `${minutes} min`
      : minutes === 0
        ? `${hours} h`
        : `${hours} h ${minutes}`;
  return `${dateLabel} à ${task.dueTime} · ${durationLabel}`;
}

export function App() {
  const [destination, setDestination] = useState<Destination>('today');
  const [taskView, setTaskView] = useState<TaskView>('list');
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [editingTasks, setEditingTasks] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [changingStatusTaskId, setChangingStatusTaskId] = useState<
    string | null
  >(null);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [hubReachable, setHubReachable] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scheduleDetailsRef = useRef<HTMLDetailsElement>(null);

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

  const synchronize = useCallback(
    async (forceAttempt = false) => {
      if (!forceAttempt && !navigator.onLine) {
        setHubReachable(false);
        await reloadLocalState();
        return;
      }

      setSyncing(true);
      try {
        const result = await syncNow();
        setHubReachable(true);
        setLastSync(result.syncedAt);
        await reloadLocalState();
      } catch {
        const browserOnline = navigator.onLine;
        setOnline(browserOnline);
        setHubReachable(false);
        await reloadLocalState();
      } finally {
        setSyncing(false);
      }
    },
    [reloadLocalState],
  );

  useEffect(() => {
    window.queueMicrotask(() => {
      void reloadLocalState();
      void synchronize();
    });
    if (navigator.storage?.persist) void navigator.storage.persist();
  }, [reloadLocalState, synchronize]);

  useEffect(() => {
    let onlineSyncTimer: number | undefined;
    const onOnline = () => {
      setOnline(true);
      setHubReachable(null);
      window.clearTimeout(onlineSyncTimer);
      onlineSyncTimer = window.setTimeout(() => {
        void (async () => {
          await cancelActiveSync();
          if (navigator.onLine) await synchronize(true);
        })();
      }, 300);
    };
    const onOffline = () => {
      void cancelActiveSync();
      setOnline(false);
      setHubReachable(false);
      setSyncing(false);
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
      window.clearTimeout(onlineSyncTimer);
      window.clearInterval(timer);
    };
  }, [synchronize]);

  const { activeTasks, completedTasks } = useMemo(() => {
    const active: LocalTask[] = [];
    const completed: LocalTask[] = [];
    for (const task of tasks) {
      if (task.status === 'done') completed.push(task);
      else active.push(task);
    }
    return { activeTasks: active, completedTasks: completed };
  }, [tasks]);

  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createLocalTask({
        title,
        dueDate: dueDate || null,
        dueTime: dueDate && dueTime ? dueTime : null,
        durationMinutes:
          dueDate && dueTime && durationMinutes
            ? Number(durationMinutes)
            : null,
      });
      setTitle('');
      setDueDate('');
      setDueTime('');
      setDurationMinutes('');
      if (scheduleDetailsRef.current) scheduleDetailsRef.current.open = false;
      setMessage('Tâche enregistrée sur ce téléphone.');
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
          ? 'Tâche supprimée.'
          : 'Tâche supprimée sur ce téléphone.',
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

  async function changeTaskStatus(taskId: string, status: LocalTask['status']) {
    setChangingStatusTaskId(taskId);
    try {
      await cancelActiveSync();
      setSyncing(false);
      await setLocalTaskStatus(taskId, status);
      setMessage(
        status === 'done'
          ? 'Tâche terminée sur ce téléphone.'
          : 'Tâche rouverte sur ce téléphone.',
      );
      await reloadLocalState();
      void synchronize();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Modification impossible',
      );
    } finally {
      setChangingStatusTaskId(null);
    }
  }

  function openQuickAdd() {
    setEditingTasks(false);
    setTaskView('list');
    setDestination('home');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function openQuickAddForDate(date: string) {
    setEditingTasks(false);
    setTaskView('list');
    setDestination('home');
    setDueDate(date);
    setDueTime('');
    setDurationMinutes('');
    window.setTimeout(() => {
      if (scheduleDetailsRef.current) scheduleDetailsRef.current.open = true;
      inputRef.current?.focus();
    }, 0);
  }

  const connectionLabel = !online
    ? 'Hors ligne'
    : syncing || hubReachable === null
      ? 'Connexion…'
      : hubReachable
        ? 'Connecté'
        : 'Hors ligne';
  const connectionTone = !online
    ? 'is-offline'
    : syncing || hubReachable === null
      ? 'is-connecting'
      : hubReachable
        ? 'is-online'
        : 'is-offline';

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Friday</h1>
        <button
          className={`status-pill ${connectionTone}`}
          type="button"
          onClick={() => void synchronize()}
          disabled={syncing}
        >
          <span aria-hidden="true" />
          {connectionLabel}
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
              <p>
                {message ??
                  (activeTasks.length === 0
                    ? 'Ajoutez une tâche depuis Maison.'
                    : 'Consultez ou modifiez la liste dans Maison.')}
              </p>
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
              <TaskList
                tasks={activeTasks.slice(0, 4)}
                changingStatusTaskId={changingStatusTaskId}
                actionsDisabled={changingStatusTaskId !== null}
                onStatusChange={(taskId, status) =>
                  void changeTaskStatus(taskId, status)
                }
              />
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

            {pending > 0 || lastSync ? (
              <p className="sync-summary" aria-live="polite">
                {pending > 0 ? (
                  <span className="pending-summary">
                    {pending} modification{pending > 1 ? 's' : ''} en attente
                  </span>
                ) : null}
                {pending > 0 && lastSync ? (
                  <span aria-hidden="true">·</span>
                ) : null}
                {lastSync ? (
                  <span>
                    Dernière synchro à{' '}
                    {new Date(lastSync).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                ) : null}
              </p>
            ) : null}
          </section>
        )}

        {destination === 'home' && (
          <section className="screen" aria-labelledby="home-title">
            <div className="section-heading page-heading">
              <div>
                <span className="eyebrow">Maison</span>
                <h2 id="home-title">Agenda</h2>
              </div>
              <div className="page-actions">
                <span className="count-badge">{tasks.length}</span>
                {taskView === 'list' && tasks.length > 0 && (
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

            <div
              className="task-view-switch"
              role="group"
              aria-label="Affichage des tâches"
            >
              {(['list', 'week', 'month'] as const).map((view) => (
                <button
                  type="button"
                  key={view}
                  aria-pressed={taskView === view}
                  onClick={() => {
                    setEditingTasks(false);
                    setTaskView(view);
                  }}
                >
                  {view === 'list'
                    ? 'Liste'
                    : view === 'week'
                      ? 'Semaine'
                      : 'Mois'}
                </button>
              ))}
            </div>

            {taskView === 'list' ? (
              <>
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
                    <details
                      className="task-schedule-fields"
                      ref={scheduleDetailsRef}
                    >
                      <summary>Date et rendez-vous</summary>
                      <div className="schedule-grid">
                        <label htmlFor="task-date">
                          <span>Date</span>
                          <input
                            id="task-date"
                            name="dueDate"
                            type="date"
                            value={dueDate}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDueDate(value);
                              if (!value) {
                                setDueTime('');
                                setDurationMinutes('');
                              }
                            }}
                          />
                        </label>
                        <label htmlFor="task-time">
                          <span>Heure</span>
                          <input
                            id="task-time"
                            name="dueTime"
                            type="time"
                            value={dueTime}
                            disabled={!dueDate}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDueTime(value);
                              if (!value) setDurationMinutes('');
                            }}
                          />
                        </label>
                        <label
                          className="duration-field"
                          htmlFor="task-duration"
                        >
                          <span>Durée</span>
                          <select
                            id="task-duration"
                            name="durationMinutes"
                            value={durationMinutes}
                            disabled={!dueDate || !dueTime}
                            onChange={(event) =>
                              setDurationMinutes(event.target.value)
                            }
                          >
                            <option value="">Sans durée</option>
                            <option value="15">15 min</option>
                            <option value="30">30 min</option>
                            <option value="45">45 min</option>
                            <option value="60">1 h</option>
                            <option value="90">1 h 30</option>
                            <option value="120">2 h</option>
                          </select>
                        </label>
                      </div>
                    </details>
                    <p>
                      Le titre est obligatoire. La tâche est enregistrée
                      localement avant synchronisation.
                    </p>
                  </form>
                )}

                <section
                  className="panel task-panel"
                  aria-labelledby="active-tasks-title"
                >
                  <div className="task-section-heading">
                    <h3 id="active-tasks-title">Tâches en cours</h3>
                    <span className="count-badge">{activeTasks.length}</span>
                  </div>
                  <TaskList
                    tasks={activeTasks}
                    editing={editingTasks}
                    deletingTaskId={deletingTaskId}
                    changingStatusTaskId={changingStatusTaskId}
                    actionsDisabled={
                      deletingTaskId !== null || changingStatusTaskId !== null
                    }
                    onDelete={(taskId) => void deleteTask(taskId)}
                    onStatusChange={(taskId, status) =>
                      void changeTaskStatus(taskId, status)
                    }
                    emptyMessage="Aucune tâche en cours."
                  />
                </section>

                <section
                  className="panel task-panel completed-task-panel"
                  aria-labelledby="completed-tasks-title"
                >
                  <div className="task-section-heading">
                    <h3 id="completed-tasks-title">Tâches terminées</h3>
                    <span className="count-badge">{completedTasks.length}</span>
                  </div>
                  <TaskList
                    tasks={completedTasks}
                    editing={editingTasks}
                    deletingTaskId={deletingTaskId}
                    changingStatusTaskId={changingStatusTaskId}
                    actionsDisabled={
                      deletingTaskId !== null || changingStatusTaskId !== null
                    }
                    onDelete={(taskId) => void deleteTask(taskId)}
                    onStatusChange={(taskId, status) =>
                      void changeTaskStatus(taskId, status)
                    }
                    emptyMessage="Aucune tâche terminée."
                  />
                </section>
              </>
            ) : (
              <TaskCalendar
                tasks={tasks}
                view={taskView}
                onAddForDate={openQuickAddForDate}
              />
            )}
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
  changingStatusTaskId = null,
  actionsDisabled = false,
  emptyMessage = 'Aucune tâche enregistrée.',
  onDelete,
  onStatusChange,
}: {
  tasks: readonly LocalTask[];
  editing?: boolean;
  deletingTaskId?: string | null;
  changingStatusTaskId?: string | null;
  actionsDisabled?: boolean;
  emptyMessage?: string;
  onDelete?: (taskId: string) => void;
  onStatusChange?: (taskId: string, status: LocalTask['status']) => void;
}) {
  if (tasks.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <ul className="task-list">
      {tasks.map((task) => {
        const schedule = formatTaskSchedule(task);
        return (
          <li className={task.status === 'done' ? 'is-done' : ''} key={task.id}>
            <span className="task-copy">
              <strong>{task.title}</strong>
              {schedule ? (
                <small className="task-schedule">{schedule}</small>
              ) : null}
              <small className={`task-sync is-${task.syncState}`}>
                {TASK_SYNC_LABELS[task.syncState]}
              </small>
            </span>
            {!editing && onStatusChange ? (
              <button
                className="task-status-button"
                type="button"
                aria-label={`${task.status === 'done' ? 'Rouvrir' : 'Terminer'} ${task.title}`}
                disabled={actionsDisabled}
                onClick={() =>
                  onStatusChange(
                    task.id,
                    task.status === 'done' ? 'todo' : 'done',
                  )
                }
              >
                {changingStatusTaskId === task.id
                  ? 'En cours…'
                  : task.status === 'done'
                    ? 'Rouvrir'
                    : 'Terminer'}
              </button>
            ) : null}
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
        );
      })}
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
