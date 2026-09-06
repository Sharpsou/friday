import {
  createLocalGroceryItem,
  createLocalGroceryItems,
  deleteLocalGroceryItem,
  setLocalGroceryItemChecked,
  updateLocalGroceryItem,
} from '../db/grocery-repository.js';
import { cancelActiveSync } from '../sync/sync-client.js';

import type { useAppSync } from './use-app-sync.js';
import type { useConnectionState } from './use-connection-state.js';
import type { useGroceriesState } from './use-groceries-state.js';
import type { useLocalDataState } from './use-local-data-state.js';
import type { useLocalData } from './use-local-data.js';
interface Context {
  setSyncing: ReturnType<typeof useConnectionState>['setSyncing'];
  groceryLabel: ReturnType<typeof useGroceriesState>['groceryLabel'];
  groceryQuantity: ReturnType<typeof useGroceriesState>['groceryQuantity'];
  setGroceryLabel: ReturnType<typeof useGroceriesState>['setGroceryLabel'];
  setGroceryQuantity: ReturnType<
    typeof useGroceriesState
  >['setGroceryQuantity'];
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  reloadLocalState: ReturnType<typeof useLocalData>['reloadLocalState'];
  synchronize: ReturnType<typeof useAppSync>['synchronize'];
  groceryInputRef: ReturnType<typeof useGroceriesState>['groceryInputRef'];
  setChangingGroceryItemId: ReturnType<
    typeof useGroceriesState
  >['setChangingGroceryItemId'];
  groceryItems: ReturnType<typeof useLocalDataState>['groceryItems'];
  setEditingGroceries: ReturnType<
    typeof useGroceriesState
  >['setEditingGroceries'];
  groceryPendingEdit: ReturnType<
    typeof useGroceriesState
  >['groceryPendingEdit'];
  setSavingEditor: React.Dispatch<React.SetStateAction<boolean>>;
  setGroceryPendingEdit: ReturnType<
    typeof useGroceriesState
  >['setGroceryPendingEdit'];
}
export function createGroceryActions({
  setSyncing,
  groceryLabel,
  groceryQuantity,
  setGroceryLabel,
  setGroceryQuantity,
  setMessage,
  reloadLocalState,
  synchronize,
  groceryInputRef,
  setChangingGroceryItemId,
  groceryItems,
  setEditingGroceries,
  groceryPendingEdit,
  setSavingEditor,
  setGroceryPendingEdit,
}: Context) {
  async function submitGroceryItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await cancelActiveSync();
      setSyncing(false);
      await createLocalGroceryItem({
        label: groceryLabel,
        quantityText: groceryQuantity,
      });
      setGroceryLabel('');
      setGroceryQuantity('');
      setMessage('Produit ajouté sur cet appareil.');
      await reloadLocalState();
      void synchronize();
      window.setTimeout(() => groceryInputRef.current?.focus(), 0);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Ajout du produit impossible',
      );
    }
  }
  async function importGroceryPhotoItems(
    items: Array<{ label: string; quantityText: string | null }>,
  ) {
    await cancelActiveSync();
    setSyncing(false);
    await createLocalGroceryItems(items);
    setMessage(
      `${items.length.toString()} produit${items.length > 1 ? 's ajoutés' : ' ajouté'} sans classement.`,
    );
    await reloadLocalState();
    void synchronize();
  }
  async function changeGroceryItemState(itemId: string, checked: boolean) {
    setChangingGroceryItemId(itemId);
    try {
      await cancelActiveSync();
      setSyncing(false);
      await setLocalGroceryItemChecked(itemId, checked);
      setMessage(
        checked
          ? 'Produit marqué comme acheté sur cet appareil.'
          : 'Produit remis dans la liste sur cet appareil.',
      );
      await reloadLocalState();
      void synchronize();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Modification impossible',
      );
    } finally {
      setChangingGroceryItemId(null);
    }
  }
  async function deleteGroceryItem(itemId: string) {
    setChangingGroceryItemId(itemId);
    try {
      await cancelActiveSync();
      setSyncing(false);
      await deleteLocalGroceryItem(itemId);
      setMessage('Produit supprimé sur cet appareil.');
      await reloadLocalState();
      if (groceryItems.length <= 1) setEditingGroceries(false);
      void synchronize();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Suppression impossible',
      );
    } finally {
      setChangingGroceryItemId(null);
    }
  }
  async function saveGroceryEdit(input: {
    aisleId: string | null;
    label: string;
    quantityText: string;
    storeFamilyId: string | null;
  }) {
    if (!groceryPendingEdit) return;
    setSavingEditor(true);
    try {
      await cancelActiveSync();
      setSyncing(false);
      await updateLocalGroceryItem(groceryPendingEdit.id, input);
      setMessage('Produit modifié sur cet appareil.');
      setGroceryPendingEdit(null);
      await reloadLocalState();
      void synchronize();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Modification impossible',
      );
    } finally {
      setSavingEditor(false);
    }
  }
  return {
    submitGroceryItem,
    importGroceryPhotoItems,
    changeGroceryItemState,
    deleteGroceryItem,
    saveGroceryEdit,
  };
}
