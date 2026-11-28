import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import {
  fetchMempoolAddressStats,
  MempoolAddressStatsSchema,
  summarizeMempoolAddress,
  type MempoolAddressSummary,
} from 'wallet';
import { useMempoolAddressCache } from '@/shared/stores/global/mempoolAddressCache';
import { log } from '@/shared/lib/logger';

const MEMPOOL_ADDRESS_POLL_MS = 70_000;

const inForeground = () => AppState.currentState !== 'background';

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

interface MempoolAddressWatchOptions {
  /**
   * Read only while the address is on screen. A hidden tab, a screen under
   * another one or a backgrounded app keeps the last summary and asks again,
   * at once, when shown.
   */
  enabled?: boolean;
  /** Stop asking once nothing the page shows can change (e.g. confirmed and credited). */
  isSettled?: (summary: MempoolAddressSummary) => boolean;
}

export function useMempoolAddressSummary(
  address: string | null | undefined,
  { enabled = true, isSettled }: MempoolAddressWatchOptions = {}
): {
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
  const settled = !!cacheSummary.summary && !!isSettled?.(cacheSummary.summary);
  // Not in the background: coming back to the foreground re-runs the watch,
  // which reads at once and restarts the interval (`inactive` — the app
  // switcher, a system sheet — still counts as shown).
  const [foreground, setForeground] = useState(inForeground);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => setForeground(inForeground()));
    return () => subscription.remove();
  }, []);
  const watching = enabled && foreground && !settled;

  useEffect(() => {
    if (!normalizedAddress || !watching) {
      log.debug('mempool.address.summary.idle', {
        reason: normalizedAddress ? 'not_watching' : 'missing_address',
      });
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

    // Every read asks mempool.space afresh, cache freshness aside: a deposit
    // that arrived while the address was hidden or the app was in the
    // background must show the moment it is shown again, since the standing
    // address only rotates once it sees one. The cache only keeps the last
    // summary on screen meanwhile.
    const refresh = (reason: 'shown' | 'poll') => {
      const controller = new AbortController();
      controllers.add(controller);
      setIsRefreshing(true);
      setError(null);
      const startedAt = Date.now();
      log.info('mempool.address.summary.refresh.start', {
        ...summarizeAddress(normalizedAddress),
        reason,
        activeRequests: controllers.size,
      });

      fetchMempoolAddressStats(normalizedAddress, { signal: controller.signal })
        .then((stats) => {
          useMempoolAddressCache.getState().setAddressStats(normalizedAddress, stats);
          log.info('mempool.address.summary.refresh.done', {
            ...summarizeAddress(normalizedAddress),
            reason,
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
              reason,
              durationMs: Date.now() - startedAt,
              error: err instanceof Error ? err : new Error(String(err)),
            });
            return;
          }
          log.debug('mempool.address.summary.refresh.ignored', {
            ...summarizeAddress(normalizedAddress),
            reason,
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

    refresh('shown');
    const interval = setInterval(() => refresh('poll'), MEMPOOL_ADDRESS_POLL_MS);

    return () => {
      mounted = false;
      clearInterval(interval);
      controllers.forEach((controller) => controller.abort());
      log.info('mempool.address.summary.unsubscribe', {
        ...summarizeAddress(normalizedAddress),
        activeRequests: controllers.size,
      });
    };
  }, [normalizedAddress, watching]);

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
