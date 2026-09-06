import { type BudgetState } from '../db/budget-repository.js';
export type TaskView = 'list' | 'week' | 'month';
export type RecurrenceChoice =
  'none' | 'daily' | 'weekly' | 'custom-days' | 'monthly' | 'yearly';
export const EMPTY_BUDGET_STATE: BudgetState = {
  entries: [],
  envelopes: [],
  plannedExpenses: [],
  recurringTemplates: [],
  savingsMonths: [],
};
