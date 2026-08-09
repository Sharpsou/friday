import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import type {
  AuthDevice,
  AuthMember,
  GroceryClassificationRecord,
} from '@friday/contracts';

import { AuthGate } from './auth/AuthGate.js';
import {
  createPairingCode,
  forgetAdult,
  listAuthDevices,
  listAuthMembers,
  revokeAuthDevice,
} from './auth/auth-client.js';
import { useClosedAuth } from './auth/use-closed-auth.js';
import {
  applyAppTheme,
  DEFAULT_APP_PREFERENCES,
  loadAppPreferences,
  saveAppPreferences,
  THEME_OPTIONS,
} from './app-preferences.js';
import {
  createLocalTask,
  deleteLocalTask,
  deleteLocalTaskSeries,
  getOutboxCounts,
  listTasks,
  setLocalTaskStatus,
  updateLocalTask,
  updateLocalTaskSeries,
  type LocalTask,
  type UpdateLocalTaskInput,
} from './db/task-repository.js';
import {
  createLocalGroceryItem,
  deleteLocalGroceryItem,
  listGroceryItems,
  setLocalGroceryItemChecked,
  updateLocalGroceryItem,
  type LocalGroceryItem,
} from './db/grocery-repository.js';
import { listGroceryClassifications } from './db/grocery-classification-repository.js';
import {
  GroceryClassificationDialog,
  GroceryClassificationIndicator,
} from './GroceryClassification.js';
import {
  groupGroceriesByAisle,
  type GroceryAisleGroup,
} from './grocery-classification-groups.js';
import {
  checkForAppUpdate,
  getAppUpdateSnapshot,
  subscribeToAppUpdates,
  updateServiceWorker,
} from './pwa.js';
import { syncGroceryClassifications } from './sync/grocery-classification-client.js';
import {
  AuthenticationRequiredError,
  cancelActiveSync,
  syncNow,
} from './sync/sync-client.js';
import {
  getAssigneeChoices,
  getAssigneeFilters,
  getAssigneeLabel,
  getAssigneeProfileId,
  matchesAssigneeFilter,
  type AssigneeChoice,
  type AssigneeFilter,
} from './task-assignee.js';
import { TaskCalendar } from './TaskCalendar.js';
import { formatTaskRecurrence } from './task-recurrence.js';
import { useGroceryClassification } from './use-grocery-classification.js';
import { ShoppingMode } from './ShoppingMode.js';
import { GroceryEditorDialog, TaskEditorDialog } from './ItemEditorDialogs.js';

type Destination = 'today' | 'agenda' | 'groceries' | 'watch';
type TaskView = 'list' | 'week' | 'month';
type RecurrenceChoice =
  'none' | 'daily' | 'weekly' | 'custom-days' | 'monthly' | 'yearly';

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
  const auth = useClosedAuth();
  const authSession = auth.session;
  const refreshAuth = auth.refresh;
  const [destination, setDestination] = useState<Destination>('today');
  const [taskView, setTaskView] = useState<TaskView>('list');
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [groceryItems, setGroceryItems] = useState<LocalGroceryItem[]>([]);
  const [groceryClassifications, setGroceryClassifications] = useState<
    GroceryClassificationRecord[]
  >([]);
  const [classificationPreviewOpen, setClassificationPreviewOpen] =
    useState(false);
  const [groceryLabel, setGroceryLabel] = useState('');
  const [groceryQuantity, setGroceryQuantity] = useState('');
  const [editingGroceries, setEditingGroceries] = useState(false);
  const [shoppingModeInitialCount, setShoppingModeInitialCount] = useState<
    number | null
  >(null);
  const [groceryPendingEdit, setGroceryPendingEdit] =
    useState<LocalGroceryItem | null>(null);
  const [changingGroceryItemId, setChangingGroceryItemId] = useState<
    string | null
  >(null);
  const [editingTasks, setEditingTasks] = useState(false);
  const [taskPendingEdit, setTaskPendingEdit] = useState<LocalTask | null>(
    null,
  );
  const [savingEditor, setSavingEditor] = useState(false);
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
  const [preferences, setPreferences] = useState(DEFAULT_APP_PREFERENCES);
  const [preferencesDraft, setPreferencesDraft] = useState(
    DEFAULT_APP_PREFERENCES,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authDevices, setAuthDevices] = useState<AuthDevice[]>([]);
  const [authMembers, setAuthMembers] = useState<AuthMember[]>([]);
  const [pairingCode, setPairingCode] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [authManagementMessage, setAuthManagementMessage] = useState<
    string | null
  >(null);
  const [confirmAdultForget, setConfirmAdultForget] = useState(false);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [hubReachable, setHubReachable] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const updateAvailable = useSyncExternalStore(
    subscribeToAppUpdates,
    getAppUpdateSnapshot,
    getAppUpdateSnapshot,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const groceryInputRef = useRef<HTMLInputElement>(null);
  const scheduleDetailsRef = useRef<HTMLDetailsElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const deletionCancelRef = useRef<HTMLButtonElement>(null);
  const groceryClassification = useGroceryClassification(authSession !== null);

  const assigneeLabels = useMemo(
    () => ({
      current: preferences.currentResponsibleName,
      other: preferences.otherResponsibleName,
    }),
    [preferences.currentResponsibleName, preferences.otherResponsibleName],
  );
  const assigneeChoices = useMemo(
    () => getAssigneeChoices(assigneeLabels),
    [assigneeLabels],
  );
  const assigneeFilters = useMemo(
    () => getAssigneeFilters(assigneeLabels),
    [assigneeLabels],
  );

  const reloadLocalState = useCallback(async () => {
    const [localTasks, localGroceryItems, localGroceryClassifications, counts] =
      await Promise.all([
        listTasks(),
        listGroceryItems(),
        listGroceryClassifications(),
        getOutboxCounts(),
      ]);
    setTasks(localTasks);
    setGroceryItems(localGroceryItems);
    setGroceryClassifications(localGroceryClassifications);
    setPending(counts.pending);
    setConflicts(counts.conflicts);
    return localTasks;
  }, []);

  const synchronize = useCallback(
    async (forceAttempt = false) => {
      if (!authSession) {
        setHubReachable(null);
        return;
      }
      if (!forceAttempt && !navigator.onLine) {
        setHubReachable(false);
        await reloadLocalState();
        return;
      }

      setSyncing(true);
      try {
        const result = await syncNow();
        await syncGroceryClassifications().catch(() => undefined);
        setHubReachable(true);
        setLastSync(result.syncedAt);
        await reloadLocalState();
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) {
          await refreshAuth();
        }
        const browserOnline = navigator.onLine;
        setOnline(browserOnline);
        setHubReachable(false);
        await reloadLocalState();
      } finally {
        setSyncing(false);
      }
    },
    [authSession, refreshAuth, reloadLocalState],
  );

  const reloadAuthManagement = useCallback(async () => {
    if (!authSession || !navigator.onLine) return;
    try {
      const [members, devices] = await Promise.all([
        listAuthMembers(),
        listAuthDevices(),
      ]);
      setAuthMembers(members);
      setAuthDevices(devices);
    } catch {
      // The cached profile remains sufficient for offline task access.
    }
  }, [authSession]);

  useEffect(() => {
    window.queueMicrotask(() => {
      void reloadLocalState();
      void synchronize();
      void checkForAppUpdate();
      void loadAppPreferences().then((storedPreferences) => {
        setPreferences(storedPreferences);
        setPreferencesDraft(storedPreferences);
        applyAppTheme(storedPreferences.theme);
      });
    });
    if (navigator.storage?.persist) void navigator.storage.persist();
  }, [reloadLocalState, synchronize]);

  useEffect(() => {
    window.queueMicrotask(() => void reloadAuthManagement());
  }, [reloadAuthManagement]);

  useEffect(() => {
    if (!settingsOpen) return;
    settingsCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => {
    if (!taskPendingDeletion) return;
    deletionCancelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && deletingTaskId === null) {
        setTaskPendingDeletion(null);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deletingTaskId, taskPendingDeletion]);

  useEffect(() => {
    let onlineSyncTimer: number | undefined;
    const onOnline = () => {
      setOnline(true);
      setHubReachable(null);
      window.clearTimeout(onlineSyncTimer);
      onlineSyncTimer = window.setTimeout(() => {
        void (async () => {
          await cancelActiveSync();
          if (navigator.onLine) {
            await Promise.all([synchronize(true), checkForAppUpdate()]);
          }
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
      if (document.visibilityState === 'visible') {
        void synchronize();
        void checkForAppUpdate();
      }
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void synchronize();
    }, 60_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(onlineSyncTimer);
      window.clearInterval(timer);
    };
  }, [synchronize]);

  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status !== 'done'),
    [tasks],
  );

  const filteredTasks = useMemo(
    () =>
      tasks.filter((task) =>
        matchesAssigneeFilter(task.assigneeProfileId, assigneeFilter),
      ),
    [assigneeFilter, tasks],
  );

  const { filteredActiveTasks, filteredCompletedTasks } = useMemo(() => {
    const active: LocalTask[] = [];
    const completed: LocalTask[] = [];
    for (const task of filteredTasks) {
      if (task.status === 'done') completed.push(task);
      else active.push(task);
    }
    return {
      filteredActiveTasks: active,
      filteredCompletedTasks: completed,
    };
  }, [filteredTasks]);

  const { purchasedGroceryItems, unpurchasedGroceryItems } = useMemo(() => {
    const purchased: LocalGroceryItem[] = [];
    const unpurchased: LocalGroceryItem[] = [];
    for (const item of groceryItems) {
      if (item.checkedAt) purchased.push(item);
      else unpurchased.push(item);
    }
    return {
      purchasedGroceryItems: purchased,
      unpurchasedGroceryItems: unpurchased,
    };
  }, [groceryItems]);

  const groceryAisleGroups = useMemo(
    () =>
      groupGroceriesByAisle(unpurchasedGroceryItems, groceryClassifications),
    [groceryClassifications, unpurchasedGroceryItems],
  );

  const closeShoppingMode = useCallback(
    () => setShoppingModeInitialCount(null),
    [],
  );

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

  async function submitGroceryItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await cancelActiveSync();
      setSyncing(false);
      await createLocalGroceryItem({
        label: groceryLabel,
        quantityText: groceryQuantity,
      });
      setGroceryLabel('');
      setGroceryQuantity('');
      setMessage('Produit ajouté sur cet appareil.');
      await reloadLocalState();
      void synchronize();
      window.setTimeout(() => groceryInputRef.current?.focus(), 0);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Ajout du produit impossible',
      );
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

  async function changeGroceryItemState(itemId: string, checked: boolean) {
    setChangingGroceryItemId(itemId);
    try {
      await cancelActiveSync();
      setSyncing(false);
      await setLocalGroceryItemChecked(itemId, checked);
      setMessage(
        checked
          ? 'Produit marqué comme acheté sur cet appareil.'
          : 'Produit remis dans la liste sur cet appareil.',
      );
      await reloadLocalState();
      void synchronize();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Modification impossible',
      );
    } finally {
      setChangingGroceryItemId(null);
    }
  }

  async function deleteGroceryItem(itemId: string) {
    setChangingGroceryItemId(itemId);
    try {
      await cancelActiveSync();
      setSyncing(false);
      await deleteLocalGroceryItem(itemId);
      setMessage('Produit supprimé sur cet appareil.');
      await reloadLocalState();
      if (groceryItems.length <= 1) setEditingGroceries(false);
      void synchronize();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Suppression impossible',
      );
    } finally {
      setChangingGroceryItemId(null);
    }
  }

  async function startGroceryAisleClassification() {
    if (!navigator.onLine || hubReachable === false) {
      setMessage(
        'Le classement par rayon nécessite le hub. La liste reste disponible hors ligne.',
      );
      return;
    }
    try {
      await synchronize(true);
      const job = await groceryClassification.start();
      setMessage(
        job.status === 'completed'
          ? 'Le classement est prêt à être vérifié.'
          : 'Le classement tourne en arrière-plan. Vous pouvez continuer à utiliser Friday.',
      );
      if (job.status === 'completed') setClassificationPreviewOpen(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Impossible de lancer le classement.',
      );
    }
  }

  async function saveGroceryEdit(input: {
    aisleId: string | null;
    label: string;
    quantityText: string;
    storeFamilyId: string | null;
  }) {
    if (!groceryPendingEdit) return;
    setSavingEditor(true);
    try {
      await cancelActiveSync();
      setSyncing(false);
      await updateLocalGroceryItem(groceryPendingEdit.id, input);
      setMessage('Produit modifié sur cet appareil.');
      setGroceryPendingEdit(null);
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

  async function stopGroceryAisleClassification() {
    try {
      const job = await groceryClassification.cancel();
      setMessage(
        job?.status === 'cancelled'
          ? 'Classement interrompu. La liste n’a pas été modifiée.'
          : 'Arrêt du classement demandé.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Impossible d’arrêter le classement.',
      );
    }
  }

  async function applyGroceryAisleClassification(
    classifications: Parameters<typeof groceryClassification.apply>[0],
  ) {
    try {
      const response = await groceryClassification.apply(classifications);
      const classificationCacheUpdated = await syncGroceryClassifications()
        .then(() => true)
        .catch(() => false);
      await reloadLocalState();
      setClassificationPreviewOpen(false);
      setMessage(
        !classificationCacheUpdated
          ? 'Classement appliqué. Il apparaîtra après la prochaine synchronisation.'
          : response.skippedItemIds.length === 0
            ? 'Classement appliqué et partagé avec le foyer.'
            : `Classement appliqué. ${response.skippedItemIds.length.toString()} produit${response.skippedItemIds.length > 1 ? 's modifiés ont' : ' modifié a'} été ignoré${response.skippedItemIds.length > 1 ? 's' : ''}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Impossible d’appliquer le classement.',
      );
    }
  }

  function openQuickAdd() {
    setEditingTasks(false);
    setTaskView('list');
    setDestination('agenda');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function openQuickAddForDate(date: string) {
    setEditingTasks(false);
    setTaskView('list');
    setDestination('agenda');
    setDueDate(date);
    setDueTime('');
    setDurationMinutes('');
    setRecurrenceChoice('none');
    setRecurrenceEndDate('');
    window.setTimeout(() => {
      if (scheduleDetailsRef.current) scheduleDetailsRef.current.open = true;
      inputRef.current?.focus();
    }, 0);
  }

  function openGroceryQuickAdd() {
    setEditingGroceries(false);
    setDestination('groceries');
    window.setTimeout(() => groceryInputRef.current?.focus(), 0);
  }

  function openSettings() {
    setPreferencesDraft(preferences);
    setAuthManagementMessage(null);
    setConfirmAdultForget(false);
    setSettingsOpen(true);
    void reloadAuthManagement();
  }

  async function generatePairingCode() {
    try {
      setPairingCode(await createPairingCode());
      setAuthManagementMessage(
        'Code créé. Il est valable dix minutes et une seule fois.',
      );
    } catch (error) {
      setAuthManagementMessage(
        error instanceof Error ? error.message : 'Création du code impossible.',
      );
    }
  }

  async function revokeDevice(deviceId: string) {
    try {
      await revokeAuthDevice(deviceId);
      setAuthManagementMessage('Appareil révoqué. Ses sessions sont fermées.');
      await reloadAuthManagement();
    } catch (error) {
      setAuthManagementMessage(
        error instanceof Error ? error.message : 'Révocation impossible.',
      );
    }
  }

  async function forgetSecondAdult() {
    try {
      await forgetAdult();
      setConfirmAdultForget(false);
      setPairingCode(null);
      setAuthManagementMessage(
        'Second adulte oublié. Vous pouvez maintenant créer un nouveau code.',
      );
      await reloadAuthManagement();
    } catch (error) {
      setAuthManagementMessage(
        error instanceof Error
          ? error.message
          : 'Suppression du second adulte impossible.',
      );
    }
  }

  async function submitPreferences(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const savedPreferences = await saveAppPreferences(preferencesDraft);
      setPreferences(savedPreferences);
      setPreferencesDraft(savedPreferences);
      applyAppTheme(savedPreferences.theme);
      setSettingsOpen(false);
      setMessage('Réglages enregistrés sur cet appareil.');
    } catch {
      setMessage('Impossible d’enregistrer les réglages sur cet appareil.');
    }
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
      <header className="topbar">
        <h1>Friday</h1>
        <div className="topbar-actions">
          <button
            className={`status-pill ${connectionTone}`}
            type="button"
            onClick={() => {
              void synchronize();
              void checkForAppUpdate(true);
            }}
            disabled={syncing}
          >
            <span aria-hidden="true" />
            {connectionLabel}
          </button>
          <button
            className="settings-button"
            type="button"
            aria-label="Ouvrir les réglages"
            onClick={openSettings}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </header>

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

            <section
              className="panel grocery-summary-panel"
              aria-label="Courses"
            >
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

        {destination === 'agenda' && (
          <section className="screen" aria-labelledby="agenda-title">
            <div className="section-heading page-heading">
              <div>
                <span className="eyebrow">Planification</span>
                <h2 id="agenda-title">Agenda</h2>
              </div>
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

            <div className="task-filter-row">
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
                      directement. Les séries proposent une occurrence ou toute
                      la série.
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
                                setRecurrenceChoice('none');
                                setRecurrenceEndDate('');
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
                            <option value="custom-days">
                              Tous les N jours
                            </option>
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
                          <label htmlFor="task-recurrence-end">
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
                view={taskView}
                onAddForDate={openQuickAddForDate}
                assigneeLabels={assigneeLabels}
              />
            )}
          </section>
        )}

        {destination === 'groceries' && (
          <section className="screen" aria-labelledby="groceries-title">
            <div className="section-heading page-heading">
              <div>
                <span className="eyebrow">Liste partagée</span>
                <h2 id="groceries-title">Courses</h2>
              </div>
              <div className="page-actions">
                <span className="count-badge">{groceryItems.length}</span>
                {groceryItems.length > 0 ? (
                  <button
                    className="edit-toggle"
                    type="button"
                    aria-pressed={editingGroceries}
                    onClick={() => setEditingGroceries((current) => !current)}
                  >
                    {editingGroceries ? 'Terminer' : 'Modifier'}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grocery-classification-toolbar">
              <button
                className="shopping-mode-button"
                type="button"
                disabled={unpurchasedGroceryItems.length === 0}
                onClick={() =>
                  setShoppingModeInitialCount(unpurchasedGroceryItems.length)
                }
              >
                En course
              </button>
              <button
                className="classify-groceries-button"
                type="button"
                disabled={
                  unpurchasedGroceryItems.length === 0 ||
                  groceryClassification.busy ||
                  ['queued', 'running', 'cancelling'].includes(
                    groceryClassification.job?.status ?? '',
                  )
                }
                title={
                  !online || hubReachable !== true
                    ? 'Le classement nécessite le hub.'
                    : undefined
                }
                onClick={() => {
                  if (groceryClassification.job?.status === 'completed') {
                    setClassificationPreviewOpen(true);
                  } else {
                    void startGroceryAisleClassification();
                  }
                }}
              >
                {groceryClassification.job?.status === 'completed'
                  ? 'Vérifier le classement'
                  : 'Classer par rayon'}
              </button>
            </div>

            <GroceryView
              aisleGroups={groceryAisleGroups}
              changingItemId={changingGroceryItemId}
              editing={editingGroceries}
              inputRef={groceryInputRef}
              label={groceryLabel}
              purchasedItems={purchasedGroceryItems}
              quantity={groceryQuantity}
              onCheckedChange={(itemId, checked) =>
                void changeGroceryItemState(itemId, checked)
              }
              onDelete={(itemId) => void deleteGroceryItem(itemId)}
              onEdit={setGroceryPendingEdit}
              onLabelChange={setGroceryLabel}
              onQuantityChange={setGroceryQuantity}
              onSubmit={(event) => void submitGroceryItem(event)}
            />
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

      {settingsOpen ? (
        <div
          className="settings-backdrop"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-heading">
              <div>
                <span className="eyebrow">Préférences locales</span>
                <h2 id="settings-title">Réglages</h2>
              </div>
              <button
                ref={settingsCloseRef}
                type="button"
                aria-label="Fermer les réglages"
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={(event) => void submitPreferences(event)}>
              <fieldset>
                <legend>Foyer et appareils</legend>
                <p>
                  Connecté comme {authenticatedSession.member.name} ·{' '}
                  {authenticatedSession.member.role === 'owner'
                    ? 'Propriétaire'
                    : 'Adulte'}
                </p>
                {authenticatedSession.member.role === 'owner' &&
                !authDevices.some(
                  (device) => !device.current && !device.revokedAt,
                ) ? (
                  <button
                    className="secondary-button auth-settings-button"
                    type="button"
                    onClick={() => void generatePairingCode()}
                  >
                    {authMembers.length < 2
                      ? 'Ajouter le second adulte'
                      : 'Réappairer le second adulte'}
                  </button>
                ) : null}
                {pairingCode ? (
                  <div className="pairing-code" role="status">
                    <span>Code temporaire</span>
                    <strong>{pairingCode.code}</strong>
                    <small>
                      Expire à{' '}
                      {new Date(pairingCode.expiresAt).toLocaleTimeString(
                        'fr-FR',
                        { hour: '2-digit', minute: '2-digit' },
                      )}
                    </small>
                  </div>
                ) : null}
                {authDevices.length > 0 ? (
                  <ul className="auth-device-list">
                    {authDevices.map((device) => (
                      <li key={device.id}>
                        <span>
                          <strong>{device.name}</strong>
                          <small>
                            {device.memberName}
                            {device.current ? ' · Cet appareil' : ''}
                            {device.revokedAt ? ' · Révoqué' : ''}
                          </small>
                        </span>
                        {authenticatedSession.member.role === 'owner' &&
                        !device.current &&
                        !device.revokedAt ? (
                          <button
                            type="button"
                            onClick={() => void revokeDevice(device.id)}
                          >
                            Révoquer
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {authenticatedSession.member.role === 'owner' &&
                authMembers.some((member) => member.role === 'adult') &&
                !authDevices.some(
                  (device) => !device.current && !device.revokedAt,
                ) ? (
                  confirmAdultForget ? (
                    <div className="adult-forget-confirmation" role="alert">
                      <p>
                        L’identifiant et la phrase secrète de l’ancien adulte
                        seront supprimés. Les données partagées et les tâches
                        attribuées au second adulte restent conservées.
                      </p>
                      <div>
                        <button
                          type="button"
                          onClick={() => setConfirmAdultForget(false)}
                        >
                          Annuler
                        </button>
                        <button
                          className="delete-series-button"
                          type="button"
                          onClick={() => void forgetSecondAdult()}
                        >
                          Confirmer l’oubli
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="secondary-button auth-settings-button"
                      type="button"
                      onClick={() => setConfirmAdultForget(true)}
                    >
                      Oublier le second adulte
                    </button>
                  )
                ) : null}
                {authManagementMessage ? (
                  <p role="status">{authManagementMessage}</p>
                ) : null}
                <button
                  className="secondary-button auth-settings-button"
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    void auth.logout();
                  }}
                >
                  Se déconnecter
                </button>
              </fieldset>
              <fieldset>
                <legend>Responsables</legend>
                <p>
                  Les noms changent seulement l’affichage. Les tâches gardent
                  leur responsable.
                </p>
                <label htmlFor="current-responsible-name">
                  <span>Premier responsable</span>
                  <input
                    id="current-responsible-name"
                    maxLength={40}
                    required
                    value={preferencesDraft.currentResponsibleName}
                    onChange={(event) =>
                      setPreferencesDraft((current) => ({
                        ...current,
                        currentResponsibleName: event.target.value,
                      }))
                    }
                  />
                </label>
                <label htmlFor="other-responsible-name">
                  <span>Deuxième responsable</span>
                  <input
                    id="other-responsible-name"
                    maxLength={40}
                    required
                    value={preferencesDraft.otherResponsibleName}
                    onChange={(event) =>
                      setPreferencesDraft((current) => ({
                        ...current,
                        otherResponsibleName: event.target.value,
                      }))
                    }
                  />
                </label>
              </fieldset>
              <fieldset>
                <legend>Palette de couleurs</legend>
                <div className="palette-grid">
                  {THEME_OPTIONS.map((theme) => (
                    <label
                      className={`palette-option is-${theme.value}`}
                      key={theme.value}
                    >
                      <input
                        type="radio"
                        name="theme"
                        value={theme.value}
                        checked={preferencesDraft.theme === theme.value}
                        onChange={() =>
                          setPreferencesDraft((current) => ({
                            ...current,
                            theme: theme.value,
                          }))
                        }
                      />
                      <span className="palette-swatches" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <strong>{theme.label}</strong>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Nombre de tâches affichées</legend>
                <label htmlFor="today-task-limit">
                  <span>Aujourd’hui</span>
                  <input
                    id="today-task-limit"
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={preferencesDraft.todayTaskLimit}
                    onChange={(event) =>
                      setPreferencesDraft((current) => ({
                        ...current,
                        todayTaskLimit: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label htmlFor="home-task-limit">
                  <span>Chaque liste Agenda</span>
                  <input
                    id="home-task-limit"
                    type="number"
                    min="1"
                    max="200"
                    required
                    value={preferencesDraft.homeTaskLimit}
                    onChange={(event) =>
                      setPreferencesDraft((current) => ({
                        ...current,
                        homeTaskLimit: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </fieldset>
              <div className="settings-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                >
                  Annuler
                </button>
                <button className="primary-button" type="submit">
                  Enregistrer
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <button
        className="fab"
        type="button"
        onClick={
          destination === 'groceries' ? openGroceryQuickAdd : openQuickAdd
        }
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
          active={destination === 'agenda'}
          label="Agenda"
          onClick={() => setDestination('agenda')}
        />
        <NavButton
          active={destination === 'groceries'}
          label="Courses"
          onClick={() => setDestination('groceries')}
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

function GroceryView({
  aisleGroups,
  changingItemId,
  editing,
  inputRef,
  label,
  purchasedItems,
  quantity,
  onCheckedChange,
  onDelete,
  onEdit,
  onLabelChange,
  onQuantityChange,
  onSubmit,
}: {
  aisleGroups: readonly GroceryAisleGroup[];
  changingItemId: string | null;
  editing: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  label: string;
  purchasedItems: readonly LocalGroceryItem[];
  quantity: string;
  onCheckedChange: (itemId: string, checked: boolean) => void;
  onDelete: (itemId: string) => void;
  onEdit: (item: LocalGroceryItem) => void;
  onLabelChange: (value: string) => void;
  onQuantityChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <>
      {editing ? (
        <div className="edit-notice" role="status">
          <strong>Mode modification</strong>
          <span>
            Touchez un produit pour modifier son nom, sa quantité ou son rayon.
            Le bouton Supprimer reste disponible directement.
          </span>
        </div>
      ) : (
        <form className="quick-form grocery-form" onSubmit={onSubmit}>
          <label htmlFor="grocery-label">Ajouter un produit</label>
          <div className="grocery-input-row">
            <input
              ref={inputRef}
              id="grocery-label"
              value={label}
              maxLength={200}
              autoComplete="off"
              placeholder="Ex. Lait"
              onChange={(event) => onLabelChange(event.target.value)}
            />
            <input
              aria-label="Quantité facultative"
              value={quantity}
              maxLength={80}
              autoComplete="off"
              placeholder="Quantité (facultatif)"
              onChange={(event) => onQuantityChange(event.target.value)}
            />
            <button type="submit" disabled={!label.trim()}>
              Ajouter
            </button>
          </div>
          <p>Le produit apparaît immédiatement, même hors connexion.</p>
        </form>
      )}

      {aisleGroups.length === 0 ? (
        <section className="panel grocery-panel">
          <p className="empty-state">La liste de courses est vide.</p>
        </section>
      ) : (
        <div className="grocery-aisle-groups" aria-label="Courses par rayon">
          {aisleGroups.map((group) => (
            <section className="panel grocery-panel aisle-panel" key={group.id}>
              <div className="task-section-heading">
                <div>
                  {group.familyLabel ? (
                    <small>{group.familyLabel}</small>
                  ) : null}
                  <h3>{group.label}</h3>
                </div>
                <span className="count-badge">{group.items.length}</span>
              </div>
              <GroceryList
                items={group.items}
                editing={editing}
                changingItemId={changingItemId}
                onDelete={onDelete}
                onEdit={onEdit}
                onCheckedChange={onCheckedChange}
                emptyMessage=""
              />
            </section>
          ))}
        </div>
      )}

      <section
        className="panel grocery-panel purchased-grocery-panel"
        aria-labelledby="grocery-purchased-title"
      >
        <div className="task-section-heading">
          <h3 id="grocery-purchased-title">Déjà acheté</h3>
          <span className="count-badge">{purchasedItems.length}</span>
        </div>
        <GroceryList
          items={purchasedItems}
          editing={editing}
          changingItemId={changingItemId}
          onDelete={onDelete}
          onEdit={onEdit}
          onCheckedChange={onCheckedChange}
          emptyMessage="Aucun produit acheté."
        />
      </section>
    </>
  );
}

function GroceryList({
  items,
  changingItemId,
  editing,
  emptyMessage,
  onCheckedChange,
  onDelete,
  onEdit,
}: {
  items: readonly LocalGroceryItem[];
  changingItemId: string | null;
  editing: boolean;
  emptyMessage: string;
  onCheckedChange: (itemId: string, checked: boolean) => void;
  onDelete: (itemId: string) => void;
  onEdit: (item: LocalGroceryItem) => void;
}) {
  if (items.length === 0) return <p className="empty-state">{emptyMessage}</p>;

  return (
    <ul className="grocery-list">
      {items.map((item) => {
        const checked = item.checkedAt !== null;
        return (
          <li className={checked ? 'is-checked' : ''} key={item.id}>
            {!editing ? (
              <button
                className="grocery-check-button"
                type="button"
                aria-label={`${checked ? 'Remettre' : 'Marquer comme acheté'} ${item.label}`}
                disabled={changingItemId !== null}
                onClick={() => onCheckedChange(item.id, !checked)}
              >
                <span aria-hidden="true">{checked ? '✓' : ''}</span>
              </button>
            ) : null}
            {editing ? (
              <button
                className="item-edit-target grocery-copy"
                type="button"
                aria-label={`Modifier ${item.label}`}
                onClick={() => onEdit(item)}
              >
                <strong>{item.label}</strong>
                {item.quantityText ? <small>{item.quantityText}</small> : null}
                <small className={`task-sync is-${item.syncState}`}>
                  {TASK_SYNC_LABELS[item.syncState]}
                </small>
              </button>
            ) : (
              <span className="grocery-copy">
                <strong>{item.label}</strong>
                {item.quantityText ? <small>{item.quantityText}</small> : null}
                <small className={`task-sync is-${item.syncState}`}>
                  {TASK_SYNC_LABELS[item.syncState]}
                </small>
              </span>
            )}
            {editing ? (
              <button
                className="delete-task-button"
                type="button"
                aria-label={`Supprimer ${item.label}`}
                disabled={changingItemId !== null}
                onClick={() => onDelete(item.id)}
              >
                {changingItemId === item.id ? 'Suppression…' : 'Supprimer'}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function TaskList({
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
