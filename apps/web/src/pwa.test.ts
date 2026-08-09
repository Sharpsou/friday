import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

const registerSW = vi.hoisted(() =>
  vi.fn<(options?: RegisterSWOptions) => UpdateServiceWorker>(() =>
    vi.fn().mockResolvedValue(undefined),
  ),
);

vi.mock('virtual:pwa-register', () => ({ registerSW }));

function installServiceWorkerMock(
  registration: Partial<ServiceWorkerRegistration>,
) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  });
}

beforeEach(() => {
  vi.resetModules();
  registerSW.mockClear();
  registerSW.mockReturnValue(vi.fn().mockResolvedValue(undefined));
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('PWA update checks', () => {
  it('asks the current service worker registration for an update', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    installServiceWorkerMock({ update, waiting: null });
    const { checkForAppUpdate } = await import('./pwa.js');

    await checkForAppUpdate();

    expect(update).toHaveBeenCalledOnce();
  });

  it('queues a user-requested check behind an automatic check in progress', async () => {
    let finishFirstCheck: (() => void) | undefined;
    const firstCheck = new Promise<void>((resolve) => {
      finishFirstCheck = resolve;
    });
    const update = vi
      .fn()
      .mockReturnValueOnce(firstCheck)
      .mockResolvedValue(undefined);
    installServiceWorkerMock({ update, waiting: null });
    const { checkForAppUpdate } = await import('./pwa.js');

    const automaticCheck = checkForAppUpdate();
    const userCheck = checkForAppUpdate(true);
    finishFirstCheck?.();
    await Promise.all([automaticCheck, userCheck]);

    expect(update).toHaveBeenCalledTimes(2);
  });

  it('retains the refresh callback signal for a later subscriber', async () => {
    installServiceWorkerMock({ update: vi.fn(), waiting: null });
    const { getAppUpdateSnapshot } = await import('./pwa.js');
    const options = registerSW.mock.calls[0]?.[0];

    options?.onNeedRefresh?.();

    expect(getAppUpdateSnapshot()).toBe(true);
  });
});
