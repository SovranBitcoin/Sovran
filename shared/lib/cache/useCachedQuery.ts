/**
 * The single hook every cached list screen uses. Encodes the app's cache
 * policy:
 *   - COLD START (key not touched this app session): hide cache, show loading,
 *     fetch fresh, then paint. Avoids the jarring stale→fresh swap on reopen.
 *   - WARM NAVIGATION (key already touched this session): paint cache instantly,
 *     revalidate in the background if stale (SWR).
 *   - PULL-TO-REFRESH (`refresh()`): force a network call (server-cache bypass),
 *     replace the entry, ignore TTL.
 *
 * A viewer change re-keys the query, which naturally re-triggers cold-start.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import type { QueryCacheStore } from './createQueryCacheStore';

export type CachedQueryStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseCachedQueryArgs<TData> {
  store: QueryCacheStore<TData>;
  /** Cache key. `null` disables the query. */
  key: string | null;
  /** Viewer pubkey stored on the entry (`''` for host-scoped). */
  viewerKey: string;
  /** Performs the network fetch. `refresh` true bypasses the server cache. */
  fetcher: (args: {
    refresh: boolean;
    signal: AbortSignal;
  }) => Promise<{ data: TData; cursor?: string }>;
  /** Optional schema; a parse failure treats the cached entry as a miss. */
  dataSchema?: z.ZodType<unknown>;
  enabled?: boolean;
}

export interface UseCachedQueryResult<TData> {
  data: TData | undefined;
  status: CachedQueryStatus;
  isColdStart: boolean;
  isRevalidating: boolean;
  error: unknown;
  refresh: () => void;
}

export function useCachedQuery<TData>(
  args: UseCachedQueryArgs<TData>
): UseCachedQueryResult<TData> {
  const { store, key, viewerKey, fetcher, dataSchema, enabled = true } = args;

  const entry = store.use((s) => (key ? s.byKey[key] : undefined));
  const [status, setStatus] = useState<CachedQueryStatus>('idle');
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [coldStart, setColdStart] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const validate = useCallback(
    (candidate: { data: TData } | undefined): TData | undefined => {
      if (!candidate) return undefined;
      if (dataSchema && !dataSchema.safeParse(candidate.data).success) return undefined;
      return candidate.data;
    },
    [dataSchema]
  );

  const doFetch = useCallback(
    async (refresh: boolean) => {
      if (!key) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await store.run(
          key,
          () => fetcher({ refresh, signal: controller.signal }),
          viewerKey,
          refresh
        );
        if (!controller.signal.aborted) {
          setStatus('success');
          setError(null);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          // Keep showing last-good data if we already had a successful paint.
          setStatus((prev) => (prev === 'success' ? 'success' : 'error'));
          setError(err);
        }
      } finally {
        if (!controller.signal.aborted) setIsRevalidating(false);
      }
    },
    [key, viewerKey, fetcher, store]
  );

  useEffect(() => {
    if (!enabled || !key) {
      setStatus('idle');
      return;
    }
    const cold = store.isColdStart(key);
    setColdStart(cold);
    const existing = store.getEntry(key);
    if (cold) {
      setStatus('loading');
      void doFetch(false);
    } else if (existing) {
      setStatus('success');
      if (!store.isFresh(existing)) {
        setIsRevalidating(true);
        void doFetch(false);
      }
    } else {
      setStatus('loading');
      void doFetch(false);
    }
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, viewerKey, enabled]);

  const refresh = useCallback(() => {
    if (!key) return;
    setIsRevalidating(true);
    void doFetch(true);
  }, [key, doFetch]);

  // On a cold start, hide the cached entry until the fresh fetch lands.
  const data = coldStart && status === 'loading' ? undefined : validate(entry);

  return { data, status, isColdStart: coldStart, isRevalidating, error, refresh };
}
