import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  listAuthDevices,
  listAuthMembers,
  listDeviceApprovalRequests,
} from '../auth/auth-client.js';
import { useClosedAuth } from '../auth/use-closed-auth.js';
import { type LocalGroceryItem } from '../db/grocery-repository.js';
import { type LocalTask } from '../db/task-repository.js';
import { groupGroceriesByAisle } from '../grocery-classification-groups.js';
import { getAppUpdateSnapshot, subscribeToAppUpdates } from '../pwa.js';
import {
  getAssigneeChoices,
  getAssigneeFilters,
  matchesAssigneeFilter,
} from '../task-assignee.js';
import { useGroceryClassification } from '../use-grocery-classification.js';

import { createAccountActions } from './account-actions.js';
import { createClassificationActions } from './classification-actions.js';
import { createGroceryActions } from './grocery-actions.js';
import { createNavigationActions } from './navigation-actions.js';
import { createPreferencesActions } from './preferences-actions.js';
import { createRobotSettingsActions } from './robot-settings-actions.js';
import { createTaskActions } from './task-actions.js';
import { useAccountsState } from './use-accounts-state.js';
import { useAppLifecycle } from './use-app-lifecycle.js';
import { useAppSync } from './use-app-sync.js';
import { useConnectionState } from './use-connection-state.js';
import { useGroceriesState } from './use-groceries-state.js';
import { useLocalDataState } from './use-local-data-state.js';
import { useLocalData } from './use-local-data.js';
import { useNavigationState } from './use-navigation-state.js';
import { usePreferencesState } from './use-preferences-state.js';
import { useRobotSettingsState } from './use-robot-settings-state.js';
import { useTaskFormState } from './use-task-form-state.js';
export type { RecurrenceChoice } from './controller-records.js';
export function useAppController() {
  const auth = useClosedAuth();
  const authSession = auth.session;
  const refreshAuth = auth.refresh;
  const {
    destination,
    setDestination,
    maisonTab,
    setMaisonTab,
    showMenus,
    setShowMenus,
    focusMealId,
    setFocusMealId,
    taskView,
    setTaskView,
    budgetQuickAddOpen,
    setBudgetQuickAddOpen,
    watchCreatorOpen,
    setWatchCreatorOpen,
    chatCreateRequest,
    setChatCreateRequest,
    chatAvailable,
    setChatAvailable,
  } = useNavigationState();
  const {
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
  } = useTaskFormState();
  const {
    classificationPreviewOpen,
    setClassificationPreviewOpen,
    groceryLabel,
    setGroceryLabel,
    groceryQuantity,
    setGroceryQuantity,
    editingGroceries,
    setEditingGroceries,
    shoppingModeInitialCount,
    setShoppingModeInitialCount,
    groceryPendingEdit,
    setGroceryPendingEdit,
    changingGroceryItemId,
    setChangingGroceryItemId,
    groceryInputRef,
  } = useGroceriesState();
  const {
    preferences,
    setPreferences,
    preferencesDraft,
    setPreferencesDraft,
    settingsOpen,
    setSettingsOpen,
    settingsCloseRef,
  } = usePreferencesState();
  const {
    authDevices,
    setAuthDevices,
    deviceApprovalRequests,
    setDeviceApprovalRequests,
    authMembers,
    setAuthMembers,
    pairingCode,
    setPairingCode,
    authManagementMessage,
    setAuthManagementMessage,
    confirmAdultForget,
    setConfirmAdultForget,
  } = useAccountsState();
  const {
    robotBandwidth,
    setRobotBandwidth,
    robotSettingsBusy,
    setRobotSettingsBusy,
    robotSettingsMessage,
    setRobotSettingsMessage,
    robotPurgeConfirmation,
    setRobotPurgeConfirmation,
  } = useRobotSettingsState();
  const {
    maisonRecords,
    setMaisonRecords,
    tasks,
    setTasks,
    groceryItems,
    setGroceryItems,
    groceryClassifications,
    setGroceryClassifications,
    budgetState,
    setBudgetState,
    pending,
    setPending,
    conflicts,
    setConflicts,
  } = useLocalDataState();
  const {
    inferenceStatus,
    setInferenceStatus,
    online,
    setOnline,
    hubReachable,
    setHubReachable,
    lastSync,
    setLastSync,
    syncing,
    setSyncing,
  } = useConnectionState();

  const [savingEditor, setSavingEditor] = useState(false);

  const [message, setMessage] = useState<string | null>(null);

  const updateAvailable = useSyncExternalStore(
    subscribeToAppUpdates,
    getAppUpdateSnapshot,
    getAppUpdateSnapshot,
  );

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
  const { reloadLocalState } = useLocalData({
    setMaisonRecords,
    setTasks,
    setGroceryItems,
    setGroceryClassifications,
    setBudgetState,
    setPending,
    setConflicts,
  });
  const { synchronize } = useAppSync({
    authSession,
    setHubReachable,
    reloadLocalState,
    setSyncing,
    setLastSync,
    refreshAuth,
    setOnline,
  });
  const reloadAuthManagement = useCallback(async () => {
    if (!authSession || !navigator.onLine) return;
    try {
      const [members, devices, approvalRequests] = await Promise.all([
        listAuthMembers(),
        listAuthDevices(),
        listDeviceApprovalRequests(),
      ]);
      setAuthMembers(members);
      setAuthDevices(devices);
      setDeviceApprovalRequests(approvalRequests);
    } catch {
      // The cached profile remains sufficient for offline task access.
    }
  }, [authSession, setAuthDevices, setAuthMembers, setDeviceApprovalRequests]);
  useAppLifecycle({
    reloadLocalState,
    synchronize,
    setPreferences,
    setPreferencesDraft,
    reloadAuthManagement,
    authSession,
    setInferenceStatus,
    settingsOpen,
    settingsCloseRef,
    setSettingsOpen,
    setRobotBandwidth,
    setRobotSettingsMessage,
    taskPendingDeletion,
    deletionCancelRef,
    deletingTaskId,
    setTaskPendingDeletion,
    setOnline,
    setHubReachable,
    setSyncing,
  });

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
    [setShoppingModeInitialCount],
  );

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
  const {
    submitTask,
    requestTaskDeletion,
    deleteTask,
    changeTaskStatus,
    saveTaskEdit,
  } = createTaskActions({
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
  });
  const {
    submitGroceryItem,
    importGroceryPhotoItems,
    changeGroceryItemState,
    deleteGroceryItem,
    saveGroceryEdit,
  } = createGroceryActions({
    setSyncing,
    groceryLabel,
    groceryQuantity,
    setGroceryLabel,
    setGroceryQuantity,
    setMessage,
    reloadLocalState,
    synchronize,
    groceryInputRef,
    setChangingGroceryItemId,
    groceryItems,
    setEditingGroceries,
    groceryPendingEdit,
    setSavingEditor,
    setGroceryPendingEdit,
  });
  const {
    startGroceryAisleClassification,
    stopGroceryAisleClassification,
    applyGroceryAisleClassification,
    discardGroceryAisleClassification,
  } = createClassificationActions({
    hubReachable,
    setMessage,
    synchronize,
    groceryClassification,
    setClassificationPreviewOpen,
    reloadLocalState,
  });
  const { openMeal, openQuickAdd, openQuickAddForDate, openGroceryQuickAdd } =
    createNavigationActions({
      setFocusMealId,
      setMaisonTab,
      setDestination,
      setEditingTasks,
      setTaskView,
      inputRef,
      setDueDate,
      setDueTime,
      setDurationMinutes,
      setRecurrenceChoice,
      setRecurrenceEndDate,
      scheduleDetailsRef,
      setEditingGroceries,
      groceryInputRef,
    });
  const { openSettings, submitPreferences } = createPreferencesActions({
    setPreferencesDraft,
    preferences,
    setAuthManagementMessage,
    setConfirmAdultForget,
    setRobotPurgeConfirmation,
    setRobotSettingsMessage,
    setSettingsOpen,
    reloadAuthManagement,
    preferencesDraft,
    setPreferences,
    setMessage,
  });
  const {
    generatePairingCode,
    revokeDevice,
    approveNewDevice,
    rejectNewDevice,
    forgetSecondAdult,
  } = createAccountActions({
    setPairingCode,
    setAuthManagementMessage,
    reloadAuthManagement,
    setConfirmAdultForget,
  });
  const { changeRobotBandwidth, purgeRobotPlaces } = createRobotSettingsActions(
    {
      setRobotSettingsBusy,
      setRobotSettingsMessage,
      setRobotBandwidth,
      setRobotPurgeConfirmation,
    },
  );
  return {
    authSession,
    auth,
    shoppingModeInitialCount,
    groceryAisleGroups,
    changingGroceryItemId,
    changeGroceryItemState,
    closeShoppingMode,
    destination,
    groceryItems,
    editingGroceries,
    setEditingGroceries,
    connectionTone,
    synchronize,
    syncing,
    connectionLabel,
    openSettings,
    groceryClassification,
    setDestination,
    setClassificationPreviewOpen,
    startGroceryAisleClassification,
    stopGroceryAisleClassification,
    inferenceStatus,
    deviceApprovalRequests,
    approveNewDevice,
    rejectNewDevice,
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
    budgetState,
    conflicts,
    pending,
    lastSync,
    showMenus,
    setShowMenus,
    taskView,
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
    deletingTaskId,
    requestTaskDeletion,
    setTaskPendingEdit,
    filteredCompletedTasks,
    openQuickAddForDate,
    maisonTab,
    setMaisonTab,
    setFocusMealId,
    focusMealId,
    online,
    hubReachable,
    reloadLocalState,
    setShoppingModeInitialCount,
    importGroceryPhotoItems,
    groceryInputRef,
    groceryLabel,
    purchasedGroceryItems,
    groceryQuantity,
    deleteGroceryItem,
    setGroceryPendingEdit,
    setGroceryLabel,
    setGroceryQuantity,
    submitGroceryItem,
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
    taskPendingDeletion,
    setTaskPendingDeletion,
    deletionCancelRef,
    deleteTask,
    settingsOpen,
    setSettingsOpen,
    settingsCloseRef,
    submitPreferences,
    generatePairingCode,
    pairingCode,
    authDevices,
    revokeDevice,
    confirmAdultForget,
    setConfirmAdultForget,
    forgetSecondAdult,
    authManagementMessage,
    robotBandwidth,
    robotSettingsBusy,
    changeRobotBandwidth,
    robotPurgeConfirmation,
    setRobotPurgeConfirmation,
    purgeRobotPlaces,
    robotSettingsMessage,
    preferencesDraft,
    setPreferencesDraft,
    chatAvailable,
    openGroceryQuickAdd,
    setChatCreateRequest,
  };
}
