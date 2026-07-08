/**
 * Short-lived SWR cache for mempool.space address stats.
 *
 * Address stats are public chain data, not profile-scoped wallet state. Keep
 * this global and aggressively stale so receive/history screens can show the
 * latest seen funding status without re-fetching on every render.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { log, storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { MempoolAddressStatsSchema, type MempoolAddressStats } from 'wallet';

const STALE_TTL_MS = 60_000;
const MAX_ENTRIES = 100;

interface MempoolAddressCacheEntry {
  stats: MempoolAddressStats;
  fetchedAt: number;
}

interface MempoolAddressCacheState {
  byAddress: Record<string, MempoolAddressCacheEntry>;
  setAddressStats: (address: string, stats: MempoolAddressStats) => void;
  clear: () => void;
}

const PersistedMempoolAddressCache = z.object({
  byAddress: z
    .record(
      z.string().max(256),
      z.looseObject({
        stats: z.unknown(),
        fetchedAt: z.number().int().nonnegative(),
      })
    )
    .default({}),
});

function normalizeAddressKey(address: string): string {
  return address.trim();
}

function summarizeAddress(address: string): Record<string, unknown> {
  return { addressLength: address.trim().length };
}

function evictIfOverCap(byAddress: Record<string, MempoolAddressCacheEntry>): void {
  if (Object.keys(byAddress).length <= MAX_ENTRIES) return;
  const evictCount = Math.max(1, Math.floor(MAX_ENTRIES * 0.1));
  const sorted = Object.entries(byAddress).sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  for (let i = 0; i < evictCount; i++) delete byAddress[sorted[i][0]];
  storeLog.debug('store.mempool_address.evicted', {
    evicted: evictCount,
    remaining: Object.keys(byAddress).length,
  });
}

export const useMempoolAddressCache = create<MempoolAddressCacheState>()(
  persist(
    (set) => ({
      byAddress: {},

      setAddressStats: (address, stats) => {
        const key = normalizeAddressKey(address);
        if (!key) {
          storeLog.debug('store.mempool_address.set.skipped', { reason: 'empty_address' });
          return;
        }
        set((state) => {
          // Confirmation depth (`fundingTxs`) comes only from the enriched
          // `/txs` + tip-height calls. A periodic poll whose enrichment failed
          // returns base stats with NO `fundingTxs`, which would otherwise
          // overwrite a known count and collapse the onchain timeline from
          // "2/2 confirmations" back to a pulsing "confirming" segment. Carry
          // the last-known funding txs forward so the count never regresses to
          // "unknown" on a transient failure — a later successful poll (or a
          // genuinely unfunded address, tx_count 0) supersedes them.
          const prior = state.byAddress[key]?.stats;
          const priorFunding = prior?.fundingTxs;
          const carryForwardFunding =
            (!stats.fundingTxs || stats.fundingTxs.length === 0) &&
            !!priorFunding &&
            priorFunding.length > 0 &&
            stats.chain_stats.tx_count > 0;
          const mergedStats = carryForwardFunding ? { ...stats, fundingTxs: priorFunding } : stats;
          const next = {
            ...state.byAddress,
            [key]: { stats: mergedStats, fetchedAt: Date.now() },
          };
          evictIfOverCap(next);
          storeLog.debug('store.mempool_address.set', {
            ...summarizeAddress(address),
            confirmedTxCount: mergedStats.chain_stats.tx_count,
            mempoolTxCount: mergedStats.mempool_stats.tx_count,
            carriedForwardFundingTxs: carryForwardFunding,
            totalCached: Object.keys(next).length,
          });
          return { byAddress: next };
        });
      },

      clear: () => {
        storeLog.info('store.mempool_address.clear', {
          totalCached: Object.keys(useMempoolAddressCache.getState().byAddress).length,
        });
        set({ byAddress: {} });
      },
    }),
    persistConfig({
      name: 'mempool-address-cache',
      storage: AsyncStorage,
      schema: PersistedMempoolAddressCache,
      logKey: 'mempool_address',
      partialize: (state) => ({ byAddress: state.byAddress }),
    })
  )
);

const inflight = new Map<string, Promise<MempoolAddressStats>>();

export async function getCachedMempoolAddressStats(
  fetcher: (address: string) => Promise<MempoolAddressStats>,
  address: string
): Promise<MempoolAddressStats> {
  const key = normalizeAddressKey(address);
  if (!key) {
    storeLog.warn('store.mempool_address.cache.invalid_request', { reason: 'empty_address' });
  }
  const entry = getValidatedCacheEntry(key);
  const now = Date.now();

  if (entry && now - entry.fetchedAt <= STALE_TTL_MS) {
    storeLog.debug('store.mempool_address.cache.hit', {
      ...summarizeAddress(address),
      ageMs: now - entry.fetchedAt,
    });
    return entry.stats;
  }

  if (entry) {
    storeLog.info('store.mempool_address.cache.stale', {
      ...summarizeAddress(address),
      ageMs: now - entry.fetchedAt,
    });
    refreshInBackground(fetcher, address);
    return entry.stats;
  }

  storeLog.info('store.mempool_address.cache.miss', summarizeAddress(address));
  return fetchAndCache(fetcher, address);
}

function getValidatedCacheEntry(key: string): MempoolAddressCacheEntry | undefined {
  const entry = useMempoolAddressCache.getState().byAddress[key];
  if (!entry) {
    storeLog.debug('store.mempool_address.cache.lookup_miss', {
      addressLength: key.length,
    });
    return undefined;
  }
  const parsed = MempoolAddressStatsSchema.safeParse(entry.stats);
  if (!parsed.success) {
    storeLog.warn('store.mempool_address.cache.invalid_shape', {
      addressLength: key.length,
      issueCount: parsed.error.issues.length,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
      })),
    });
    return undefined;
  }
  return { ...entry, stats: parsed.data };
}

function fetchAndCache(
  fetcher: (address: string) => Promise<MempoolAddressStats>,
  address: string
): Promise<MempoolAddressStats> {
  const key = normalizeAddressKey(address);
  const existing = inflight.get(key);
  if (existing) {
    storeLog.debug('store.mempool_address.fetch.join_inflight', {
      ...summarizeAddress(address),
    });
    return existing;
  }

  const p = (async () => {
    try {
      storeLog.info('store.mempool_address.fetch.start', summarizeAddress(address));
      const stats = await fetcher(address);
      useMempoolAddressCache.getState().setAddressStats(address, stats);
      storeLog.info('store.mempool_address.fetch.done', {
        ...summarizeAddress(address),
        confirmedTxCount: stats.chain_stats.tx_count,
        mempoolTxCount: stats.mempool_stats.tx_count,
      });
      return stats;
    } catch (error) {
      storeLog.warn('store.mempool_address.fetch.failed', {
        ...summarizeAddress(address),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    } finally {
      inflight.delete(key);
      storeLog.debug('store.mempool_address.fetch.inflight_cleared', {
        ...summarizeAddress(address),
      });
    }
  })();
  inflight.set(key, p);
  return p;
}

function refreshInBackground(
  fetcher: (address: string) => Promise<MempoolAddressStats>,
  address: string
): void {
  const key = normalizeAddressKey(address);
  if (inflight.has(key)) {
    storeLog.debug('store.mempool_address.swr.skip_inflight', {
      ...summarizeAddress(address),
    });
    return;
  }
  fetchAndCache(fetcher, address).catch((error) => {
    log.warn('mempool.address.cache.swr_refresh_failed', {
      ...summarizeAddress(address),
      error: error instanceof Error ? error : new Error(String(error)),
    });
  });
}
