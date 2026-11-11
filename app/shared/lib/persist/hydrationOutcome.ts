import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Whether a persisted store's saved data could be read, and the one way to
 * wait for it.
 *
 * Zustand reports a successful load (`hasHydrated`, `onFinishHydration`) and
 * says nothing when the read or the parse throws, so anything waiting for a
 * store to load waits for ever. This records the other outcome.
 */
const failed = new Set<string>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of [...listeners]) listener();
};

export function markHydrationStarted(name: string): void {
  failed.delete(name);
  notify();
}

export function markHydrationFailed(name: string): void {
  failed.add(name);
  notify();
}

interface PersistedStore {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (listener: () => void) => () => void;
    rehydrate: () => Promise<void> | void;
    getOptions: () => { name?: string };
  };
}

type StoreLoad = 'loading' | 'loaded' | 'failed';

type Persist = PersistedStore['persist'];

const nameOf = (persist: Persist) => persist.getOptions().name ?? '';

function loadOf(persist: Persist): StoreLoad {
  if (persist.hasHydrated()) return 'loaded';
  return failed.has(nameOf(persist)) ? 'failed' : 'loading';
}

/**
 * Where the store's current read stands. Follows every read: a later one shows
 * as `loading` again. Takes `useXStore.persist`: a hook cannot be passed as a value.
 */
export function useStoreLoad(persist: Persist): StoreLoad {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const stop = persist.onFinishHydration(onChange);
      listeners.add(onChange);
      return () => {
        stop();
        listeners.delete(onChange);
      };
    },
    [persist]
  );
  const read = () => loadOf(persist);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * True once a load of the store finishes, for as long as the component stays
 * mounted. Set by the load finishing, not by a render seeing it, so a read that
 * starts before the next render cannot hide that the earlier one finished.
 */
export function useStoreLoadLatched(persist: Persist): boolean {
  const [latched, setLatched] = useState(() => persist.hasHydrated());
  useEffect(() => {
    if (latched) return undefined;
    const stop = persist.onFinishHydration(() => setLatched(true));
    // It may have finished between the render and this effect.
    if (persist.hasHydrated()) setLatched(true);
    return stop;
  }, [persist, latched]);
  return latched;
}

interface WaitOptions {
  /** Give up with `false` when a read fails, instead of waiting for a later one that succeeds. */
  orFailed?: boolean;
  /** Give up after this long, with whether the store has loaded by then. */
  timeoutMs?: number;
}

/**
 * Calls `run` once the store has loaded: at once if it already has, otherwise
 * when a read finishes (or as `options` says, when one fails or time is up).
 */
export function onceLoaded(
  store: PersistedStore,
  run: (loaded: boolean) => void,
  { orFailed = false, timeoutMs }: WaitOptions = {}
): void {
  const stops: (() => void)[] = [];
  let done = false;
  const settle = (timedOut = false) => {
    if (done) return true;
    const loaded = store.persist.hasHydrated();
    if (!loaded && !timedOut && !(orFailed && failed.has(nameOf(store.persist)))) return false;
    done = true;
    for (const stop of stops) stop();
    run(loaded);
    return true;
  };
  if (settle()) return;
  stops.push(store.persist.onFinishHydration(() => settle()));
  if (orFailed) {
    const onOutcome = () => settle();
    listeners.add(onOutcome);
    stops.push(() => listeners.delete(onOutcome));
  }
  if (timeoutMs !== undefined) {
    const timer = setTimeout(() => settle(true), timeoutMs);
    stops.push(() => clearTimeout(timer));
  }
}

/** `onceLoaded` as a promise of whether the store loaded. */
export function whenLoaded(store: PersistedStore, options?: WaitOptions): Promise<boolean> {
  return new Promise((resolve) => onceLoaded(store, resolve, options));
}

/**
 * Waits for stores the app cannot start without, reading again any that failed
 * last time and any whose row has changed on disk since the store loaded (a
 * migration wrote it). Throws when one still cannot be read, so the caller can
 * stop on a screen with a retry instead of starting on defaults.
 */
export async function loadRequiredStores(
  stores: readonly PersistedStore[],
  changedOnDisk: ReadonlySet<string> = new Set()
): Promise<void> {
  for (const store of stores) {
    // `rehydrate` marks the store as not loaded before it returns, so the wait
    // below is for this read and not the earlier one.
    const name = nameOf(store.persist);
    if (failed.has(name) || changedOnDisk.has(name)) void store.persist.rehydrate();
  }
  const loaded = await Promise.all(stores.map((store) => whenLoaded(store, { orFailed: true })));
  const unread = stores
    .filter((_, index) => !loaded[index])
    .map((store) => store.persist.getOptions().name ?? 'unnamed');
  if (unread.length > 0) throw new Error(`Saved data could not be read: ${unread.join(', ')}`);
}
