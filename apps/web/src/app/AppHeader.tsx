import { checkForAppUpdate } from '../pwa.js';
import { useAppController } from './use-app-controller.js';
type Props = Pick<
  ReturnType<typeof useAppController>,
  | 'destination'
  | 'groceryItems'
  | 'editingGroceries'
  | 'setEditingGroceries'
  | 'connectionTone'
  | 'synchronize'
  | 'syncing'
  | 'connectionLabel'
  | 'openSettings'
>;
export function AppHeader({
  destination,
  groceryItems,
  editingGroceries,
  setEditingGroceries,
  connectionTone,
  synchronize,
  syncing,
  connectionLabel,
  openSettings,
}: Props) {
  return (
    <header className="topbar">
      <h1>Friday</h1>
      <div className="topbar-actions">
        {destination === 'groceries' ? (
          <div className="page-actions topbar-context-actions">
            <span className="count-badge">{groceryItems.length}</span>
            {groceryItems.length > 0 ? (
              <button
                className="edit-toggle"
                type="button"
                aria-pressed={editingGroceries}
                onClick={() => setEditingGroceries((current) => !current)}
              >
                {editingGroceries ? 'Terminer' : 'Modifier'}
              </button>
            ) : null}
          </div>
        ) : null}
        <button
          className={`status-pill ${connectionTone}`}
          type="button"
          onClick={() => {
            void synchronize();
            void checkForAppUpdate(true);
          }}
          disabled={syncing}
        >
          <span aria-hidden="true" />
          {connectionLabel}
        </button>
        <button
          className="settings-button"
          type="button"
          aria-label="Ouvrir les réglages"
          onClick={openSettings}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </header>
  );
}
