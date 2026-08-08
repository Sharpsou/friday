interface SchedulableTask {
  createdAt: string;
  dueDate: string | null;
  dueTime: string | null;
  id: string;
}

export function compareTasksBySchedule(
  left: SchedulableTask,
  right: SchedulableTask,
): number {
  if (left.dueDate === null && right.dueDate !== null) return 1;
  if (left.dueDate !== null && right.dueDate === null) return -1;

  const dateOrder = (left.dueDate ?? '').localeCompare(right.dueDate ?? '');
  if (dateOrder !== 0) return dateOrder;

  const timeOrder = (left.dueTime ?? '').localeCompare(right.dueTime ?? '');
  if (timeOrder !== 0) return timeOrder;

  const creationOrder = left.createdAt.localeCompare(right.createdAt);
  return creationOrder !== 0 ? creationOrder : left.id.localeCompare(right.id);
}
