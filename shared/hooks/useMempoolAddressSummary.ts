import { useEffect, useMemo, useState } from 'react';

import {
  fetchMempoolAddressStats,
  MempoolAddressStatsSchema,
  summarizeMempoolAddress,
  type MempoolAddressSummary,
} from 'colada';
import {
  getCachedMempoolAddressStats,
  useMempoolAddressCache,
} from '@/shared/stores/global/mempoolAddressCache';

const MEMPOOL_ADDRESS_POLL_MS = 70_000;

export function useMempoolAddressSummary(address: string | null | undefined): {
  summary: MempoolAddressSummary | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
} {
  const normalizedAddress = address?.trim() || null;
  const cacheEntry = useMempoolAddressCache((state) =>
    normalizedAddress ? state.byAddress[normalizedAddress] : undefined
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!normalizedAddress) {
      setIsRefreshing(false);
      setError(null);
      return;
    }

    let mounted = true;
    const controllers = new Set<AbortController>();

    const refresh = (useCache: boolean) => {
      const controller = new AbortController();
      controllers.add(controller);
      setIsRefreshing(true);
      setError(null);

      const fetcher = (addr: string) =>
        fetchMempoolAddressStats(addr, { signal: controller.signal });
      const request = useCache
        ? getCachedMempoolAddressStats(fetcher, normalizedAddress)
        : fetcher(normalizedAddress).then((stats) => {
            useMempoolAddressCache.getState().setAddressStats(normalizedAddress, stats);
            return stats;
          });

      request
        .catch((err) => {
          if (!controller.signal.aborted && mounted) {
            setError(err instanceof Error ? err : new Error(String(err)));
          }
        })
        .finally(() => {
          controllers.delete(controller);
          if (mounted && controllers.size === 0) setIsRefreshing(false);
        });
    };

    refresh(true);
    const interval = setInterval(() => refresh(false), MEMPOOL_ADDRESS_POLL_MS);

    return () => {
      mounted = false;
      clearInterval(interval);
      controllers.forEach((controller) => controller.abort());
    };
  }, [normalizedAddress]);

  const summary = useMemo(() => {
    if (!cacheEntry) return null;
    const parsed = MempoolAddressStatsSchema.safeParse(cacheEntry.stats);
    if (!parsed.success) return null;
    return summarizeMempoolAddress(parsed.data);
  }, [cacheEntry]);

  return {
    summary,
    isLoading: !summary && isRefreshing,
    isRefreshing,
    error,
  };
}
