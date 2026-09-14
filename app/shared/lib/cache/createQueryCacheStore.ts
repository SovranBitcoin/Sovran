/**
 * Generic query-cache store factory. Produces one Zustand persist store per
 * domain (feed, notifications, search, DM conversations, DM message pages),
 * modeled on `shared/stores/global/nostrMetadataCache.ts` and the rules in
 * `skills/sovran-data/references/caching.md`:
 *   - Zustand `persist` + Zod `looseObject` envelope (data stored as
 *     `z.unknown()`, re-validated on read by the consumer).
 *   - profile-scoped storage by default (`createProfileScopedStorage`),
 *     host-scoped (bare AsyncStorage) when the data isn't viewer-specific.
 *   - LRU eviction by `fetchedAt`, in-flight dedupe, SWR via `useCachedRead`
 *     (`shared/lib/read/useCachedRead.ts`) — the one React consumer.
 *
 * Cold-start vs warm navigation is tracked here via an in-memory touched-epoch
 * map (never persisted), so the cold-start gate costs no AsyncStorage writes.
 *
 * Writes are generation-guarded (SYSTEM.md F01): every `run` for a key takes a
 * new generation, `clear()` bumps a store-wide scope generation, and a
 * completion whose generation is no longer current never writes — an older
 * forced read cannot overwrite a newer result, and a late completion after
 * `clear()` cannot resurrect a wiped entry.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { monotonicNow, storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { currentCacheEpoch } from './cacheSession';
import { evictLruOverCap } from './evictLruOverCap';
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

export interface QueryCacheRunOptions {
  /** Start even if a run for this key is in flight; the older run's write is superseded. */
  force?: boolean;
  /** Caller cancellation: an aborted run never writes and rejects with `SupersededError('abort')`. */
  signal?: AbortSignal;
  /** Correlation id for `query_cache.run.*` and the caller's `read.*` events; minted when absent. */
  readId?: string;
}

/** What a `run` fetcher receives. `partial` writes an early value under the same generation guard. */
export interface QueryCacheRunContext<TData> {
  signal: AbortSignal | undefined;
  readId: string;
  partial: (data: TData, cursor?: string) => void;
}

type QueryCacheSupersededReason = 'newer-request' | 'clear' | 'abort';

/** A run whose completion was no longer current: nothing was written. */
class SupersededError extends Error {
  readonly reason: QueryCacheSupersededReason;
  constructor(reason: QueryCacheSupersededReason) {
    super(`query cache run superseded: ${reason}`);
    this.name = 'SupersededError';
    this.reason = reason;
  }
}

export function isSupersededError(error: unknown): error is SupersededError {
  return error instanceof Error && error.name === 'SupersededError';
}

export interface QueryCacheStore<TData> {
  /**
   * Zustand bound store — subscribe to `s.byKey[key]` for reactive reads.
   *
   * Inside a hook that receives the store as an argument, read it through
   * zustand's static `useStore(store.useCacheState, selector)`, never as
   * `store.useCacheState(selector)`: a hook reached through a parameter is a
   * dynamic hook. The React Compiler classifies hooks by NAME, so the old field
   * `use` was treated as a plain call, memoised behind `$[i] === previousKey`
   * and skipped on re-render — the "change in the order of Hooks" crash in
   * MintReviewsScreen (2026-09-13); a hook-named member bails compilation.
   */
  useCacheState: UseBoundStore<StoreApi<QueryCacheState<TData>>>;
  getEntry: (key: string) => QueryCacheEntry<TData> | undefined;
  setEntry: (key: string, data: TData, meta: { viewerKey: string; cursor?: string }) => void;
  removeEntry: (key: string) => void;
  clear: () => void;
  isFresh: (entry: QueryCacheEntry<TData> | undefined) => boolean;
  isColdStart: (key: string) => boolean;
  markTouched: (key: string) => void;
  /**
   * Run the fetcher, store the result, and mark the key touched. Concurrent
   * calls for the same key join the in-flight run unless `force` is set
   * (pull-to-refresh), in which case the older run is superseded: its
   * completion is not written and its awaiters receive the newer result.
   */
  run: (
    key: string,
    fetcher: (ctx: QueryCacheRunContext<TData>) => Promise<{ data: TData; cursor?: string }>,
    viewerKey: string,
    opts?: QueryCacheRunOptions
  ) => Promise<TData>;
  /** Current per-key generation (tests + the read hook's log params). */
  generation: (key: string) => number;
  staleTtlMs: number;
}

// Every store created this session, so a profile wipe can invalidate all
// in-flight completions at once (`clearAllQueryCaches`).
const registry = new Set<{ clear: () => void }>();

/** Clear every query cache and reject every in-flight completion. */
export function clearAllQueryCaches(): void {
  for (const store of registry) store.clear();
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

  const logCtx = {
    cache: logKey,
    persist: opts.persist !== false,
    hostScoped: !!opts.hostScoped,
    staleTtlMs: opts.staleTtlMs,
    maxEntries,
  };

  const keyMeta = (key: string) => ({
    keyLength: key.length,
    cacheEpoch: currentCacheEpoch(),
  });

  storeLog.info('query_cache.create', logCtx);

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
        const trimmed = evictLruOverCap(next, maxEntries, (entry) => entry.fetchedAt);
        if (trimmed) {
          storeLog.warn('query_cache.evict_lru', {
            ...logCtx,
            beforeCount: trimmed.evicted + trimmed.remaining,
            evictCount: trimmed.evicted,
            afterCount: trimmed.remaining,
          });
        }
        storeLog.debug('query_cache.entry.set', {
          ...logCtx,
          ...keyMeta(key),
          beforeCount: Object.keys(state.byKey).length,
          afterCount: Object.keys(next).length,
          hadEntry: !!state.byKey[key],
          viewerKeyLength: meta.viewerKey.length,
          hasCursor: !!meta.cursor,
          dataKind: Array.isArray(data) ? 'array' : typeof data,
        });
        return { byKey: next };
      });
    },
    removeEntry: (key) =>
      set((state) => {
        const existed = !!state.byKey[key];
        storeLog.debug('query_cache.entry.remove', {
          ...logCtx,
          ...keyMeta(key),
          existed,
          beforeCount: Object.keys(state.byKey).length,
        });
        if (!state.byKey[key]) return state;
        const next = { ...state.byKey };
        delete next[key];
        return { byKey: next };
      }),
    clear: () => {
      const beforeCount = Object.keys(use.getState().byKey).length;
      scopeGen += 1;
      genByKey.clear();
      inFlight.clear();
      latestRun.clear();
      storeLog.info('query_cache.clear', {
        ...logCtx,
        beforeCount,
        scopeGen,
      });
      set({ byKey: {} });
    },
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
  // Generation guards. `genByKey` advances per run; `scopeGen` advances on
  // clear(). A completion writes only if both still match what it started with.
  const genByKey = new Map<string, number>();
  let scopeGen = 0;
  const inFlight = new Map<string, { gen: number; promise: Promise<TData> }>();
  // The newest run per key, kept after it settles so a superseded older run can
  // still hand its awaiters the result that actually won (cleared on clear()).
  const latestRun = new Map<string, { gen: number; promise: Promise<TData> }>();

  const getEntry = (key: string): QueryCacheEntry<TData> | undefined => use.getState().byKey[key];
  const isFresh = (entry: QueryCacheEntry<TData> | undefined): boolean =>
    !!entry && Date.now() - entry.fetchedAt < opts.staleTtlMs;
  const isColdStart = (key: string): boolean => touchedEpochByKey.get(key) !== currentCacheEpoch();
  const markTouched = (key: string): void => {
    touchedEpochByKey.set(key, currentCacheEpoch());
    storeLog.debug('query_cache.touch', {
      ...logCtx,
      ...keyMeta(key),
    });
  };
  const generation = (key: string): number => genByKey.get(key) ?? 0;

  const run: QueryCacheStore<TData>['run'] = (key, fetcher, viewerKey, runOpts = {}) => {
    const existing = inFlight.get(key);
    if (existing && !runOpts.force) {
      storeLog.debug('query_cache.run.join_inflight', {
        ...logCtx,
        ...keyMeta(key),
        readId: runOpts.readId ?? null,
        gen: existing.gen,
        viewerKeyLength: viewerKey.length,
      });
      return existing.promise;
    }
    const gen = generation(key) + 1;
    genByKey.set(key, gen);
    const myScope = scopeGen;
    const readId = runOpts.readId ?? `qc${gen.toString(36)}-${logKey}`;
    const t0 = monotonicNow();
    const elapsed = () => Math.round((monotonicNow() - t0) * 100) / 100;
    storeLog.info('query_cache.run.start', {
      ...logCtx,
      ...keyMeta(key),
      readId,
      gen,
      force: !!runOpts.force,
      viewerKeyLength: viewerKey.length,
      hadEntry: !!getEntry(key),
      fresh: isFresh(getEntry(key)),
    });

    const currency = (): 'ok' | QueryCacheSupersededReason => {
      if (runOpts.signal?.aborted) return 'abort';
      if (scopeGen !== myScope) return 'clear';
      if (genByKey.get(key) !== gen) return 'newer-request';
      return 'ok';
    };

    const partial = (data: TData, cursor?: string): void => {
      if (currency() !== 'ok') return;
      use.getState().setEntry(key, data, { viewerKey, cursor });
      storeLog.debug('query_cache.run.partial', { ...logCtx, ...keyMeta(key), readId, gen });
    };

    const promise = fetcher({ signal: runOpts.signal, readId, partial }).then(
      ({ data, cursor }): TData | Promise<TData> => {
        const state = currency();
        if (state !== 'ok') {
          storeLog.info('query_cache.run.superseded', {
            ...logCtx,
            ...keyMeta(key),
            readId,
            gen,
            currentGen: generation(key),
            reason: state,
            duration_ms: elapsed(),
          });
          // A newer run for the same key exists: hand its result to whoever awaited us.
          const newer = state === 'newer-request' ? latestRun.get(key) : undefined;
          if (newer && newer.gen !== gen) return newer.promise;
          throw new SupersededError(state);
        }
        use.getState().setEntry(key, data, { viewerKey, cursor });
        markTouched(key);
        storeLog.info('query_cache.run.done', {
          ...logCtx,
          ...keyMeta(key),
          readId,
          gen,
          duration_ms: elapsed(),
          hasCursor: !!cursor,
          dataKind: Array.isArray(data) ? 'array' : typeof data,
        });
        return data;
      },
      (error: unknown) => {
        storeLog.warn('query_cache.run.failed', {
          ...logCtx,
          ...keyMeta(key),
          readId,
          gen,
          duration_ms: elapsed(),
          superseded: currency() !== 'ok',
          error: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }
    );
    inFlight.set(key, { gen, promise });
    latestRun.set(key, { gen, promise });
    const cleanup = () => {
      if (inFlight.get(key)?.promise === promise) {
        inFlight.delete(key);
        storeLog.debug('query_cache.run.cleanup', {
          ...logCtx,
          ...keyMeta(key),
          readId,
        });
      }
    };
    promise.then(cleanup, cleanup);
    return promise;
  };

  const store: QueryCacheStore<TData> = {
    useCacheState: use,
    getEntry,
    setEntry: (key, data, meta) => use.getState().setEntry(key, data, meta),
    removeEntry: (key) => use.getState().removeEntry(key),
    clear: () => use.getState().clear(),
    isFresh,
    isColdStart,
    markTouched,
    run,
    generation,
    staleTtlMs: opts.staleTtlMs,
  };
  registry.add(store);
  return store;
}
