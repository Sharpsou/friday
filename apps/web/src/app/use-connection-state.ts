import type { InferenceStatus } from '@friday/contracts';
import { useState } from 'react';

export function useConnectionState() {
  const [inferenceStatus, setInferenceStatus] =
    useState<InferenceStatus | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [hubReachable, setHubReachable] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  return {
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
  };
}
