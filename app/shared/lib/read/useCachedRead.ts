/**
 * `useCachedRead` — the one React consumer of `createQueryCacheStore`.
 *
 * Paints whatever the store holds SYNCHRONOUSLY (so a tab switch, re-entry or
 * key change never shows a spinner over data we already have), serves a fresh
 * entry with zero round-trips, revalidates a stale one in the background, and
 * supersedes in-flight work by generation + AbortSignal so a late completion
 * cannot paint the wrong key. Emits the `read.<surface>.*` lifecycle events.
 *
 * It is not a second cache layer: the only state it owns is "what is in flight
 * for this mount" and "the last failure"; `data` is literally the store
 * selector. Persistence, LRU, scope and cold-start policy stay in the store
 * (SYSTEM.md §14).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import {
  isSupersededError,
  type QueryCacheRunContext,
  type QueryCacheStore,
} from '@/shared/lib/cache/createQueryCacheStore';
import type { QueryCacheEntry } from '@/shared/lib/cache/queryCacheTypes';
import { monotonicNow } from '@/shared/lib/logger';
import {
  newReadId,
  readErrorType,
  readEvents,
  readKeyHash,
  type ReadAction,
  type ReadMode,
  type ReadSource,
  type ReadSurface,
  type ReadTrigger,
  type RenderPhase,
} from './readLog';

export type ReadStatus = 'loading' | 'revalidating' | 'ready' | 'empty' | 'error';

export interface CachedReadFetchContext<TData> extends QueryCacheRunContext<TData> {
  /** The entry that was on screen when the read started (stale-while-revalidate input). */
  cached: TData | undefined;
}

export interface UseCachedReadOptions<TData> {
  store: QueryCacheStore<TData>;
  surface: ReadSurface;
  /** `null`/`undefined` disables the read (no viewer yet, client-only tab). */
  key: string | null | undefined;
  viewerKey: string;
  fetcher: (ctx: CachedReadFetchContext<TData>) => Promise<{ data: TData; cursor?: string }>;
  /**
   * A synchronous value from a PRIOR step (route seed, entity cache) shown
   * while the first fetch runs. Must be cheap: it is evaluated on render. It is
   * not written to the store, so a fetch still happens.
   */
  seed?: () => TData | undefined;
  /**
   * Data present but nothing to show → `'empty'`; a result carrying an
   * "unavailable" marker (SYSTEM.md F06) → `'error'`. Default: `'ready'`.
   */
  classify?: (data: TData) => 'ready' | 'empty' | 'error';
  /**
   * When the key changes to an UNCACHED key, keep the previous key's data on
   * screen as `'revalidating'` iff this returns true (a search refinement is
   * the same surface; a tab is not). Default: never.
   */
  keepPreviousData?: (previousKey: string, nextKey: string) => boolean;
  /**
   * First access this session: `'paint-stale'` (default, SYSTEM.md §14) shows
   * a persisted entry immediately; `'skeleton'` hides it until the network
   * answers (feeds that must not show yesterday's page).
   */
  coldStart?: 'paint-stale' | 'skeleton';
  /** Revalidate on refocus when the entry is stale (default true). A fresh entry is never refetched. */
  focusRevalidate?: boolean;
  enabled?: boolean;
  /** How this read resolves, for the log only. Default `'http'`. */
  strategy?: 'sequential' | 'aggregate' | 'session' | 'http';
}

export interface UseCachedReadResult<TData> {
  data: TData | undefined;
  status: ReadStatus;
  /** Where the visible data came from. */
  source: ReadSource | undefined;
  stale: boolean;
  /** A `partial()` write from the current fetch is on screen; more is coming. */
  partial: boolean;
  isFetching: boolean;
  /** Which kind of read is in flight (`'refresh'` = user-triggered), or null. */
  mode: ReadMode | null;
  error: unknown;
  /** Forced refresh (pull-to-refresh / retry). Supersedes any in-flight run for this key. */
  refresh: () => void;
  readId: string | null;
}

type Flight<TData> = {
  key: string;
  readId: string;
  gen: number;
  /** Monotonic start, for durations. */
  t0: number;
  /** The entry on screen when the read started; a different object means the read landed. */
  startEntry: QueryCacheEntry<TData> | undefined;
  mode: ReadMode;
  partial: boolean;
};

/** Usable-item count for the `count` log params. Arrays and common list envelopes. */
export function countOf(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    for (const k of [
      'items',
      'notifications',
      'results',
      'hits',
      'mints',
      'changes',
      'envelopes',
      'reviews',
    ]) {
      if (Array.isArray(o[k])) return (o[k] as unknown[]).length;
    }
    return 1;
  }
  return data === undefined || data === null ? 0 : 1;
}

function phaseOf(status: ReadStatus): RenderPhase {
  if (status === 'loading') return 'skeleton';
  if (status === 'ready') return 'populated';
  return status;
}

export function useCachedRead<TData>(
  options: UseCachedReadOptions<TData>
): UseCachedReadResult<TData> {
  const {
    store,
    surface,
    key,
    viewerKey,
    enabled = true,
    focusRevalidate = true,
    coldStart = 'paint-stale',
    strategy = 'http',
  } = options;
  const keyHash = key ? readKeyHash(key) : 'k_none';

  // 1. The visible value IS the store entry. A viewer-key mismatch reads as
  //    absent so a late completion for another profile can never paint here.
  const rawEntry = store.use((s) => (key ? s.byKey[key] : undefined));
  const entry = rawEntry && rawEntry.viewerKey === viewerKey ? rawEntry : undefined;

  // 2. The last key that had data, so a key change can keep it on screen when
  //    the caller says the new key is the same conceptual surface. Kept in
  //    state (not a ref) so it is safe to read during render.
  const [lastKeyWithData, setLastKeyWithData] = useState<string | null>(null);
  useEffect(() => {
    if (entry && key) setLastKeyWithData(key);
  }, [entry, key]);
  const previousKey = lastKeyWithData && key && lastKeyWithData !== key ? lastKeyWithData : null;
  const previousEntry = store.use((s) => (previousKey ? s.byKey[previousKey] : undefined));
  const keep =
    !entry &&
    !!key &&
    !!previousKey &&
    !!previousEntry &&
    previousEntry.viewerKey === viewerKey &&
    !!options.keepPreviousData?.(previousKey, key);

  // 3. Per-mount transient state — never data.
  const [flight, setFlight] = useState<Flight<TData> | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: unknown } | null>(null);
  const fetcherRef = useRef(options.fetcher);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    fetcherRef.current = options.fetcher;
  });

  const start = useCallback(
    (mode: ReadMode, trigger: ReadTrigger) => {
      if (!enabled || !key) return;
      const cachedEntry = store.getEntry(key);
      const cachedForViewer =
        cachedEntry && cachedEntry.viewerKey === viewerKey ? cachedEntry : undefined;
      const fresh = store.isFresh(cachedForViewer);
      const cold = store.isColdStart(key);
      const force = mode === 'refresh';
      let action: ReadAction = 'fetch';
      if (!force && cachedForViewer && fresh) action = 'serve-fresh';
      else if (!force && cachedForViewer && !fresh) action = 'serve-stale-revalidate';
      const readId = newReadId(surface);
      const gen = store.generation(key) + (action === 'serve-fresh' ? 0 : 1);
      readEvents.request({
        readId,
        surface,
        keyHash: readKeyHash(key),
        mode,
        trigger,
        action,
        strategy,
        cached: !!cachedForViewer,
        stale: !!cachedForViewer && !fresh,
        coldStart: cold,
        gen,
      });
      if (action === 'serve-fresh') {
        // Zero round-trips: the "use the cached version" rule.
        store.markTouched(key);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const t0 = monotonicNow();
      setFlight({ key, readId, gen, t0, startEntry: cachedForViewer, mode, partial: false });
      const superseded = (reason: 'newer-request' | 'clear' | 'abort') =>
        readEvents.superseded({ readId, surface, keyHash: readKeyHash(key), gen, reason });

      void store
        .run(
          key,
          (ctx) =>
            fetcherRef.current({
              ...ctx,
              cached: cachedForViewer?.data,
              partial: (data, cursor) => {
                ctx.partial(data, cursor);
                if (controller.signal.aborted) return;
                setFlight((f) => (f && f.readId === readId ? { ...f, partial: true } : f));
                readEvents.partial({
                  readId,
                  surface,
                  keyHash: readKeyHash(key),
                  answered: ['partial'],
                  pending: [],
                  count: countOf(data),
                  gate: 'partial',
                });
              },
            }),
          viewerKey,
          { force, signal: controller.signal, readId }
        )
        .then((data) => {
          if (controller.signal.aborted) return;
          setFailure(null);
          readEvents.done({
            readId,
            surface,
            keyHash: readKeyHash(key),
            gen,
            durationMs: Math.round(monotonicNow() - t0),
            source: 'network',
            count: countOf(data),
            empty: countOf(data) === 0,
            degraded: false,
            complete: true,
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            superseded('abort');
            return;
          }
          if (isSupersededError(error)) {
            superseded(error.reason);
            return;
          }
          readEvents.failed({
            readId,
            surface,
            keyHash: readKeyHash(key),
            gen,
            durationMs: Math.round(monotonicNow() - t0),
            errorType: readErrorType(error),
            retained: !!store.getEntry(key),
          });
          setFailure({ key, error });
        })
        .finally(() => {
          if (controller.signal.aborted) return;
          setFlight((f) => (f?.readId === readId ? null : f));
        });
    },
    [enabled, key, store, surface, viewerKey, strategy]
  );

  // 4. Focus drives the lifecycle: first focus (or a key change) is the
  //    initial read; a later refocus revalidates only when stale. Blur does NOT
  //    abort the store run — its result still belongs in the cache and the
  //    generation guard keeps it safe — it only stops this mount from
  //    observing it. Unmount aborts so nothing sets state afterwards.
  const focusedKeyRef = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !key) return;
      const first = focusedKeyRef.current !== key;
      const hadPrevious = focusedKeyRef.current !== null;
      focusedKeyRef.current = key;
      if (first) start('initial', hadPrevious ? 'key-change' : 'mount');
      else if (focusRevalidate) start('revalidate', 'focus');
    }, [enabled, key, focusRevalidate, start])
  );
  useEffect(() => () => abortRef.current?.abort(), []);

  // 5. Derive the visible value + status.
  const seeded = !entry && !keep ? options.seed?.() : undefined;
  // "In flight" ends the moment this read's result is in the store — the
  // flight state clears one commit later, and that gap must not read as a
  // revalidating→populated transition. A partial write does not end it.
  const landed = !!flight && !!entry && !flight.partial && entry !== flight.startEntry;
  const fetching = !!flight && flight.key === key && !landed;
  const failed = !!failure && failure.key === key;
  const stale = !!entry && !store.isFresh(entry);
  const hideStaleOnCold =
    coldStart === 'skeleton' && !!entry && !!key && store.isColdStart(key) && fetching;
  const data: TData | undefined =
    entry && !hideStaleOnCold ? entry.data : keep ? previousEntry!.data : seeded;
  let source: ReadSource | undefined;
  if (entry && !hideStaleOnCold)
    source = flight?.partial && fetching ? 'partial' : fetching ? 'cache' : 'network';
  else if (keep) source = 'cache';
  else if (seeded !== undefined) source = 'seed';

  let status: ReadStatus;
  if (data !== undefined) {
    const cls = options.classify?.(data) ?? 'ready';
    if (cls === 'error') status = 'error';
    else if (fetching || keep || seeded !== undefined) status = 'revalidating';
    else status = cls;
  } else if (failed) status = 'error';
  else status = 'loading';

  // 6. Lifecycle logs on transitions only.
  const readId = flight && flight.key === key ? flight.readId : null;
  const appliedRef = useRef<TData | undefined>(undefined);
  useEffect(() => {
    if (appliedRef.current === data) return;
    const replaced = appliedRef.current !== undefined;
    appliedRef.current = data;
    if (data === undefined || !source) return;
    readEvents.applied({
      readId,
      surface,
      keyHash,
      source,
      count: countOf(data),
      replaced,
      ...(flight ? { sinceRequestMs: Math.round(monotonicNow() - flight.t0) } : {}),
    });
    // Runs on any dep change; the ref compare above makes it emit only when the
    // visible value actually changed.
  }, [data, source, readId, surface, keyHash, flight]);
  const phaseRef = useRef<RenderPhase | null>(null);
  useEffect(() => {
    const phase = phaseOf(status);
    if (phaseRef.current === phase) return;
    readEvents.render({
      readId,
      surface,
      keyHash,
      phase,
      from: phaseRef.current,
      count: data === undefined ? 0 : countOf(data),
      ...(phase === 'populated' && flight
        ? { sinceRequestMs: Math.round(monotonicNow() - flight.t0) }
        : {}),
    });
    phaseRef.current = phase;
    // Runs on any dep change; the ref compare above makes it emit only on a
    // phase edge.
  }, [status, data, readId, surface, keyHash, flight]);

  const refresh = useCallback(() => start('refresh', 'user'), [start]);

  return {
    data,
    status,
    source,
    stale,
    partial: !!flight?.partial && fetching,
    isFetching: fetching,
    mode: fetching ? flight!.mode : null,
    error: failed ? failure!.error : null,
    refresh,
    readId,
  };
}
