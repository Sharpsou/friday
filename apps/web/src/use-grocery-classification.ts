import { useCallback, useEffect, useState } from 'react';

import type {
  GroceryClassificationApplyRequest,
  GroceryClassificationApplyResponse,
  GroceryClassificationJob,
} from '@friday/contracts';

import {
  getActiveGroceryClassificationJobId,
  setActiveGroceryClassificationJobId,
} from './db/grocery-classification-repository.js';
import {
  applyGroceryClassification,
  cancelGroceryClassification,
  getGroceryClassificationJob,
  GroceryClassificationJobNotFoundError,
  startGroceryClassification,
} from './sync/grocery-classification-client.js';

const ACTIVE_STATUSES = new Set<GroceryClassificationJob['status']>([
  'queued',
  'running',
  'cancelling',
]);

export function useGroceryClassification(enabled: boolean) {
  const [job, setJob] = useState<GroceryClassificationJob | null>(null);
  const [busy, setBusy] = useState(false);

  const rememberJob = useCallback(
    async (nextJob: GroceryClassificationJob | null) => {
      setJob(nextJob);
      await setActiveGroceryClassificationJobId(nextJob?.id ?? null);
    },
    [],
  );

  const refresh = useCallback(async (jobId: string) => {
    const nextJob = await getGroceryClassificationJob(jobId);
    setJob(nextJob);
    return nextJob;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const restore = () => {
      if (document.visibilityState !== 'visible') return;
      void getActiveGroceryClassificationJobId()
        .then(async (jobId) =>
          jobId ? getGroceryClassificationJob(jobId) : null,
        )
        .then((storedJob) => {
          if (!disposed) setJob(storedJob);
        })
        .catch((error: unknown) => {
          if (
            !disposed &&
            error instanceof GroceryClassificationJobNotFoundError
          ) {
            setJob(null);
            void setActiveGroceryClassificationJobId(null);
          }
        });
    };
    const onVisibleOrOnline = () => restore();
    restore();
    window.addEventListener('online', onVisibleOrOnline);
    document.addEventListener('visibilitychange', onVisibleOrOnline);
    const timer = window.setInterval(restore, 10_000);
    return () => {
      disposed = true;
      window.removeEventListener('online', onVisibleOrOnline);
      document.removeEventListener('visibilitychange', onVisibleOrOnline);
      window.clearInterval(timer);
    };
  }, [enabled]);

  useEffect(() => {
    if (!job || !ACTIVE_STATUSES.has(job.status)) return;
    let disposed = false;
    const poll = () => {
      if (document.visibilityState !== 'visible') return;
      void refresh(job.id).catch(() => {
        // Le job continue sur le hub ; la prochaine reprise visible réessaiera.
      });
    };
    const onVisibility = () => {
      if (!disposed) poll();
    };
    const timer = window.setInterval(poll, 2_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [job, refresh]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const nextJob = await startGroceryClassification();
      await rememberJob(nextJob);
      return nextJob;
    } finally {
      setBusy(false);
    }
  }, [rememberJob]);

  const cancel = useCallback(async () => {
    if (!job) return null;
    setBusy(true);
    try {
      const nextJob = await cancelGroceryClassification(job.id);
      await rememberJob(nextJob);
      return nextJob;
    } finally {
      setBusy(false);
    }
  }, [job, rememberJob]);

  const apply = useCallback(
    async (
      classifications: GroceryClassificationApplyRequest['classifications'],
    ): Promise<GroceryClassificationApplyResponse> => {
      if (!job) throw new Error('Aucune proposition à appliquer.');
      setBusy(true);
      try {
        const response = await applyGroceryClassification({
          jobId: job.id,
          classifications,
        });
        await rememberJob(null);
        return response;
      } finally {
        setBusy(false);
      }
    },
    [job, rememberJob],
  );

  const dismiss = useCallback(async () => rememberJob(null), [rememberJob]);

  return { apply, busy, cancel, dismiss, job, refresh, start };
}
