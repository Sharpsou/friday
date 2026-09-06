import { useAppController } from './use-app-controller.js';
type Props = Pick<
  ReturnType<typeof useAppController>,
  | 'taskPendingDeletion'
  | 'deletingTaskId'
  | 'setTaskPendingDeletion'
  | 'deletionCancelRef'
  | 'deleteTask'
>;
export function TaskDeletionDialog({
  taskPendingDeletion,
  deletingTaskId,
  setTaskPendingDeletion,
  deletionCancelRef,
  deleteTask,
}: Props) {
  return (
    <>
      {taskPendingDeletion ? (
        <div
          className="settings-backdrop"
          onMouseDown={() => {
            if (deletingTaskId === null) setTaskPendingDeletion(null);
          }}
        >
          <section
            className="settings-dialog deletion-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deletion-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-heading">
              <div>
                <span className="eyebrow">Tâche récurrente</span>
                <h2 id="deletion-title">Que supprimer&nbsp;?</h2>
              </div>
            </div>
            <p>
              Choisissez si vous retirez uniquement «&nbsp;
              {taskPendingDeletion.title}&nbsp;» à cette date ou toutes les
              occurrences de la série.
            </p>
            <div className="deletion-actions">
              <button
                ref={deletionCancelRef}
                className="secondary-button"
                type="button"
                disabled={deletingTaskId !== null}
                onClick={() => setTaskPendingDeletion(null)}
              >
                Annuler
              </button>
              <button
                className="secondary-button deletion-choice-button"
                type="button"
                disabled={deletingTaskId !== null}
                onClick={() =>
                  void deleteTask(taskPendingDeletion, 'occurrence')
                }
              >
                Cette occurrence
              </button>
              <button
                className="delete-series-button"
                type="button"
                disabled={deletingTaskId !== null}
                onClick={() => void deleteTask(taskPendingDeletion, 'series')}
              >
                {deletingTaskId !== null ? 'Suppression…' : 'Toute la série'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
