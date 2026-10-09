/**
 * @jest-environment node
 *
 * `defineStore` logs one `store.set` per write. The log has to be invisible to
 * the store (same state, same notifications, middleware untouched) and must
 * never carry a value — only which top-level keys changed.
 */

import { subscribeWithSelector } from 'zustand/middleware';
import { log, storeLog } from '@/shared/lib/logger';
import { defineStore, defineVanillaStore } from '@/shared/lib/persist/defineStore';

interface Counter {
  count: number;
  label: string;
  items: string[];
  bump: () => void;
}

let sequence = 0;
const uniqueName = () => `write-log-test-${(sequence += 1)}`;

const writesTo = (store: string) =>
  log
    .getRecentLogs()
    .filter((entry) => entry.event === 'store.set' && entry.params?.store === store)
    .map((entry) => entry.params);

function defineCounter(name: string) {
  return defineVanillaStore<Counter>({ name, scope: 'session' })((set) => ({
    count: 0,
    label: 'nsec1-would-be-a-secret',
    items: [],
    bump: () => set((state) => ({ count: state.count + 1 })),
  }));
}

const probesBefore = process.env.EXPO_PUBLIC_PERF_PROBES;
beforeAll(() => {
  process.env.EXPO_PUBLIC_PERF_PROBES = '1';
});
afterAll(() => {
  process.env.EXPO_PUBLIC_PERF_PROBES = probesBefore;
});
afterEach(() => storeLog.setLevel('debug'));

it('logs each write with the store, its scope, the changed keys and the subscribers notified', () => {
  const name = uniqueName();
  const store = defineCounter(name);
  const unsubscribe = store.subscribe(() => {});
  store.subscribe(() => {});

  store.getState().bump();
  store.setState({ label: 'renamed', items: ['a'] });
  unsubscribe();
  store.setState({ count: 5 });

  expect(writesTo(name)).toEqual([
    { store: name, scope: 'session', changed: ['count'], subscribers: 2 },
    { store: name, scope: 'session', changed: ['label', 'items'], subscribers: 2 },
    { store: name, scope: 'session', changed: ['count'], subscribers: 1 },
  ]);
  expect(JSON.stringify(writesTo(name))).not.toContain('nsec1');
  expect(store.getState()).toMatchObject({ count: 5, label: 'renamed', items: ['a'] });
});

it('tells a write that changed nothing apart from one that also notified nobody', () => {
  const name = uniqueName();
  const store = defineCounter(name);
  const listener = jest.fn();
  store.subscribe(listener);

  // Same values in a new state object: zustand still notifies.
  store.setState({ count: 0, items: store.getState().items });
  // The same state object: zustand skips the notification.
  store.setState((state) => state);

  expect(listener).toHaveBeenCalledTimes(1);
  expect(writesTo(name)).toEqual([
    { store: name, scope: 'session', changed: [], subscribers: 1 },
    { store: name, scope: 'session', changed: [], subscribers: 0 },
  ]);
});

it('reports a key removed by a replacing write', () => {
  const name = uniqueName();
  const store = defineVanillaStore<{ a?: number; b: number }>({ name, scope: 'global' })(() => ({
    a: 1,
    b: 2,
  }));
  store.setState({ b: 2 }, true);
  expect(writesTo(name)).toEqual([
    { store: name, scope: 'global', changed: ['a'], subscribers: 0 },
  ]);
  expect(store.getState()).toEqual({ b: 2 });
});

it('keeps every entry of a burst instead of collapsing it into a suppressed count', () => {
  const name = uniqueName();
  const store = defineCounter(name);
  for (let index = 0; index < 6; index += 1) store.getState().bump();
  expect(writesTo(name)).toHaveLength(6);
  expect(log.getRecentLogs().some((entry) => entry.event === 'store.set._suppressed')).toBe(false);
});

it('counts hook and selector subscriptions through middleware, and leaves the store working', () => {
  const name = uniqueName();
  const useStore = defineStore<{ count: number; other: number }>({ name, scope: 'profile' })(
    subscribeWithSelector(() => ({ count: 0, other: 0 }))
  );
  const onCount = jest.fn();
  const unsubscribe = useStore.subscribe((state) => state.count, onCount);

  useStore.setState({ other: 1 });
  useStore.setState({ count: 1 });
  unsubscribe();
  useStore.setState({ count: 2 });

  expect(onCount).toHaveBeenCalledTimes(1);
  expect(onCount).toHaveBeenCalledWith(1, 0);
  expect(writesTo(name)).toEqual([
    { store: name, scope: 'profile', changed: ['other'], subscribers: 1 },
    { store: name, scope: 'profile', changed: ['count'], subscribers: 1 },
    { store: name, scope: 'profile', changed: ['count'], subscribers: 0 },
  ]);
});

it('hands zustand the untouched initializer when debug logging is off', () => {
  storeLog.setLevel('warn');
  const name = uniqueName();
  let received: unknown;
  const store = defineVanillaStore<{ count: number }>({ name, scope: 'session' })((set) => {
    received = set;
    return { count: 0 };
  });
  // Not wrapped: the initializer was given the store's own setState.
  expect(received).toBe(store.setState);

  storeLog.setLevel('debug');
  store.setState({ count: 1 });
  expect(writesTo(name)).toEqual([]);
  expect(store.getState().count).toBe(1);
});

it('stops logging, but keeps writing, when the level is raised after the store exists', () => {
  const name = uniqueName();
  const store = defineCounter(name);
  storeLog.setLevel('warn');
  store.getState().bump();
  expect(store.getState().count).toBe(1);
  expect(writesTo(name)).toEqual([]);
});

it('returns what zustand returns from unsubscribe, and survives a throwing accessor in state', () => {
  const name = uniqueName();
  const store = defineVanillaStore<{ value: number }>({ name, scope: 'session' })(() => ({
    value: 0,
  }));

  const unsubscribe = store.subscribe(() => {});
  expect(unsubscribe()).toBe(true);

  const trap = Object.defineProperty({ value: 1 }, 'value', {
    enumerable: true,
    get() {
      throw new Error('unreadable');
    },
  });
  expect(() => store.setState(trap as { value: number }, true)).not.toThrow();
  expect(writesTo(name).at(-1)).toMatchObject({ changed: ['(unreadable)'] });
});

it('logs nothing unless the perf probes are switched on', () => {
  process.env.EXPO_PUBLIC_PERF_PROBES = '';
  const name = uniqueName();
  const store = defineCounter(name);
  store.getState().bump();
  process.env.EXPO_PUBLIC_PERF_PROBES = '1';

  expect(store.getState().count).toBe(1);
  expect(writesTo(name)).toEqual([]);
});
