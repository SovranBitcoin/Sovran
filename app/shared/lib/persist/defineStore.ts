import { create, type StateCreator, type StoreApi, type StoreMutatorIdentifier } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { storeLog } from '@/shared/lib/logger';
import { persistRegistry } from './persistConfig';
import { liveStores, type StoreScope } from '@/shared/lib/account/accountRegistry';

interface StoreDefinition {
  name: string;
  scope: StoreScope;
}

function record<T>(definition: StoreDefinition, store: StoreApi<T>): void {
  const registration = {
    ...definition,
    persisted: 'persist' in store,
    store,
    initialState: store.getInitialState(),
  };
  liveStores.push(registration);
  for (const entry of persistRegistry) {
    if (entry.name === definition.name) Object.assign(entry, registration);
  }
}

/**
 * Whether `store.set` entries would be emitted. Every store in the app is
 * built through this module, so it also runs under each suite's logger double,
 * most of which carry only the methods that suite asserts on. A logger without
 * a level check is treated as silent rather than failing every store.
 */
function writeLogEnabled(): boolean {
  // Opt-in: one entry per write across every store is enough load on the JS
  // thread, in a dev build, to trip the bottom-sheet open watchdog.
  return (
    process.env.EXPO_PUBLIC_PERF_PROBES === '1' &&
    typeof storeLog?.isLevelEnabled === 'function' &&
    storeLog.isLevelEnabled('debug')
  );
}

/** Top-level keys whose value differs by reference. Names only, never values. */
function changedKeys(before: unknown, after: unknown): string[] {
  if (Object.is(before, after)) return [];
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null)
    return ['(state)'];
  const prev = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  const changed = Object.keys(next).filter((key) => !Object.is(prev[key], next[key]));
  for (const key of Object.keys(prev)) if (!(key in next)) changed.push(key);
  return changed;
}

/**
 * One `store.set` debug entry per write: the store, its scope, which top-level
 * keys changed and how many subscribers zustand notified. An empty `changed`
 * is a write that changed nothing; with `subscribers` above zero it still woke
 * every subscriber, because zustand notifies whenever the state object is new.
 *
 * Returns the initializer itself when debug entries would not be emitted, so a
 * release build runs the store exactly as zustand built it. A write made by a
 * subscriber during a notification is logged first, and the write that
 * triggered it then reports both sets of keys.
 */
function withWriteLog<T, Mos extends [StoreMutatorIdentifier, unknown][]>(
  definition: StoreDefinition,
  initializer: StateCreator<T, [], Mos>
): StateCreator<T, [], Mos> {
  if (!writeLogEnabled()) return initializer;
  return (set, get, api) => {
    // Mirrors zustand's own listener Set, which it does not expose.
    const listeners = new Set<unknown>();
    const subscribe = api.subscribe;
    api.subscribe = (listener) => {
      listeners.add(listener);
      const unsubscribe = subscribe(listener);
      return () => {
        listeners.delete(listener);
        return unsubscribe();
      };
    };
    const write = set as (partial: unknown, replace?: boolean) => void;
    const loggedSet = ((partial: unknown, replace?: boolean) => {
      if (!writeLogEnabled()) return write(partial, replace);
      const before = get();
      write(partial, replace);
      const after = get();
      storeLog.debug('store.set', () => {
        // Comparing reads the state's properties, which an unwrapped write
        // never does. A throwing accessor must not turn a write into a throw.
        let changed: string[];
        try {
          changed = changedKeys(before, after);
        } catch {
          changed = ['(unreadable)'];
        }
        return {
          store: definition.name,
          scope: definition.scope,
          changed,
          subscribers: Object.is(before, after) ? 0 : listeners.size,
        };
      });
    }) as StoreApi<T>['setState'];
    api.setState = loggedSet;
    return initializer(loggedSet, get, api);
  };
}

/** The initializer and middleware are passed through unchanged. */
export function defineStore<T>(definition: StoreDefinition) {
  return <Mos extends [StoreMutatorIdentifier, unknown][] = []>(
    initializer: StateCreator<T, [], Mos>
  ) => {
    const store = create<T>()(withWriteLog(definition, initializer));
    record(definition, store);
    return store;
  };
}

/** Captured-owner stores use the same registry without adding a React hook. */
export function defineVanillaStore<T>(definition: StoreDefinition) {
  return <Mos extends [StoreMutatorIdentifier, unknown][] = []>(
    initializer: StateCreator<T, [], Mos>
  ) => {
    const store = createStore<T>()(withWriteLog(definition, initializer));
    record(definition, store);
    return store;
  };
}
