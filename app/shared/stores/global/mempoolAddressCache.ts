/**
 * Last-seen mempool.space address stats.
 *
 * Address stats are public chain data, not profile-scoped wallet state. Kept
 * global so receive/history screens show the latest seen funding status at
 * once; `useMempoolAddressSummary` still asks afresh whenever an address is
 * shown.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { persist } from 'zustand/middleware';

import { evictLruOverCap } from '@/shared/lib/cache/evictLruOverCap';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import type { MempoolAddressStats } from 'wallet';

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

export const useMempoolAddressCache = create<MempoolAddressCacheState>({
  name: 'mempool-address-cache',
  scope: 'global',
})(
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
          const trimmed = evictLruOverCap(next, MAX_ENTRIES, (entry) => entry.fetchedAt);
          if (trimmed) storeLog.debug('store.mempool_address.evicted', trimmed);
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
