import { useEffect, useMemo, useState } from 'react';

import {
  fetchMempoolAddressStats,
  MempoolAddressStatsSchema,
  summarizeMempoolAddress,
  type MempoolAddressSummary,
} from 'wallet';
import {
  getCachedMempoolAddressStats,
  useMempoolAddressCache,
} from '@/shared/stores/global/mempoolAddressCache';
import { log } from '@/shared/lib/logger';

const MEMPOOL_ADDRESS_POLL_MS = 70_000;

type CacheSummaryState =
  | { status: 'missing'; summary: null }
  | {
      status: 'invalid';
      summary: null;
      issueCount: number;
      issues: { path: string; code: string }[];
    }
  | { status: 'parsed'; summary: MempoolAddressSummary };

function summarizeAddress(address: string | null): Record<string, unknown> {
  return {
    hasAddress: !!address,
    addressLength: address?.length ?? 0,
  };
}

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
      log.debug('mempool.address.summary.idle', { reason: 'missing_address' });
      setIsRefreshing(false);
      setError(null);
      return;
    }

    let mounted = true;
    const controllers = new Set<AbortController>();
    log.info('mempool.address.summary.subscribe', {
      ...summarizeAddress(normalizedAddress),
      pollMs: MEMPOOL_ADDRESS_POLL_MS,
    });

    const refresh = (useCache: boolean) => {
      const controller = new AbortController();
      controllers.add(controller);
      setIsRefreshing(true);
      setError(null);
      const startedAt = Date.now();
      log.info('mempool.address.summary.refresh.start', {
        ...summarizeAddress(normalizedAddress),
        useCache,
        activeRequests: controllers.size,
      });

      const fetcher = (addr: string) =>
        fetchMempoolAddressStats(addr, { signal: controller.signal });
      const request = useCache
        ? getCachedMempoolAddressStats(fetcher, normalizedAddress)
        : fetcher(normalizedAddress).then((stats) => {
            useMempoolAddressCache.getState().setAddressStats(normalizedAddress, stats);
            return stats;
          });

      request
        .then((stats) => {
          log.info('mempool.address.summary.refresh.done', {
            ...summarizeAddress(normalizedAddress),
            useCache,
            confirmedTxCount: stats.chain_stats.tx_count,
            mempoolTxCount: stats.mempool_stats.tx_count,
            durationMs: Date.now() - startedAt,
          });
        })
        .catch((err) => {
          if (!controller.signal.aborted && mounted) {
            setError(err instanceof Error ? err : new Error(String(err)));
            log.warn('mempool.address.summary.refresh.failed', {
              ...summarizeAddress(normalizedAddress),
              useCache,
              durationMs: Date.now() - startedAt,
              error: err instanceof Error ? err : new Error(String(err)),
            });
            return;
          }
          log.debug('mempool.address.summary.refresh.ignored', {
            ...summarizeAddress(normalizedAddress),
            useCache,
            aborted: controller.signal.aborted,
            mounted,
            durationMs: Date.now() - startedAt,
          });
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
      log.info('mempool.address.summary.unsubscribe', {
        ...summarizeAddress(normalizedAddress),
        activeRequests: controllers.size,
      });
    };
  }, [normalizedAddress]);

  const cacheSummary = useMemo<CacheSummaryState>(() => {
    if (!cacheEntry) return { status: 'missing', summary: null };
    const parsed = MempoolAddressStatsSchema.safeParse(cacheEntry.stats);
    if (!parsed.success) {
      return {
        status: 'invalid',
        summary: null,
        issueCount: parsed.error.issues.length,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
        })),
      };
    }
    return {
      status: 'parsed',
      summary: summarizeMempoolAddress(parsed.data),
    };
  }, [cacheEntry]);

  useEffect(() => {
    if (cacheSummary.status === 'missing') {
      log.debug('mempool.address.summary.cache_entry.missing', {
        ...summarizeAddress(normalizedAddress),
      });
      return;
    }
    if (cacheSummary.status === 'invalid') {
      log.warn('mempool.address.summary.cache_entry.invalid', {
        ...summarizeAddress(normalizedAddress),
        issueCount: cacheSummary.issueCount,
        issues: cacheSummary.issues,
      });
      return;
    }
    log.debug('mempool.address.summary.cache_entry.parsed', {
      ...summarizeAddress(normalizedAddress),
      confirmedTxCount: cacheSummary.summary.confirmedTxCount,
      unconfirmedTxCount: cacheSummary.summary.unconfirmedTxCount,
      totalReceivedSats: cacheSummary.summary.totalReceivedSats,
    });
  }, [cacheSummary, normalizedAddress]);

  const summary = cacheSummary.summary;

  return {
    summary,
    isLoading: !summary && isRefreshing,
    isRefreshing,
    error,
  };
}
