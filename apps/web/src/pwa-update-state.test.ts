import { describe, expect, it, vi } from 'vitest';

import { createAppUpdateState } from './pwa-update-state.js';

describe('PWA update state', () => {
  it('retains an update detected before the interface subscribes', () => {
    const state = createAppUpdateState();

    state.markAvailable();

    expect(state.getSnapshot()).toBe(true);
  });

  it('notifies subscribers once and supports unsubscribe', () => {
    const state = createAppUpdateState();
    const listener = vi.fn();
    const unsubscribe = state.subscribe(listener);

    state.markAvailable();
    state.markAvailable();
    unsubscribe();
    state.markAvailable();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
