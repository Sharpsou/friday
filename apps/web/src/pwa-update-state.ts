type UpdateListener = () => void;

export type AppUpdateState = ReturnType<typeof createAppUpdateState>;

export function createAppUpdateState() {
  let available = false;
  const listeners = new Set<UpdateListener>();

  return {
    getSnapshot: () => available,
    markAvailable: () => {
      if (available) return;
      available = true;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: UpdateListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const appUpdateState = createAppUpdateState();
