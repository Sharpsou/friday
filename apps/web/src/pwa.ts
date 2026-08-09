import { registerSW } from 'virtual:pwa-register';

import { appUpdateState } from './pwa-update-state.js';

let registeredServiceWorker: ServiceWorkerRegistration | undefined;
let currentUpdateCheck: Promise<void> | null = null;

function rememberWaitingUpdate(registration?: ServiceWorkerRegistration) {
  if (registration?.waiting) appUpdateState.markAvailable();
}

export const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    appUpdateState.markAvailable();
  },
  onRegisteredSW(_serviceWorkerUrl, registration) {
    registeredServiceWorker = registration;
    rememberWaitingUpdate(registration);
  },
});

export const getAppUpdateSnapshot = appUpdateState.getSnapshot;
export const subscribeToAppUpdates = appUpdateState.subscribe;

export function checkForAppUpdate(afterCurrentCheck = false): Promise<void> {
  if (!('serviceWorker' in navigator)) return Promise.resolve();
  if (currentUpdateCheck) {
    return afterCurrentCheck
      ? currentUpdateCheck.then(() => checkForAppUpdate())
      : currentUpdateCheck;
  }

  currentUpdateCheck = (async () => {
    try {
      const registration =
        registeredServiceWorker ??
        (await navigator.serviceWorker.getRegistration());
      if (!registration) return;

      registeredServiceWorker = registration;
      rememberWaitingUpdate(registration);
      if (!registration.waiting) await registration.update();
      rememberWaitingUpdate(registration);
    } catch {
      // Une recherche de version ne doit jamais bloquer l'usage hors ligne.
    } finally {
      currentUpdateCheck = null;
    }
  })();

  return currentUpdateCheck;
}
