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
import { MempoolAddressStatsSchema, type MempoolAddressStats } from 'colada';

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
        if (!key) return;
        set((state) => {
          const next = {
            ...state.byAddress,
            [key]: { stats, fetchedAt: Date.now() },
          };
          evictIfOverCap(next);
          return { byAddress: next };
        });
      },

      clear: () => set({ byAddress: {} }),
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
  const entry = getValidatedCacheEntry(key);
  const now = Date.now();

  if (entry && now - entry.fetchedAt <= STALE_TTL_MS) {
    return entry.stats;
  }

  if (entry) {
    refreshInBackground(fetcher, address);
    return entry.stats;
  }

  return fetchAndCache(fetcher, address);
}

function getValidatedCacheEntry(key: string): MempoolAddressCacheEntry | undefined {
  const entry = useMempoolAddressCache.getState().byAddress[key];
  if (!entry) return undefined;
  const parsed = MempoolAddressStatsSchema.safeParse(entry.stats);
  if (!parsed.success) return undefined;
  return { ...entry, stats: parsed.data };
}

function fetchAndCache(
  fetcher: (address: string) => Promise<MempoolAddressStats>,
  address: string
): Promise<MempoolAddressStats> {
  const key = normalizeAddressKey(address);
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const stats = await fetcher(address);
      useMempoolAddressCache.getState().setAddressStats(address, stats);
      return stats;
    } finally {
      inflight.delete(key);
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
  if (inflight.has(key)) return;
  fetchAndCache(fetcher, address).catch((error) => {
    log.warn('mempool.address.cache.swr_refresh_failed', {
      addressPreview: `${address.slice(0, 8)}…${address.slice(-6)}`,
      error: error instanceof Error ? error : new Error(String(error)),
    });
  });
}
