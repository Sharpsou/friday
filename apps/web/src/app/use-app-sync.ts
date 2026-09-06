import { useCallback } from 'react';
import type { useClosedAuth } from '../auth/use-closed-auth.js';
import { syncGroceryClassifications } from '../sync/grocery-classification-client.js';
import { AuthenticationRequiredError, syncNow } from '../sync/sync-client.js';

import type { useConnectionState } from './use-connection-state.js';
import type { useLocalData } from './use-local-data.js';
interface Context {
  authSession: ReturnType<typeof useClosedAuth>['session'];
  setHubReachable: ReturnType<typeof useConnectionState>['setHubReachable'];
  reloadLocalState: ReturnType<typeof useLocalData>['reloadLocalState'];
  setSyncing: ReturnType<typeof useConnectionState>['setSyncing'];
  setLastSync: ReturnType<typeof useConnectionState>['setLastSync'];
  refreshAuth: ReturnType<typeof useClosedAuth>['refresh'];
  setOnline: ReturnType<typeof useConnectionState>['setOnline'];
}
export function useAppSync({
  authSession,
  setHubReachable,
  reloadLocalState,
  setSyncing,
  setLastSync,
  refreshAuth,
  setOnline,
}: Context) {
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
    [
      authSession,
      refreshAuth,
      reloadLocalState,
      setHubReachable,
      setLastSync,
      setOnline,
      setSyncing,
    ],
  );
  return { synchronize };
}
