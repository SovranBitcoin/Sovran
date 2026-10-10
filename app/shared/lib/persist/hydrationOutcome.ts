/**
 * Whether a persisted store's saved data could be read.
 *
 * Zustand reports a successful load (`hasHydrated`, `onFinishHydration`) and
 * says nothing when the read or the parse throws, so anything waiting for a
 * store to load waits for ever. This records the other outcome.
 */
const failed = new Set<string>();
const listeners = new Set<() => void>();

export function markHydrationStarted(name: string): void {
  failed.delete(name);
}

export function markHydrationFailed(name: string): void {
  failed.add(name);
  for (const listener of [...listeners]) listener();
}

interface PersistedStore {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (listener: () => void) => () => void;
    rehydrate: () => Promise<void> | void;
    getOptions: () => { name?: string };
  };
}

/** True once the store has loaded; false if its saved data could not be read. */
export function hydrationSettled(store: PersistedStore): Promise<boolean> {
  const name = store.persist.getOptions().name ?? '';
  return new Promise((resolve) => {
    const stops: (() => void)[] = [];
    const settle = () => {
      const loaded = store.persist.hasHydrated();
      if (!loaded && !failed.has(name)) return;
      for (const stop of stops) stop();
      resolve(loaded);
    };
    stops.push(store.persist.onFinishHydration(settle));
    listeners.add(settle);
    stops.push(() => listeners.delete(settle));
    settle();
  });
}

/**
 * Waits for stores the app cannot start without, reading again any that failed
 * last time. Throws when one still cannot be read, so the caller can stop on a
 * screen with a retry instead of starting on defaults.
 */
export async function loadRequiredStores(stores: readonly PersistedStore[]): Promise<void> {
  for (const store of stores) {
    const name = store.persist.getOptions().name ?? '';
    if (failed.has(name)) void store.persist.rehydrate();
  }
  const loaded = await Promise.all(stores.map(hydrationSettled));
  const unread = stores
    .filter((_, index) => !loaded[index])
    .map((store) => store.persist.getOptions().name ?? 'unnamed');
  if (unread.length > 0) throw new Error(`Saved data could not be read: ${unread.join(', ')}`);
}
