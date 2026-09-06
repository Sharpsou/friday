import type {
  GroceryClassificationRecord,
  MaisonRecord,
} from '@friday/contracts';
import { useState } from 'react';
import { type LocalGroceryItem } from '../db/grocery-repository.js';
import { type LocalTask } from '../db/task-repository.js';
import { EMPTY_BUDGET_STATE } from './controller-records.js';

export function useLocalDataState() {
  const [maisonRecords, setMaisonRecords] = useState<MaisonRecord[]>([]);
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [groceryItems, setGroceryItems] = useState<LocalGroceryItem[]>([]);
  const [groceryClassifications, setGroceryClassifications] = useState<
    GroceryClassificationRecord[]
  >([]);
  const [budgetState, setBudgetState] = useState(EMPTY_BUDGET_STATE);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  return {
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
  };
}
