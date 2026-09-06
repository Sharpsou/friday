import { type LocalTask } from '../db/task-repository.js';
import { getAssigneeLabel } from '../task-assignee.js';
import { formatTaskRecurrence } from '../task-recurrence.js';
import { TASK_SYNC_LABELS } from './task-sync.js';

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

export function TaskList({
  tasks,
  assigneeLabels,
  editing = false,
  deletingTaskId = null,
  changingStatusTaskId = null,
  actionsDisabled = false,
  emptyMessage = 'Aucune tâche enregistrée.',
  onDelete,
  onEdit,
  onStatusChange,
}: {
  tasks: readonly LocalTask[];
  assigneeLabels: { current: string; other: string };
  editing?: boolean;
  deletingTaskId?: string | null;
  changingStatusTaskId?: string | null;
  actionsDisabled?: boolean;
  emptyMessage?: string;
  onDelete?: (task: LocalTask) => void;
  onEdit?: (task: LocalTask) => void;
  onStatusChange?: (taskId: string, status: LocalTask['status']) => void;
}) {
  if (tasks.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <ul className="task-list">
      {tasks.map((task) => {
        const schedule = formatTaskSchedule(task);
        const assignee = getAssigneeLabel(
          task.assigneeProfileId,
          assigneeLabels,
        );
        const recurrence = formatTaskRecurrence(task.recurrence);
        return (
          <li className={task.status === 'done' ? 'is-done' : ''} key={task.id}>
            {editing && onEdit ? (
              <button
                className="item-edit-target task-copy"
                type="button"
                aria-label={`Modifier ${task.title}`}
                onClick={() => onEdit(task)}
              >
                <TaskCopy
                  task={task}
                  schedule={schedule}
                  assignee={assignee}
                  recurrence={recurrence}
                />
              </button>
            ) : (
              <span className="task-copy">
                <TaskCopy
                  task={task}
                  schedule={schedule}
                  assignee={assignee}
                  recurrence={recurrence}
                />
              </span>
            )}
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
                onClick={() => onDelete(task)}
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

function TaskCopy({
  assignee,
  recurrence,
  schedule,
  task,
}: {
  assignee: string;
  recurrence: string | null;
  schedule: string | null;
  task: LocalTask;
}) {
  return (
    <>
      <strong>{task.title}</strong>
      <span className="task-metadata">
        {schedule ? <small className="task-schedule">{schedule}</small> : null}
        <small className="task-assignee">
          {schedule ? `· ${assignee}` : assignee}
        </small>
        {recurrence ? (
          <small className="task-recurrence">· {recurrence}</small>
        ) : null}
      </span>
      {task.note ? <small className="task-note">{task.note}</small> : null}
      <small className={`task-sync is-${task.syncState}`}>
        {TASK_SYNC_LABELS[task.syncState]}
      </small>
    </>
  );
}
