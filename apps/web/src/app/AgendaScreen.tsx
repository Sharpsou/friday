import { MealSummary } from '../maison/maison-ui.js';
import { type AssigneeChoice, type AssigneeFilter } from '../task-assignee.js';
import { TaskCalendar } from '../TaskCalendar.js';
import { TaskList } from '../tasks/TaskList.js';
import type { RecurrenceChoice } from './use-app-controller.js';
import { useAppController } from './use-app-controller.js';
type Props = Pick<
  ReturnType<typeof useAppController>,
  | 'destination'
  | 'showMenus'
  | 'setShowMenus'
  | 'taskView'
  | 'maisonRecords'
  | 'openMeal'
  | 'setEditingTasks'
  | 'setTaskView'
  | 'filteredTasks'
  | 'editingTasks'
  | 'assigneeFilter'
  | 'setAssigneeFilter'
  | 'assigneeFilters'
  | 'submitTask'
  | 'inputRef'
  | 'title'
  | 'setTitle'
  | 'scheduleDetailsRef'
  | 'dueDate'
  | 'setDueDate'
  | 'setDueTime'
  | 'setDurationMinutes'
  | 'setRecurrenceChoice'
  | 'setRecurrenceEndDate'
  | 'dueTime'
  | 'durationMinutes'
  | 'assigneeChoice'
  | 'setAssigneeChoice'
  | 'assigneeChoices'
  | 'recurrenceChoice'
  | 'recurrenceIntervalDays'
  | 'setRecurrenceIntervalDays'
  | 'recurrenceEndDate'
  | 'note'
  | 'setNote'
  | 'filteredActiveTasks'
  | 'preferences'
  | 'assigneeLabels'
  | 'deletingTaskId'
  | 'changingStatusTaskId'
  | 'requestTaskDeletion'
  | 'setTaskPendingEdit'
  | 'changeTaskStatus'
  | 'filteredCompletedTasks'
  | 'openQuickAddForDate'
>;
export function AgendaScreen({
  destination,
  showMenus,
  setShowMenus,
  taskView,
  maisonRecords,
  openMeal,
  setEditingTasks,
  setTaskView,
  filteredTasks,
  editingTasks,
  assigneeFilter,
  setAssigneeFilter,
  assigneeFilters,
  submitTask,
  inputRef,
  title,
  setTitle,
  scheduleDetailsRef,
  dueDate,
  setDueDate,
  setDueTime,
  setDurationMinutes,
  setRecurrenceChoice,
  setRecurrenceEndDate,
  dueTime,
  durationMinutes,
  assigneeChoice,
  setAssigneeChoice,
  assigneeChoices,
  recurrenceChoice,
  recurrenceIntervalDays,
  setRecurrenceIntervalDays,
  recurrenceEndDate,
  note,
  setNote,
  filteredActiveTasks,
  preferences,
  assigneeLabels,
  deletingTaskId,
  changingStatusTaskId,
  requestTaskDeletion,
  setTaskPendingEdit,
  changeTaskStatus,
  filteredCompletedTasks,
  openQuickAddForDate,
}: Props) {
  return (
    <>
      {destination === 'agenda' && (
        <section className="screen" aria-label="Agenda">
          <label className="maison-check">
            <input
              type="checkbox"
              checked={showMenus}
              onChange={(e) => setShowMenus(e.target.checked)}
            />
            Afficher les menus
          </label>
          {showMenus && taskView === 'list' ? (
            <MealSummary records={maisonRecords} onOpen={openMeal} />
          ) : null}
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

          <div className="task-filter-row">
            <div className="page-actions">
              <span className="count-badge">{filteredTasks.length}</span>
              {taskView === 'list' && filteredTasks.length > 0 ? (
                <button
                  className="edit-toggle"
                  type="button"
                  aria-pressed={editingTasks}
                  onClick={() => setEditingTasks((current) => !current)}
                >
                  {editingTasks ? 'Terminer' : 'Modifier'}
                </button>
              ) : null}
            </div>
            <label className="task-assignee-filter" htmlFor="assignee-filter">
              <span>Responsable</span>
              <select
                id="assignee-filter"
                value={assigneeFilter}
                aria-label="Filtrer par responsable"
                onChange={(event) =>
                  setAssigneeFilter(event.target.value as AssigneeFilter)
                }
              >
                {assigneeFilters.map((filter) => (
                  <option value={filter.value} key={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {taskView === 'list' ? (
            <>
              {editingTasks ? (
                <div className="edit-notice" role="status">
                  <strong>Mode modification</strong>
                  <span>
                    Touchez une tâche pour la modifier, ou utilisez Supprimer
                    directement. Les séries proposent une occurrence ou toute la
                    série.
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
                    <summary>Détails facultatifs</summary>
                    <div className="schedule-grid">
                      <label
                        className="schedule-native-date-time-field"
                        htmlFor="task-date"
                      >
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
                              setRecurrenceChoice('none');
                              setRecurrenceEndDate('');
                            }
                          }}
                        />
                      </label>
                      <label
                        className="schedule-native-date-time-field"
                        htmlFor="task-time"
                      >
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
                      <label className="duration-field" htmlFor="task-duration">
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
                      <label htmlFor="task-assignee">
                        <span>Responsable</span>
                        <select
                          id="task-assignee"
                          name="assignee"
                          aria-label="Responsable"
                          value={assigneeChoice}
                          onChange={(event) =>
                            setAssigneeChoice(
                              event.target.value as AssigneeChoice,
                            )
                          }
                        >
                          {assigneeChoices.map((choice) => (
                            <option value={choice.value} key={choice.value}>
                              {choice.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label htmlFor="task-recurrence">
                        <span>Récurrence</span>
                        <select
                          id="task-recurrence"
                          name="recurrence"
                          value={recurrenceChoice}
                          disabled={!dueDate}
                          onChange={(event) =>
                            setRecurrenceChoice(
                              event.target.value as RecurrenceChoice,
                            )
                          }
                        >
                          <option value="none">Sans récurrence</option>
                          <option value="daily">Chaque jour</option>
                          <option value="weekly">Chaque semaine</option>
                          <option value="custom-days">Tous les N jours</option>
                          <option value="monthly">Chaque mois</option>
                          <option value="yearly">Chaque année</option>
                        </select>
                      </label>
                      {recurrenceChoice === 'custom-days' ? (
                        <label htmlFor="task-recurrence-days">
                          <span>Nombre de jours</span>
                          <input
                            id="task-recurrence-days"
                            type="number"
                            inputMode="numeric"
                            min="2"
                            max="365"
                            required
                            value={recurrenceIntervalDays}
                            onChange={(event) =>
                              setRecurrenceIntervalDays(event.target.value)
                            }
                          />
                        </label>
                      ) : null}
                      {recurrenceChoice !== 'none' ? (
                        <label
                          className="schedule-native-date-time-field"
                          htmlFor="task-recurrence-end"
                        >
                          <span>Date de fin</span>
                          <input
                            id="task-recurrence-end"
                            type="date"
                            min={dueDate}
                            required
                            value={recurrenceEndDate}
                            onChange={(event) =>
                              setRecurrenceEndDate(event.target.value)
                            }
                          />
                        </label>
                      ) : null}
                      <label className="note-field" htmlFor="task-note">
                        <span>Note</span>
                        <textarea
                          id="task-note"
                          name="note"
                          value={note}
                          maxLength={2000}
                          rows={3}
                          placeholder="Facultatif"
                          onChange={(event) => setNote(event.target.value)}
                        />
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
                  <span className="count-badge">
                    {filteredActiveTasks.length}
                  </span>
                </div>
                <TaskList
                  tasks={filteredActiveTasks.slice(
                    0,
                    preferences.homeTaskLimit,
                  )}
                  assigneeLabels={assigneeLabels}
                  editing={editingTasks}
                  deletingTaskId={deletingTaskId}
                  changingStatusTaskId={changingStatusTaskId}
                  actionsDisabled={
                    deletingTaskId !== null || changingStatusTaskId !== null
                  }
                  onDelete={requestTaskDeletion}
                  onEdit={setTaskPendingEdit}
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
                  <span className="count-badge">
                    {filteredCompletedTasks.length}
                  </span>
                </div>
                <TaskList
                  tasks={filteredCompletedTasks.slice(
                    0,
                    preferences.homeTaskLimit,
                  )}
                  assigneeLabels={assigneeLabels}
                  editing={editingTasks}
                  deletingTaskId={deletingTaskId}
                  changingStatusTaskId={changingStatusTaskId}
                  actionsDisabled={
                    deletingTaskId !== null || changingStatusTaskId !== null
                  }
                  onDelete={requestTaskDeletion}
                  onEdit={setTaskPendingEdit}
                  onStatusChange={(taskId, status) =>
                    void changeTaskStatus(taskId, status)
                  }
                  emptyMessage="Aucune tâche terminée."
                />
              </section>
            </>
          ) : (
            <TaskCalendar
              tasks={filteredTasks}
              menuRecords={showMenus ? maisonRecords : []}
              onOpenMeal={openMeal}
              view={taskView}
              onAddForDate={openQuickAddForDate}
              assigneeLabels={assigneeLabels}
            />
          )}
        </section>
      )}
    </>
  );
}
