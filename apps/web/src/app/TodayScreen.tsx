import { MealSummary } from '../maison/maison-ui.js';
import { TaskList } from '../tasks/TaskList.js';
import {
  BudgetTodayAlert,
  WatchTodaySummary,
} from '../today/TodaySummaries.js';
import { useAppController } from './use-app-controller.js';
type Props = Pick<
  ReturnType<typeof useAppController>,
  | 'destination'
  | 'maisonRecords'
  | 'openMeal'
  | 'activeTasks'
  | 'message'
  | 'openQuickAdd'
  | 'preferences'
  | 'assigneeLabels'
  | 'changingStatusTaskId'
  | 'changeTaskStatus'
  | 'unpurchasedGroceryItems'
  | 'setEditingGroceries'
  | 'setDestination'
  | 'budgetState'
  | 'conflicts'
  | 'pending'
  | 'lastSync'
>;
export function TodayScreen({
  destination,
  maisonRecords,
  openMeal,
  activeTasks,
  message,
  openQuickAdd,
  preferences,
  assigneeLabels,
  changingStatusTaskId,
  changeTaskStatus,
  unpurchasedGroceryItems,
  setEditingGroceries,
  setDestination,
  budgetState,
  conflicts,
  pending,
  lastSync,
}: Props) {
  return (
    <>
      {destination === 'today' && (
        <section className="screen" aria-labelledby="today-title">
          <MealSummary
            records={maisonRecords}
            date={new Date().toLocaleDateString('sv-SE')}
            onOpen={openMeal}
          />
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
                  ? 'Ajoutez une tâche depuis Agenda.'
                  : 'Consultez ou modifiez la liste dans Agenda.')}
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
              tasks={activeTasks.slice(0, preferences.todayTaskLimit)}
              assigneeLabels={assigneeLabels}
              changingStatusTaskId={changingStatusTaskId}
              actionsDisabled={changingStatusTaskId !== null}
              onStatusChange={(taskId, status) =>
                void changeTaskStatus(taskId, status)
              }
            />
          </section>

          <section className="panel grocery-summary-panel" aria-label="Courses">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Courses</span>
                <h3 id="groceries-summary-title">
                  {unpurchasedGroceryItems.length === 0
                    ? 'Liste à jour'
                    : `${unpurchasedGroceryItems.length} produit${unpurchasedGroceryItems.length > 1 ? 's' : ''} à acheter`}
                </h3>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setEditingGroceries(false);
                  setDestination('groceries');
                }}
              >
                Voir la liste
              </button>
            </div>
            <p>
              {unpurchasedGroceryItems.length === 0
                ? 'Aucun produit restant.'
                : unpurchasedGroceryItems
                    .slice(0, 3)
                    .map((item) => item.label)
                    .join(' · ')}
            </p>
          </section>

          <BudgetTodayAlert
            state={budgetState}
            onOpen={() => setDestination('budget')}
          />

          <WatchTodaySummary onOpen={() => setDestination('watch')} />

          {conflicts > 0 ? (
            <aside className="conflict-notice" aria-live="polite">
              <div>
                <strong>
                  {conflicts} modification{conflicts > 1 ? 's' : ''} à vérifier
                </strong>
                <span>
                  {conflicts === 1
                    ? 'Une donnée partagée a changé sur plusieurs appareils.'
                    : 'Des données partagées ont changé sur plusieurs appareils.'}
                </span>
              </div>
              <button type="button" onClick={() => setDestination('agenda')}>
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
    </>
  );
}
