import {
  createLocalTask,
  deleteLocalTask,
  deleteLocalTaskSeries,
  setLocalTaskStatus,
  updateLocalTask,
  updateLocalTaskSeries,
  type LocalTask,
  type UpdateLocalTaskInput,
} from '../db/task-repository.js';
import { cancelActiveSync } from '../sync/sync-client.js';
import { getAssigneeProfileId } from '../task-assignee.js';

import type { useAppSync } from './use-app-sync.js';
import type { useConnectionState } from './use-connection-state.js';
import type { useLocalData } from './use-local-data.js';
import type { useTaskFormState } from './use-task-form-state.js';
interface Context {
  title: string;
  note: string;
  setSyncing: ReturnType<typeof useConnectionState>['setSyncing'];
  assigneeChoice: ReturnType<typeof useTaskFormState>['assigneeChoice'];
  dueDate: ReturnType<typeof useTaskFormState>['dueDate'];
  dueTime: ReturnType<typeof useTaskFormState>['dueTime'];
  durationMinutes: ReturnType<typeof useTaskFormState>['durationMinutes'];
  recurrenceChoice: ReturnType<typeof useTaskFormState>['recurrenceChoice'];
  recurrenceEndDate: ReturnType<typeof useTaskFormState>['recurrenceEndDate'];
  recurrenceIntervalDays: ReturnType<
    typeof useTaskFormState
  >['recurrenceIntervalDays'];
  setTitle: ReturnType<typeof useTaskFormState>['setTitle'];
  setDueDate: ReturnType<typeof useTaskFormState>['setDueDate'];
  setDueTime: ReturnType<typeof useTaskFormState>['setDueTime'];
  setDurationMinutes: ReturnType<typeof useTaskFormState>['setDurationMinutes'];
  setRecurrenceChoice: ReturnType<
    typeof useTaskFormState
  >['setRecurrenceChoice'];
  setRecurrenceIntervalDays: ReturnType<
    typeof useTaskFormState
  >['setRecurrenceIntervalDays'];
  setRecurrenceEndDate: ReturnType<
    typeof useTaskFormState
  >['setRecurrenceEndDate'];
  setNote: ReturnType<typeof useTaskFormState>['setNote'];
  setAssigneeChoice: ReturnType<typeof useTaskFormState>['setAssigneeChoice'];
  scheduleDetailsRef: ReturnType<typeof useTaskFormState>['scheduleDetailsRef'];
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  reloadLocalState: ReturnType<typeof useLocalData>['reloadLocalState'];
  synchronize: ReturnType<typeof useAppSync>['synchronize'];
  setTaskPendingDeletion: ReturnType<
    typeof useTaskFormState
  >['setTaskPendingDeletion'];
  setDeletingTaskId: ReturnType<typeof useTaskFormState>['setDeletingTaskId'];
  setEditingTasks: ReturnType<typeof useTaskFormState>['setEditingTasks'];
  setChangingStatusTaskId: ReturnType<
    typeof useTaskFormState
  >['setChangingStatusTaskId'];
  taskPendingEdit: ReturnType<typeof useTaskFormState>['taskPendingEdit'];
  setSavingEditor: React.Dispatch<React.SetStateAction<boolean>>;
  setTaskPendingEdit: ReturnType<typeof useTaskFormState>['setTaskPendingEdit'];
}
export function createTaskActions({
  title,
  note,
  setSyncing,
  assigneeChoice,
  dueDate,
  dueTime,
  durationMinutes,
  recurrenceChoice,
  recurrenceEndDate,
  recurrenceIntervalDays,
  setTitle,
  setDueDate,
  setDueTime,
  setDurationMinutes,
  setRecurrenceChoice,
  setRecurrenceIntervalDays,
  setRecurrenceEndDate,
  setNote,
  setAssigneeChoice,
  scheduleDetailsRef,
  setMessage,
  reloadLocalState,
  synchronize,
  setTaskPendingDeletion,
  setDeletingTaskId,
  setEditingTasks,
  setChangingStatusTaskId,
  taskPendingEdit,
  setSavingEditor,
  setTaskPendingEdit,
}: Context) {
  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await cancelActiveSync();
      setSyncing(false);
      await createLocalTask({
        assigneeProfileId: getAssigneeProfileId(assigneeChoice),
        title,
        dueDate: dueDate || null,
        dueTime: dueDate && dueTime ? dueTime : null,
        durationMinutes:
          dueDate && dueTime && durationMinutes
            ? Number(durationMinutes)
            : null,
        recurrence:
          dueDate && recurrenceChoice !== 'none'
            ? recurrenceChoice === 'custom-days'
              ? {
                  endDate: recurrenceEndDate,
                  interval: Number(recurrenceIntervalDays),
                  unit: 'day',
                }
              : {
                  endDate: recurrenceEndDate,
                  interval: 1,
                  unit:
                    recurrenceChoice === 'daily'
                      ? 'day'
                      : recurrenceChoice === 'weekly'
                        ? 'week'
                        : recurrenceChoice === 'monthly'
                          ? 'month'
                          : 'year',
                }
            : null,
        note,
      });
      setTitle('');
      setDueDate('');
      setDueTime('');
      setDurationMinutes('');
      setRecurrenceChoice('none');
      setRecurrenceIntervalDays('2');
      setRecurrenceEndDate('');
      setNote('');
      setAssigneeChoice('unassigned');
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
  function requestTaskDeletion(task: LocalTask) {
    if (task.recurrence !== null) {
      setTaskPendingDeletion(task);
      return;
    }
    void deleteTask(task, 'occurrence');
  }
  async function deleteTask(task: LocalTask, scope: 'occurrence' | 'series') {
    setDeletingTaskId(task.id);
    try {
      await cancelActiveSync();
      setSyncing(false);
      if (scope === 'series') {
        await deleteLocalTaskSeries(task.id);
      } else {
        await deleteLocalTask(task.id);
      }
      setMessage(
        scope === 'series'
          ? 'Série récurrente supprimée sur ce téléphone.'
          : navigator.onLine
            ? 'Tâche supprimée.'
            : 'Tâche supprimée sur ce téléphone.',
      );
      setTaskPendingDeletion(null);
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
  async function saveTaskEdit(
    input: UpdateLocalTaskInput,
    scope: 'occurrence' | 'series',
  ) {
    if (!taskPendingEdit) return;
    setSavingEditor(true);
    try {
      await cancelActiveSync();
      setSyncing(false);
      if (scope === 'series') {
        await updateLocalTaskSeries(taskPendingEdit.id, input);
      } else {
        await updateLocalTask(taskPendingEdit.id, input);
      }
      setMessage(
        scope === 'series'
          ? 'Série modifiée sur cet appareil.'
          : 'Tâche modifiée sur cet appareil.',
      );
      setTaskPendingEdit(null);
      await reloadLocalState();
      void synchronize();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Modification impossible',
      );
    } finally {
      setSavingEditor(false);
    }
  }
  return {
    submitTask,
    requestTaskDeletion,
    deleteTask,
    changeTaskStatus,
    saveTaskEdit,
  };
}
