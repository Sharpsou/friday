import { useCallback } from 'react';
import {
  listBudgetState,
  materializeDueBudgetEntries,
} from '../db/budget-repository.js';
import { listGroceryClassifications } from '../db/grocery-classification-repository.js';
import { listGroceryItems } from '../db/grocery-repository.js';
import { listMaisonRecords } from '../db/maison-repository.js';
import { getOutboxCounts } from '../db/outbox-repository.js';
import { listTasks } from '../db/task-repository.js';

import type { useLocalDataState } from './use-local-data-state.js';
interface Context {
  setMaisonRecords: ReturnType<typeof useLocalDataState>['setMaisonRecords'];
  setTasks: ReturnType<typeof useLocalDataState>['setTasks'];
  setGroceryItems: ReturnType<typeof useLocalDataState>['setGroceryItems'];
  setGroceryClassifications: ReturnType<
    typeof useLocalDataState
  >['setGroceryClassifications'];
  setBudgetState: ReturnType<typeof useLocalDataState>['setBudgetState'];
  setPending: ReturnType<typeof useLocalDataState>['setPending'];
  setConflicts: ReturnType<typeof useLocalDataState>['setConflicts'];
}
export function useLocalData({
  setMaisonRecords,
  setTasks,
  setGroceryItems,
  setGroceryClassifications,
  setBudgetState,
  setPending,
  setConflicts,
}: Context) {
  const reloadLocalState = useCallback(async () => {
    await materializeDueBudgetEntries(new Date().toLocaleDateString('sv-SE'));
    const [
      localTasks,
      localGroceryItems,
      localGroceryClassifications,
      localBudget,
      counts,
      localMaison,
    ] = await Promise.all([
      listTasks(),
      listGroceryItems(),
      listGroceryClassifications(),
      listBudgetState(),
      getOutboxCounts(),
      listMaisonRecords(),
    ]);
    setMaisonRecords(localMaison);
    setTasks(localTasks);
    setGroceryItems(localGroceryItems);
    setGroceryClassifications(localGroceryClassifications);
    setBudgetState(localBudget);
    setPending(counts.pending);
    setConflicts(counts.conflicts);
    return localTasks;
  }, [
    setBudgetState,
    setConflicts,
    setGroceryClassifications,
    setGroceryItems,
    setMaisonRecords,
    setPending,
    setTasks,
  ]);
  return { reloadLocalState };
}
