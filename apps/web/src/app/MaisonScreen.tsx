import { lazy, Suspense } from 'react';
import type { useAppController } from './use-app-controller.js';
const MaisonView = lazy(() => import('../MaisonView.js'));
type Props = Pick<
  ReturnType<typeof useAppController>,
  | 'destination'
  | 'maisonTab'
  | 'setMaisonTab'
  | 'setFocusMealId'
  | 'maisonRecords'
  | 'groceryItems'
  | 'focusMealId'
  | 'online'
  | 'hubReachable'
  | 'reloadLocalState'
  | 'synchronize'
>;
export function MaisonScreen({
  destination,
  maisonTab,
  setMaisonTab,
  setFocusMealId,
  maisonRecords,
  groceryItems,
  focusMealId,
  online,
  hubReachable,
  reloadLocalState,
  synchronize,
}: Props) {
  return (
    <>
      {destination === 'groceries' ? (
        <>
          <div className="maison-tabs" aria-label="Maison">
            {(['courses', 'menus', 'reserve'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={maisonTab === tab}
                onClick={() => {
                  setMaisonTab(tab);
                  setFocusMealId(null);
                }}
              >
                {
                  { courses: 'Courses', menus: 'Menus', reserve: 'Réserve' }[
                    tab
                  ]
                }
              </button>
            ))}
          </div>
          {maisonTab !== 'courses' ? (
            <Suspense fallback={<p>Chargement de Maison…</p>}>
              <MaisonView
                tab={maisonTab}
                records={maisonRecords}
                groceries={groceryItems}
                focusMealId={focusMealId}
                available={online && hubReachable === true}
                onChanged={async () => {
                  await reloadLocalState();
                  void synchronize();
                }}
              />
            </Suspense>
          ) : null}
        </>
      ) : null}
    </>
  );
}
