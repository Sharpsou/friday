import { type LocalTask } from '../db/task-repository.js';

export const TASK_SYNC_LABELS: Record<LocalTask['syncState'], string> = {
  pending: 'À synchroniser',
  sent: 'Synchronisation en cours',
  acknowledged: 'Synchronisée avec le foyer',
  conflict: 'À vérifier',
};
