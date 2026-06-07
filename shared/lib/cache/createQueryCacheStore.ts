/**
 * Generic query-cache store factory. Produces one Zustand persist store per
 * domain (feed, notifications, search, DM conversations, DM message pages),
 * modeled on `shared/stores/global/nostrMetadataCache.ts` and the rules in
 * `../.agents/skills/sovran-data-runtime/references/caching.md`:
 *   - Zustand `persist` + Zod `looseObject` envelope (data stored as
 *     `z.unknown()`, re-validated on read by the consumer).
 *   - profile-scoped storage by default (`createProfileScopedStorage`),
 *     host-scoped (bare AsyncStorage) when the data isn't viewer-specific.
 *   - LRU eviction by `fetchedAt`, in-flight dedupe, SWR via `useCachedQuery`.
 *
 * Cold-start vs warm navigation is tracked here via an in-memory touched-epoch
 * map (never persisted), so the cold-start gate costs no AsyncStorage writes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { currentCacheEpoch } from './cacheSession';
import type { QueryCacheEntry } from './queryCacheTypes';

interface QueryCacheStoreOptions {
  /** Kebab-case AsyncStorage key, e.g. `'feed-cache'`. */
  name: string;
  /** Snake_case log slug; defaults to `name` with dashes replaced. */
  logKey?: string;
  /** How long a written entry stays fresh before it's revalidated. */
  staleTtlMs: number;
  /** Max number of cached keys before LRU eviction kicks in. */
  maxEntries?: number;
  /** True for data that isn't viewer-specific (uses bare AsyncStorage). */
  hostScoped?: boolean;
  /**
   * When false, the store is in-memory only (no persistence). Use for data
   * whose shape isn't JSON-safe (e.g. holds Map objects) or where a fresh
   * fetch on every cold launch is desired anyway — an in-memory store resets
   * each JS start, which is exactly the cold-start behaviour. Defaults to true.
   */
  persist?: boolean;
}

interface QueryCacheState<TData> {
  byKey: Record<string, QueryCacheEntry<TData>>;
  setEntry: (key: string, data: TData, meta: { viewerKey: string; cursor?: string }) => void;
  removeEntry: (key: string) => void;
  clear: () => void;
}

interface QueryCacheStore<TData> {
  /** Zustand hook — subscribe to `s.byKey[key]` for reactive reads. */
  use: UseBoundStore<StoreApi<QueryCacheState<TData>>>;
  getEntry: (key: string) => QueryCacheEntry<TData> | undefined;
  setEntry: (key: string, data: TData, meta: { viewerKey: string; cursor?: string }) => void;
  removeEntry: (key: string) => void;
  clear: () => void;
  isFresh: (entry: QueryCacheEntry<TData> | undefined) => boolean;
  isColdStart: (key: string) => boolean;
  markTouched: (key: string) => void;
  /**
   * Run the fetcher, store the result, and mark the key touched. Concurrent
   * calls for the same key are deduped unless `force` is set (pull-to-refresh).
   */
  run: (
    key: string,
    fetcher: () => Promise<{ data: TData; cursor?: string }>,
    viewerKey: string,
    force?: boolean
  ) => Promise<TData>;
  staleTtlMs: number;
}

const PersistedEntry = z.looseObject({
  data: z.unknown(),
  fetchedAt: z.number().int().nonnegative(),
  viewerKey: z.string().max(128).default(''),
  cursor: z.string().max(2048).optional(),
});

const PersistedSchema = z.object({
  byKey: z.record(z.string().max(256), PersistedEntry).default({}),
});

export function createQueryCacheStore<TData>(opts: QueryCacheStoreOptions): QueryCacheStore<TData> {
  const maxEntries = opts.maxEntries ?? 200;
  const logKey = opts.logKey ?? opts.name.replace(/-/g, '_');

  function evictIfOverCap(byKey: Record<string, QueryCacheEntry<TData>>): void {
    const keys = Object.keys(byKey);
    if (keys.length <= maxEntries) return;
    const evictCount = Math.max(1, Math.floor(maxEntries * 0.1));
    const sorted = Object.entries(byKey).sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    for (let i = 0; i < evictCount; i++) delete byKey[sorted[i][0]];
  }

  const creator: StateCreator<QueryCacheState<TData>> = (set) => ({
    byKey: {},
    setEntry: (key, data, meta) => {
      set((state) => {
        const next = {
          ...state.byKey,
          [key]: {
            data,
            fetchedAt: Date.now(),
            viewerKey: meta.viewerKey,
            ...(meta.cursor ? { cursor: meta.cursor } : {}),
          },
        };
        evictIfOverCap(next);
        return { byKey: next };
      });
    },
    removeEntry: (key) =>
      set((state) => {
        if (!state.byKey[key]) return state;
        const next = { ...state.byKey };
        delete next[key];
        return { byKey: next };
      }),
    clear: () => set({ byKey: {} }),
  });

  const use =
    opts.persist === false
      ? create<QueryCacheState<TData>>()(creator)
      : create<QueryCacheState<TData>>()(
          persist(
            creator,
            persistConfig<QueryCacheState<TData>, Pick<QueryCacheState<TData>, 'byKey'>>({
              name: opts.name,
              storage: opts.hostScoped ? AsyncStorage : createProfileScopedStorage(),
              schema: PersistedSchema,
              logKey,
              partialize: (state) => ({ byKey: state.byKey }),
            })
          )
        );

  // In-memory only (never persisted): which keys were touched this session.
  const touchedEpochByKey = new Map<string, number>();
  const inFlight = new Map<string, Promise<TData>>();

  const getEntry = (key: string): QueryCacheEntry<TData> | undefined => use.getState().byKey[key];
  const isFresh = (entry: QueryCacheEntry<TData> | undefined): boolean =>
    !!entry && Date.now() - entry.fetchedAt < opts.staleTtlMs;
  const isColdStart = (key: string): boolean => touchedEpochByKey.get(key) !== currentCacheEpoch();
  const markTouched = (key: string): void => {
    touchedEpochByKey.set(key, currentCacheEpoch());
  };

  const run = (
    key: string,
    fetcher: () => Promise<{ data: TData; cursor?: string }>,
    viewerKey: string,
    force = false
  ): Promise<TData> => {
    if (!force) {
      const existing = inFlight.get(key);
      if (existing) return existing;
    }
    const promise = fetcher().then(({ data, cursor }) => {
      use.getState().setEntry(key, data, { viewerKey, cursor });
      markTouched(key);
      return data;
    });
    inFlight.set(key, promise);
    const cleanup = () => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    };
    promise.then(cleanup, cleanup);
    return promise;
  };

  return {
    use,
    getEntry,
    setEntry: (key, data, meta) => use.getState().setEntry(key, data, meta),
    removeEntry: (key) => use.getState().removeEntry(key),
    clear: () => use.getState().clear(),
    isFresh,
    isColdStart,
    markTouched,
    run,
    staleTtlMs: opts.staleTtlMs,
  };
}
