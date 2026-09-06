import { GroceryView } from '../groceries/GroceryView.js';
import { GroceryPhotoImport } from '../GroceryPhotoImport.js';
import { useAppController } from './use-app-controller.js';
type Props = Pick<
  ReturnType<typeof useAppController>,
  | 'destination'
  | 'maisonTab'
  | 'unpurchasedGroceryItems'
  | 'setShoppingModeInitialCount'
  | 'online'
  | 'hubReachable'
  | 'importGroceryPhotoItems'
  | 'groceryClassification'
  | 'setClassificationPreviewOpen'
  | 'startGroceryAisleClassification'
  | 'groceryAisleGroups'
  | 'changingGroceryItemId'
  | 'editingGroceries'
  | 'groceryInputRef'
  | 'groceryLabel'
  | 'purchasedGroceryItems'
  | 'groceryQuantity'
  | 'changeGroceryItemState'
  | 'deleteGroceryItem'
  | 'setGroceryPendingEdit'
  | 'setGroceryLabel'
  | 'setGroceryQuantity'
  | 'submitGroceryItem'
>;
export function CoursesScreen({
  destination,
  maisonTab,
  unpurchasedGroceryItems,
  setShoppingModeInitialCount,
  online,
  hubReachable,
  importGroceryPhotoItems,
  groceryClassification,
  setClassificationPreviewOpen,
  startGroceryAisleClassification,
  groceryAisleGroups,
  changingGroceryItemId,
  editingGroceries,
  groceryInputRef,
  groceryLabel,
  purchasedGroceryItems,
  groceryQuantity,
  changeGroceryItemState,
  deleteGroceryItem,
  setGroceryPendingEdit,
  setGroceryLabel,
  setGroceryQuantity,
  submitGroceryItem,
}: Props) {
  return (
    <section
      className="screen"
      aria-label="Courses"
      hidden={destination !== 'groceries' || maisonTab !== 'courses'}
    >
      <div className="grocery-classification-toolbar">
        <div className="grocery-action-row">
          <button
            className="shopping-mode-button"
            type="button"
            disabled={unpurchasedGroceryItems.length === 0}
            onClick={() =>
              setShoppingModeInitialCount(unpurchasedGroceryItems.length)
            }
          >
            En course
          </button>
          <GroceryPhotoImport
            available={online && hubReachable === true}
            onImport={importGroceryPhotoItems}
          />
          <button
            className="classify-groceries-button"
            type="button"
            disabled={
              unpurchasedGroceryItems.length === 0 ||
              groceryClassification.busy ||
              ['queued', 'running', 'cancelling'].includes(
                groceryClassification.job?.status ?? '',
              )
            }
            title={
              !online || hubReachable !== true
                ? 'Le classement nécessite le hub.'
                : undefined
            }
            onClick={() => {
              if (groceryClassification.job?.status === 'completed') {
                setClassificationPreviewOpen(true);
              } else {
                void startGroceryAisleClassification();
              }
            }}
          >
            {groceryClassification.job?.status === 'completed'
              ? 'Vérifier le classement'
              : 'Classer par rayon'}
          </button>
        </div>
      </div>

      <GroceryView
        aisleGroups={groceryAisleGroups}
        changingItemId={changingGroceryItemId}
        editing={editingGroceries}
        inputRef={groceryInputRef}
        label={groceryLabel}
        purchasedItems={purchasedGroceryItems}
        quantity={groceryQuantity}
        onCheckedChange={(itemId, checked) =>
          void changeGroceryItemState(itemId, checked)
        }
        onDelete={(itemId) => void deleteGroceryItem(itemId)}
        onEdit={setGroceryPendingEdit}
        onLabelChange={setGroceryLabel}
        onQuantityChange={setGroceryQuantity}
        onSubmit={(event) => void submitGroceryItem(event)}
      />
    </section>
  );
}
