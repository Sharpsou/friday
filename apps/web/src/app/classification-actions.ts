import { syncGroceryClassifications } from '../sync/grocery-classification-client.js';
import type { useGroceryClassification } from '../use-grocery-classification.js';

import type { useAppSync } from './use-app-sync.js';
import type { useConnectionState } from './use-connection-state.js';
import type { useGroceriesState } from './use-groceries-state.js';
import type { useLocalData } from './use-local-data.js';
interface Context {
  hubReachable: ReturnType<typeof useConnectionState>['hubReachable'];
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  synchronize: ReturnType<typeof useAppSync>['synchronize'];
  groceryClassification: ReturnType<typeof useGroceryClassification>;
  setClassificationPreviewOpen: ReturnType<
    typeof useGroceriesState
  >['setClassificationPreviewOpen'];
  reloadLocalState: ReturnType<typeof useLocalData>['reloadLocalState'];
}
export function createClassificationActions({
  hubReachable,
  setMessage,
  synchronize,
  groceryClassification,
  setClassificationPreviewOpen,
  reloadLocalState,
}: Context) {
  async function startGroceryAisleClassification() {
    if (!navigator.onLine || hubReachable === false) {
      setMessage(
        'Le classement par rayon nécessite le hub. La liste reste disponible hors ligne.',
      );
      return;
    }
    try {
      await synchronize(true);
      const job = await groceryClassification.start();
      if (job.status === 'completed' && (job.proposal?.length ?? 0) === 0) {
        await groceryClassification.dismiss();
        setMessage('Tous les produits ont déjà un rayon.');
        return;
      }
      setMessage(
        job.status === 'completed'
          ? 'Le classement est prêt à être vérifié.'
          : 'Le classement tourne en arrière-plan. Vous pouvez continuer à utiliser Friday.',
      );
      if (job.status === 'completed') setClassificationPreviewOpen(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Impossible de lancer le classement.',
      );
    }
  }
  async function stopGroceryAisleClassification() {
    try {
      const job = await groceryClassification.cancel();
      setMessage(
        job?.status === 'cancelled'
          ? 'Classement interrompu. La liste n’a pas été modifiée.'
          : 'Arrêt du classement demandé.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Impossible d’arrêter le classement.',
      );
    }
  }
  async function applyGroceryAisleClassification(
    classifications: Parameters<typeof groceryClassification.apply>[0],
  ) {
    try {
      const response = await groceryClassification.apply(classifications);
      const classificationCacheUpdated = await syncGroceryClassifications()
        .then(() => true)
        .catch(() => false);
      await reloadLocalState();
      setClassificationPreviewOpen(false);
      setMessage(
        !classificationCacheUpdated
          ? 'Classement appliqué. Il apparaîtra après la prochaine synchronisation.'
          : response.skippedItemIds.length === 0
            ? 'Classement appliqué et partagé avec le foyer.'
            : `Classement appliqué. ${response.skippedItemIds.length.toString()} produit${response.skippedItemIds.length > 1 ? 's modifiés ont' : ' modifié a'} été ignoré${response.skippedItemIds.length > 1 ? 's' : ''}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Impossible d’appliquer le classement.',
      );
    }
  }
  async function discardGroceryAisleClassification() {
    await groceryClassification.dismiss();
    setClassificationPreviewOpen(false);
    setMessage('Proposition ignorée. Le classement précédent est conservé.');
  }
  return {
    startGroceryAisleClassification,
    stopGroceryAisleClassification,
    applyGroceryAisleClassification,
    discardGroceryAisleClassification,
  };
}
