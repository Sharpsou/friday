import { useMemo, useState } from 'react';

import type { LocalTask } from './db/task-repository.js';
import { getAssigneeLabel } from './task-assignee.js';
import {
  getMonthGridDates,
  getTodayLocalDate,
  getWeekDates,
  parseLocalDate,
  shiftCalendarPeriod,
  type CalendarPeriod,
} from './task-calendar.js';

const MONTH_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
});

const DAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  weekday: 'long',
});

const FULL_DAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  weekday: 'long',
  year: 'numeric',
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
});

const MONTH_WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const;

function formatDuration(durationMinutes: number | null): string | null {
  if (!durationMinutes) return null;
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes}`;
}

function formatTaskTime(task: LocalTask): string | null {
  if (!task.dueTime) return null;
  const duration = formatDuration(task.durationMinutes);
  return duration ? `${task.dueTime} · ${duration}` : task.dueTime;
}

function formatPeriodLabel(anchorDate: string, period: CalendarPeriod): string {
  if (period === 'month') {
    return MONTH_FORMATTER.format(parseLocalDate(anchorDate));
  }

  const dates = getWeekDates(anchorDate);
  const first = parseLocalDate(dates[0] ?? anchorDate);
  const last = parseLocalDate(dates.at(-1) ?? anchorDate);
  if (
    first.getFullYear() === last.getFullYear() &&
    first.getMonth() === last.getMonth()
  ) {
    return `${first.getDate()}–${last.getDate()} ${MONTH_FORMATTER.format(last)}`;
  }
  return `${first.getDate()} ${first.toLocaleDateString('fr-FR', { month: 'short' })}–${last.getDate()} ${MONTH_FORMATTER.format(last)}`;
}

export function TaskCalendar({
  tasks,
  view,
  onAddForDate,
  assigneeLabels,
}: {
  tasks: readonly LocalTask[];
  view: CalendarPeriod;
  onAddForDate: (date: string) => void;
  assigneeLabels: { current: string; other: string };
}) {
  const [anchorDate, setAnchorDate] = useState(getTodayLocalDate);
  const [selectedDate, setSelectedDate] = useState(getTodayLocalDate);
  const today = getTodayLocalDate();
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, LocalTask[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const current = grouped.get(task.dueDate) ?? [];
      current.push(task);
      grouped.set(task.dueDate, current);
    }
    for (const current of grouped.values()) {
      current.sort((left, right) =>
        (left.dueTime ?? '').localeCompare(right.dueTime ?? ''),
      );
    }
    return grouped;
  }, [tasks]);
  const dates =
    view === 'week' ? getWeekDates(anchorDate) : getMonthGridDates(anchorDate);
  const selectedTasks = tasksByDate.get(selectedDate) ?? [];

  function movePeriod(direction: -1 | 1) {
    const nextDate = shiftCalendarPeriod(anchorDate, view, direction);
    setAnchorDate(nextDate);
    setSelectedDate(nextDate);
  }

  function goToToday() {
    setAnchorDate(today);
    setSelectedDate(today);
  }

  return (
    <section className="panel task-calendar" aria-label="Agenda des tâches">
      <div className="calendar-toolbar">
        <button
          className="calendar-arrow"
          type="button"
          aria-label={view === 'week' ? 'Semaine précédente' : 'Mois précédent'}
          onClick={() => movePeriod(-1)}
        >
          ‹
        </button>
        <div className="calendar-period">
          <strong>{formatPeriodLabel(anchorDate, view)}</strong>
          <button type="button" onClick={goToToday}>
            Aujourd’hui
          </button>
        </div>
        <button
          className="calendar-arrow"
          type="button"
          aria-label={view === 'week' ? 'Semaine suivante' : 'Mois suivant'}
          onClick={() => movePeriod(1)}
        >
          ›
        </button>
      </div>

      {view === 'week' ? (
        <div className="calendar-week-list">
          {dates.map((date) => {
            const dateTasks = tasksByDate.get(date) ?? [];
            const parsedDate = parseLocalDate(date);
            return (
              <button
                className={`calendar-week-day${date === selectedDate ? ' is-selected' : ''}${date === today ? ' is-today' : ''}`}
                type="button"
                key={date}
                aria-pressed={date === selectedDate}
                aria-label={`${FULL_DAY_FORMATTER.format(parsedDate)}, ${dateTasks.length} tâche${dateTasks.length > 1 ? 's' : ''}`}
                onClick={() => setSelectedDate(date)}
              >
                <span className="calendar-week-date">
                  <small>{WEEKDAY_FORMATTER.format(parsedDate)}</small>
                  <strong>{parsedDate.getDate()}</strong>
                </span>
                <span className="calendar-week-preview">
                  {dateTasks.length === 0 ? (
                    <small>Libre</small>
                  ) : (
                    dateTasks.slice(0, 2).map((task) => (
                      <span
                        className={task.status === 'done' ? 'is-done' : ''}
                        key={task.id}
                      >
                        {task.dueTime ? `${task.dueTime} ` : ''}
                        {task.title}
                      </span>
                    ))
                  )}
                  {dateTasks.length > 2 ? (
                    <small>+{dateTasks.length - 2} autre(s)</small>
                  ) : null}
                </span>
                <span className="calendar-week-count">{dateTasks.length}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="calendar-month-weekdays" aria-hidden="true">
            {MONTH_WEEKDAYS.map((weekday, index) => (
              <span key={`${weekday}-${index}`}>{weekday}</span>
            ))}
          </div>
          <div className="calendar-month-grid">
            {dates.map((date) => {
              const parsedDate = parseLocalDate(date);
              const taskCount = tasksByDate.get(date)?.length ?? 0;
              const outsideMonth = date.slice(0, 7) !== anchorDate.slice(0, 7);
              return (
                <button
                  className={`${outsideMonth ? 'is-outside' : ''}${date === selectedDate ? ' is-selected' : ''}${date === today ? ' is-today' : ''}`}
                  type="button"
                  key={date}
                  aria-pressed={date === selectedDate}
                  aria-label={`${FULL_DAY_FORMATTER.format(parsedDate)}, ${taskCount} tâche${taskCount > 1 ? 's' : ''}`}
                  onClick={() => setSelectedDate(date)}
                >
                  <span>{parsedDate.getDate()}</span>
                  {taskCount > 0 ? <small>{taskCount}</small> : null}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="calendar-day-detail">
        <div className="calendar-day-heading">
          <div>
            <span className="eyebrow">Jour sélectionné</span>
            <h3>{DAY_FORMATTER.format(parseLocalDate(selectedDate))}</h3>
          </div>
          <button type="button" onClick={() => onAddForDate(selectedDate)}>
            + Ajouter pour ce jour
          </button>
        </div>
        {selectedTasks.length === 0 ? (
          <p className="empty-state">Aucune tâche prévue.</p>
        ) : (
          <ul className="calendar-day-tasks">
            {selectedTasks.map((task) => {
              const time = formatTaskTime(task);
              const metadata = [
                time,
                getAssigneeLabel(task.assigneeProfileId, assigneeLabels),
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li
                  className={task.status === 'done' ? 'is-done' : ''}
                  key={task.id}
                >
                  <span>{task.title}</span>
                  <small>{metadata}</small>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
