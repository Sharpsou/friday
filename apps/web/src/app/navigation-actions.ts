import type { useGroceriesState } from './use-groceries-state.js';
import type { useNavigationState } from './use-navigation-state.js';
import type { useTaskFormState } from './use-task-form-state.js';
interface Context {
  setFocusMealId: ReturnType<typeof useNavigationState>['setFocusMealId'];
  setMaisonTab: ReturnType<typeof useNavigationState>['setMaisonTab'];
  setDestination: ReturnType<typeof useNavigationState>['setDestination'];
  setEditingTasks: ReturnType<typeof useTaskFormState>['setEditingTasks'];
  setTaskView: ReturnType<typeof useNavigationState>['setTaskView'];
  inputRef: ReturnType<typeof useTaskFormState>['inputRef'];
  setDueDate: ReturnType<typeof useTaskFormState>['setDueDate'];
  setDueTime: ReturnType<typeof useTaskFormState>['setDueTime'];
  setDurationMinutes: ReturnType<typeof useTaskFormState>['setDurationMinutes'];
  setRecurrenceChoice: ReturnType<
    typeof useTaskFormState
  >['setRecurrenceChoice'];
  setRecurrenceEndDate: ReturnType<
    typeof useTaskFormState
  >['setRecurrenceEndDate'];
  scheduleDetailsRef: ReturnType<typeof useTaskFormState>['scheduleDetailsRef'];
  setEditingGroceries: ReturnType<
    typeof useGroceriesState
  >['setEditingGroceries'];
  groceryInputRef: ReturnType<typeof useGroceriesState>['groceryInputRef'];
}
export function createNavigationActions({
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
}: Context) {
  function openMeal(id: string) {
    setFocusMealId(id);
    setMaisonTab('menus');
    setDestination('groceries');
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
  return { openMeal, openQuickAdd, openQuickAddForDate, openGroceryQuickAdd };
}
