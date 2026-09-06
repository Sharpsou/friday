import { useState } from 'react';
import type { Destination } from './Navigation.js';
import { type TaskView } from './controller-records.js';

export function useNavigationState() {
  const [destination, setDestination] = useState<Destination>('today');
  const [maisonTab, setMaisonTab] = useState<'courses' | 'menus' | 'reserve'>(
    'courses',
  );
  const [showMenus, setShowMenus] = useState(true);
  const [focusMealId, setFocusMealId] = useState<string | null>(null);
  const [taskView, setTaskView] = useState<TaskView>('list');
  const [budgetQuickAddOpen, setBudgetQuickAddOpen] = useState(false);
  const [watchCreatorOpen, setWatchCreatorOpen] = useState(false);
  const [chatCreateRequest, setChatCreateRequest] = useState(0);
  const [chatAvailable, setChatAvailable] = useState(false);
  return {
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
  };
}
