import { lazy, Suspense } from 'react';
import { AgendaScreen } from './app/AgendaScreen.js';
import { AppHeader } from './app/AppHeader.js';
import { CoursesScreen } from './app/CoursesScreen.js';
import { InferenceIndicator } from './app/InferenceIndicator.js';
import { MaisonScreen } from './app/MaisonScreen.js';
import { NavButton } from './app/Navigation.js';
import { SettingsDialog } from './app/SettingsDialog.js';
import { TaskDeletionDialog } from './app/TaskDeletionDialog.js';
import { TodayScreen } from './app/TodayScreen.js';
import { useAppController } from './app/use-app-controller.js';
import { AuthGate } from './auth/AuthGate.js';
import {
  GroceryClassificationDialog,
  GroceryClassificationIndicator,
} from './GroceryClassification.js';
import { GroceryEditorDialog, TaskEditorDialog } from './ItemEditorDialogs.js';
import './maison/maison.css';
import { updateServiceWorker } from './pwa.js';
import { ShoppingMode } from './ShoppingMode.js';

const BudgetView = lazy(() =>
  import('./BudgetView.js').then((module) => ({ default: module.BudgetView })),
);

const AssistantView = lazy(() => import('./AssistantView.js'));

const WatchView = lazy(() => import('./WatchView.js'));

const RobotView = lazy(() => import('./RobotView.js'));

export function App() {
  const controller = useAppController();
  const {
    authSession,
    auth,
    shoppingModeInitialCount,
    groceryAisleGroups,
    changingGroceryItemId,
    changeGroceryItemState,
    closeShoppingMode,
    destination,
    groceryItems,
    synchronize,
    groceryClassification,
    setDestination,
    setClassificationPreviewOpen,
    startGroceryAisleClassification,
    stopGroceryAisleClassification,
    inferenceStatus,
    deviceApprovalRequests,
    approveNewDevice,
    rejectNewDevice,
    openQuickAdd,
    assigneeLabels,
    budgetState,
    assigneeChoices,
    setTaskPendingEdit,
    setMaisonTab,
    reloadLocalState,
    setGroceryPendingEdit,
    authMembers,
    budgetQuickAddOpen,
    setBudgetQuickAddOpen,
    chatCreateRequest,
    setChatAvailable,
    watchCreatorOpen,
    setWatchCreatorOpen,
    updateAvailable,
    classificationPreviewOpen,
    applyGroceryAisleClassification,
    discardGroceryAisleClassification,
    taskPendingEdit,
    savingEditor,
    saveTaskEdit,
    groceryPendingEdit,
    groceryClassifications,
    saveGroceryEdit,
    chatAvailable,
    openGroceryQuickAdd,
    setChatCreateRequest,
  } = controller;

  const authenticatedSession = authSession;

  if (!authenticatedSession) return <AuthGate auth={auth} />;

  if (shoppingModeInitialCount !== null) {
    return (
      <ShoppingMode
        groups={groceryAisleGroups}
        initialItemCount={shoppingModeInitialCount}
        changingItemId={changingGroceryItemId}
        onCheck={(item) => void changeGroceryItemState(item.id, true)}
        onClose={closeShoppingMode}
      />
    );
  }

  return (
    <div className="app-shell">
      <AppHeader {...controller} />

      {groceryClassification.job ? (
        <GroceryClassificationIndicator
          busy={groceryClassification.busy}
          job={groceryClassification.job}
          onDismiss={() => void groceryClassification.dismiss()}
          onOpen={() => {
            setDestination('groceries');
            setClassificationPreviewOpen(true);
          }}
          onRetry={() => void startGroceryAisleClassification()}
          onStop={() => void stopGroceryAisleClassification()}
        />
      ) : null}

      {inferenceStatus &&
      (inferenceStatus.active ||
        Object.values(inferenceStatus.queued).some(
          (count) => (count ?? 0) > 0,
        )) ? (
        <InferenceIndicator status={inferenceStatus} />
      ) : null}

      {deviceApprovalRequests.length > 0 ? (
        <section className="device-approval-banner" aria-live="polite">
          {deviceApprovalRequests.map((request) => (
            <div key={request.id}>
              <span>
                <strong>Nouvel appareil</strong>
                {request.deviceName}
                {request.requestIp ? ` - ${request.requestIp}` : ''}
              </span>
              <div>
                <button
                  type="button"
                  onClick={() => void approveNewDevice(request.id)}
                >
                  Autoriser
                </button>
                <button
                  type="button"
                  onClick={() => void rejectNewDevice(request.id)}
                >
                  Refuser
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <main>
        <TodayScreen {...controller} />

        <AgendaScreen {...controller} />

        <MaisonScreen {...controller} />
        <CoursesScreen {...controller} />

        {destination === 'budget' && authSession ? (
          <Suspense fallback={<p role="status">Chargement du budget…</p>}>
            <BudgetView
              currentProfileId={authSession.member.profileId}
              otherProfileId={
                authMembers.find(
                  (member) => member.profileId !== authSession.member.profileId,
                )?.profileId ?? null
              }
              quickOpen={budgetQuickAddOpen}
              profileNames={assigneeLabels}
              state={budgetState}
              onChanged={async () => {
                await reloadLocalState();
                void synchronize();
              }}
              onQuickOpenChange={setBudgetQuickAddOpen}
            />
          </Suspense>
        ) : null}

        {destination === 'assistant' ? (
          <Suspense
            fallback={
              <section className="panel">
                <p>Chargement du Chat…</p>
              </section>
            }
          >
            <AssistantView
              createRequest={chatCreateRequest}
              onAvailabilityChange={setChatAvailable}
            />
          </Suspense>
        ) : null}

        {destination === 'watch' ? (
          <Suspense
            fallback={
              <section className="panel">
                <p>Chargement de la Veille…</p>
              </section>
            }
          >
            <WatchView
              creatorOpen={watchCreatorOpen}
              onCreatorOpenChange={setWatchCreatorOpen}
            />
          </Suspense>
        ) : null}

        {destination === 'robot' ? (
          <Suspense
            fallback={
              <section className="panel">
                <p>Chargement du Robot…</p>
              </section>
            }
          >
            <RobotView isOwner={authSession?.member.role === 'owner'} />
          </Suspense>
        ) : null}
      </main>

      {updateAvailable && (
        <aside className="update-banner" aria-live="polite">
          <span>Une mise à jour est prête.</span>
          <button type="button" onClick={() => void updateServiceWorker(true)}>
            Mettre à jour
          </button>
        </aside>
      )}

      {classificationPreviewOpen &&
      groceryClassification.job?.status === 'completed' ? (
        <GroceryClassificationDialog
          busy={groceryClassification.busy}
          items={groceryItems}
          job={groceryClassification.job}
          onApply={(classifications) =>
            void applyGroceryAisleClassification(classifications)
          }
          onClose={() => setClassificationPreviewOpen(false)}
          onDiscard={() => void discardGroceryAisleClassification()}
        />
      ) : null}

      {taskPendingEdit ? (
        <TaskEditorDialog
          task={taskPendingEdit}
          assigneeChoices={assigneeChoices}
          busy={savingEditor}
          onClose={() => setTaskPendingEdit(null)}
          onSave={(input, scope) => void saveTaskEdit(input, scope)}
        />
      ) : null}

      {groceryPendingEdit ? (
        <GroceryEditorDialog
          item={groceryPendingEdit}
          automaticClassification={
            groceryClassifications.find(
              (classification) =>
                classification.itemId === groceryPendingEdit.id,
            ) ?? null
          }
          busy={savingEditor}
          onClose={() => setGroceryPendingEdit(null)}
          onSave={(input) => void saveGroceryEdit(input)}
        />
      ) : null}

      <TaskDeletionDialog {...controller} />

      <SettingsDialog {...controller} />

      {destination !== 'robot' &&
      (destination !== 'assistant' || chatAvailable) ? (
        <button
          className="fab"
          type="button"
          onClick={
            destination === 'groceries'
              ? openGroceryQuickAdd
              : destination === 'assistant'
                ? () => setChatCreateRequest((current) => current + 1)
                : destination === 'budget'
                  ? () => setBudgetQuickAddOpen(true)
                  : destination === 'watch'
                    ? () => setWatchCreatorOpen(true)
                    : openQuickAdd
          }
          aria-label={
            destination === 'watch'
              ? 'Créer une veille'
              : destination === 'assistant'
                ? 'Nouvelle conversation'
                : 'Ajouter rapidement'
          }
        >
          +
        </button>
      ) : null}

      <nav className="bottom-nav" aria-label="Navigation principale">
        <NavButton
          active={destination === 'today'}
          label="Aujourd’hui"
          onClick={() => setDestination('today')}
        />
        <NavButton
          active={destination === 'agenda'}
          label="Agenda"
          onClick={() => setDestination('agenda')}
        />
        <NavButton
          active={destination === 'groceries'}
          label="Maison"
          onClick={() => {
            setMaisonTab('courses');
            setDestination('groceries');
          }}
        />
        <NavButton
          active={destination === 'budget'}
          label="Budget"
          onClick={() => setDestination('budget')}
        />
        <NavButton
          active={destination === 'assistant'}
          label="Chat"
          onClick={() => setDestination('assistant')}
        />
        <NavButton
          active={destination === 'watch'}
          label="Veille"
          onClick={() => setDestination('watch')}
        />
        <NavButton
          active={destination === 'robot'}
          label="Robot"
          onClick={() => setDestination('robot')}
        />
      </nav>
    </div>
  );
}
