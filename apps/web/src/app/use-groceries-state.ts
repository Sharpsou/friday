import { useRef, useState } from 'react';
import { type LocalGroceryItem } from '../db/grocery-repository.js';

export function useGroceriesState() {
  const [classificationPreviewOpen, setClassificationPreviewOpen] =
    useState(false);
  const [groceryLabel, setGroceryLabel] = useState('');
  const [groceryQuantity, setGroceryQuantity] = useState('');
  const [editingGroceries, setEditingGroceries] = useState(false);
  const [shoppingModeInitialCount, setShoppingModeInitialCount] = useState<
    number | null
  >(null);
  const [groceryPendingEdit, setGroceryPendingEdit] =
    useState<LocalGroceryItem | null>(null);
  const [changingGroceryItemId, setChangingGroceryItemId] = useState<
    string | null
  >(null);
  const groceryInputRef = useRef<HTMLInputElement>(null);
  return {
    classificationPreviewOpen,
    setClassificationPreviewOpen,
    groceryLabel,
    setGroceryLabel,
    groceryQuantity,
    setGroceryQuantity,
    editingGroceries,
    setEditingGroceries,
    shoppingModeInitialCount,
    setShoppingModeInitialCount,
    groceryPendingEdit,
    setGroceryPendingEdit,
    changingGroceryItemId,
    setChangingGroceryItemId,
    groceryInputRef,
  };
}
