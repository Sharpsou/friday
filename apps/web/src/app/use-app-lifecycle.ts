import { useEffect } from 'react';
import { applyAppTheme, loadAppPreferences } from '../app-preferences.js';
import type { useClosedAuth } from '../auth/use-closed-auth.js';
import { checkForAppUpdate } from '../pwa.js';
import { getInferenceStatus } from '../sync/inference-client.js';
import { getRobotCameraBandwidth } from '../sync/robot-client.js';
import { cancelActiveSync } from '../sync/sync-client.js';

import type { useAppSync } from './use-app-sync.js';
import type { useConnectionState } from './use-connection-state.js';
import type { useLocalData } from './use-local-data.js';
import type { usePreferencesState } from './use-preferences-state.js';
import type { useRobotSettingsState } from './use-robot-settings-state.js';
import type { useTaskFormState } from './use-task-form-state.js';
interface Context {
  reloadLocalState: ReturnType<typeof useLocalData>['reloadLocalState'];
  synchronize: ReturnType<typeof useAppSync>['synchronize'];
  setPreferences: ReturnType<typeof usePreferencesState>['setPreferences'];
  setPreferencesDraft: ReturnType<
    typeof usePreferencesState
  >['setPreferencesDraft'];
  reloadAuthManagement: () => Promise<void>;
  authSession: ReturnType<typeof useClosedAuth>['session'];
  setInferenceStatus: ReturnType<
    typeof useConnectionState
  >['setInferenceStatus'];
  settingsOpen: ReturnType<typeof usePreferencesState>['settingsOpen'];
  settingsCloseRef: ReturnType<typeof usePreferencesState>['settingsCloseRef'];
  setSettingsOpen: ReturnType<typeof usePreferencesState>['setSettingsOpen'];
  setRobotBandwidth: ReturnType<
    typeof useRobotSettingsState
  >['setRobotBandwidth'];
  setRobotSettingsMessage: ReturnType<
    typeof useRobotSettingsState
  >['setRobotSettingsMessage'];
  taskPendingDeletion: ReturnType<
    typeof useTaskFormState
  >['taskPendingDeletion'];
  deletionCancelRef: ReturnType<typeof useTaskFormState>['deletionCancelRef'];
  deletingTaskId: ReturnType<typeof useTaskFormState>['deletingTaskId'];
  setTaskPendingDeletion: ReturnType<
    typeof useTaskFormState
  >['setTaskPendingDeletion'];
  setOnline: ReturnType<typeof useConnectionState>['setOnline'];
  setHubReachable: ReturnType<typeof useConnectionState>['setHubReachable'];
  setSyncing: ReturnType<typeof useConnectionState>['setSyncing'];
}
export function useAppLifecycle({
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
}: Context) {
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
  }, [reloadLocalState, synchronize, setPreferences, setPreferencesDraft]);
  useEffect(() => {
    window.queueMicrotask(() => void reloadAuthManagement());
  }, [reloadAuthManagement]);
  useEffect(() => {
    if (!authSession) {
      return undefined;
    }
    let stopped = false;
    const refresh = async () => {
      if (!navigator.onLine || document.visibilityState !== 'visible') return;
      try {
        const status = await getInferenceStatus();
        if (!stopped) setInferenceStatus(status);
      } catch {
        if (!stopped) setInferenceStatus(null);
      }
    };
    window.queueMicrotask(() => void refresh());
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [authSession, setInferenceStatus]);
  useEffect(() => {
    if (!authSession) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      if (navigator.onLine) void reloadAuthManagement();
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [authSession, reloadAuthManagement]);
  useEffect(() => {
    if (!settingsOpen) return;
    settingsCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [settingsOpen, setSettingsOpen, settingsCloseRef]);
  useEffect(() => {
    if (
      !settingsOpen ||
      authSession?.member.role !== 'owner' ||
      !navigator.onLine
    )
      return;
    let cancelled = false;
    window.queueMicrotask(() => {
      void getRobotCameraBandwidth()
        .then((status) => {
          if (!cancelled) setRobotBandwidth(status);
        })
        .catch(() => {
          if (!cancelled)
            setRobotSettingsMessage(
              'Réglages Robot momentanément indisponibles.',
            );
        });
    });
    return () => {
      cancelled = true;
    };
  }, [
    authSession?.member.role,
    settingsOpen,
    setRobotBandwidth,
    setRobotSettingsMessage,
  ]);
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
  }, [
    deletingTaskId,
    taskPendingDeletion,
    deletionCancelRef,
    setTaskPendingDeletion,
  ]);
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
  }, [synchronize, setHubReachable, setOnline, setSyncing]);
}
