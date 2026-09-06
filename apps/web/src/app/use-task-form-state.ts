import { useRef, useState } from 'react';
import { type LocalTask } from '../db/task-repository.js';
import { type AssigneeChoice, type AssigneeFilter } from '../task-assignee.js';
import { type RecurrenceChoice } from './controller-records.js';

export function useTaskFormState() {
  const [editingTasks, setEditingTasks] = useState(false);
  const [taskPendingEdit, setTaskPendingEdit] = useState<LocalTask | null>(
    null,
  );
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [taskPendingDeletion, setTaskPendingDeletion] =
    useState<LocalTask | null>(null);
  const [changingStatusTaskId, setChangingStatusTaskId] = useState<
    string | null
  >(null);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [recurrenceChoice, setRecurrenceChoice] =
    useState<RecurrenceChoice>('none');
  const [recurrenceIntervalDays, setRecurrenceIntervalDays] = useState('2');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [note, setNote] = useState('');
  const [assigneeChoice, setAssigneeChoice] =
    useState<AssigneeChoice>('unassigned');
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const scheduleDetailsRef = useRef<HTMLDetailsElement>(null);
  const deletionCancelRef = useRef<HTMLButtonElement>(null);
  return {
    editingTasks,
    setEditingTasks,
    taskPendingEdit,
    setTaskPendingEdit,
    deletingTaskId,
    setDeletingTaskId,
    taskPendingDeletion,
    setTaskPendingDeletion,
    changingStatusTaskId,
    setChangingStatusTaskId,
    title,
    setTitle,
    dueDate,
    setDueDate,
    dueTime,
    setDueTime,
    durationMinutes,
    setDurationMinutes,
    recurrenceChoice,
    setRecurrenceChoice,
    recurrenceIntervalDays,
    setRecurrenceIntervalDays,
    recurrenceEndDate,
    setRecurrenceEndDate,
    note,
    setNote,
    assigneeChoice,
    setAssigneeChoice,
    assigneeFilter,
    setAssigneeFilter,
    inputRef,
    scheduleDetailsRef,
    deletionCancelRef,
  };
}
