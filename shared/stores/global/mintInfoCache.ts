/**
 * SWR cache for Cashu mint NUT-06 info, sitting *above* coco's per-mint
 * refresh logic.
 *
 * Coco's `Manager.mint.getMintInfo()` blocks for an HTTP round-trip whenever
 * its 5-minute internal TTL expires (`MINT_REFRESH_TTL_S = 300`). On cold
 * open of any screen that reads mint info for >1 trusted mint — Contacts/All,
 * mint-pick, distribution, rebalance — that translates to several seconds of
 * waiting on every session because each mint is fetched in parallel against
 * its own host.
 *
 * This cache returns the last-known NUT-06 blob immediately and triggers a
 * background revalidate when older than `STALE_TTL_MS`. Coco's own 5-minute
 * window then absorbs the underlying HTTP cost when revalidate runs.
 *
 * Mint info is host-scoped, not user-scoped — same mint serves the same
 * NUT-06 to everyone — so this uses bare `AsyncStorage`, matching
 * `auditMintStore` / `kymMintStore`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Manager } from '@cashu/coco-core';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { z } from 'zod';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { log, storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { normalizeMintUrlKey } from '@/shared/lib/url';

const STALE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

interface MintInfoCacheEntry {
  info: GetInfoResponse;
  fetchedAt: number;
}

interface MintInfoCacheState {
  byMintUrl: Record<string, MintInfoCacheEntry>;
  setMintInfo: (mintUrl: string, info: GetInfoResponse) => void;
  removeMintInfo: (mintUrl: string) => void;
  clear: () => void;
}

// `info` is the NUT-06 wire shape — the strict definition lives in
// cashu-ts and varies across mint versions. Treat it as `unknown` on
// rehydrate; consumers re-fetch on miss anyway.
const PersistedMintInfoCache = z.object({
  byMintUrl: z
    .record(
      z.string().max(2048),
      z.looseObject({
        info: z.unknown(),
        fetchedAt: z.number().int().nonnegative(),
      })
    )
    .default({}),
});

function evictIfOverCap(byMintUrl: Record<string, MintInfoCacheEntry>): void {
  if (Object.keys(byMintUrl).length <= MAX_ENTRIES) return;
  const evictCount = Math.floor(MAX_ENTRIES * 0.1);
  const sorted = Object.entries(byMintUrl).sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  for (let i = 0; i < evictCount; i++) delete byMintUrl[sorted[i][0]];
  storeLog.debug('store.mint_info.evicted', {
    evicted: evictCount,
    remaining: Object.keys(byMintUrl).length,
  });
}

export const useMintInfoCache = create<MintInfoCacheState>()(
  persist(
    (set) => ({
      byMintUrl: {},

      setMintInfo: (mintUrl, info) => {
        const key = normalizeMintUrlKey(mintUrl);
        set((state) => {
          const next = {
            ...state.byMintUrl,
            [key]: { info, fetchedAt: Date.now() },
          };
          evictIfOverCap(next);
          return { byMintUrl: next };
        });
      },

      removeMintInfo: (mintUrl) => {
        const key = normalizeMintUrlKey(mintUrl);
        set((state) => {
          if (!state.byMintUrl[key]) return state;
          const next = { ...state.byMintUrl };
          delete next[key];
          return { byMintUrl: next };
        });
      },

      clear: () => set({ byMintUrl: {} }),
    }),
    persistConfig({
      name: 'mint-info-cache',
      storage: AsyncStorage,
      schema: PersistedMintInfoCache,
      logKey: 'mint_info',
      partialize: (state) => ({ byMintUrl: state.byMintUrl }),
    })
  )
);

/** Module-level promise dedupe so concurrent miss/refresh fetches collapse to one HTTP. */
const inflight = new Map<string, Promise<GetInfoResponse>>();

/** Sync read for non-React contexts (operations bridges, machine handlers). */
export function getCachedMintInfoSync(mintUrl: string): GetInfoResponse | undefined {
  return useMintInfoCache.getState().byMintUrl[normalizeMintUrlKey(mintUrl)]?.info;
}

/**
 * SWR fetch:
 *   - cached + fresh → resolve synchronously with the cached value
 *   - cached + stale → resolve with the cached value, kick off background refresh
 *   - miss          → await the fetcher, write through, resolve with the result
 *
 * `fetcher` receives the original `mintUrl` (not the normalized key) so coco's
 * own `normalizeMintUrl` can run unchanged inside `Manager.mint.getMintInfo`.
 */
export async function getCachedMintInfo(
  fetcher: (mintUrl: string) => Promise<GetInfoResponse>,
  mintUrl: string
): Promise<GetInfoResponse> {
  const key = normalizeMintUrlKey(mintUrl);
  const entry = useMintInfoCache.getState().byMintUrl[key];
  const now = Date.now();
  const isFresh = !!entry && now - entry.fetchedAt <= STALE_TTL_MS;

  if (isFresh) return entry.info;

  if (entry) {
    // SWR: return stale immediately, refresh in the background.
    refreshInBackground(fetcher, mintUrl);
    return entry.info;
  }

  // True miss: must await.
  return fetchAndCache(fetcher, mintUrl);
}

function fetchAndCache(
  fetcher: (mintUrl: string) => Promise<GetInfoResponse>,
  mintUrl: string
): Promise<GetInfoResponse> {
  const key = normalizeMintUrlKey(mintUrl);
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const info = await fetcher(mintUrl);
      useMintInfoCache.getState().setMintInfo(mintUrl, info);
      return info;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

function refreshInBackground(
  fetcher: (mintUrl: string) => Promise<GetInfoResponse>,
  mintUrl: string
): void {
  const key = normalizeMintUrlKey(mintUrl);
  if (inflight.has(key)) return;
  fetchAndCache(fetcher, mintUrl).catch((err) => {
    log.warn('mint.info.cache.swr_refresh_failed', {
      mintUrl,
      error: err instanceof Error ? err : new Error(String(err)),
    });
  });
}

/**
 * Subscribe a coco `Manager` so its `mint:added` / `mint:updated` events
 * write back into the cache. Without this, coco-DB refreshes that bypass
 * `getCachedMintInfo` (e.g. recovery flows, `addMintByUrl`) leave the
 * cache stale until its 24h SWR window expires.
 *
 * Wire once per manager lifetime in `CocoProvider`.
 */
export function attachMintInfoCacheToManager(manager: Manager): () => void {
  const handler = ({ mint }: { mint: { mintUrl: string; mintInfo?: GetInfoResponse } }) => {
    if (mint?.mintInfo && mint.mintUrl) {
      useMintInfoCache.getState().setMintInfo(mint.mintUrl, mint.mintInfo);
    }
  };
  manager.on('mint:added', handler);
  manager.on('mint:updated', handler);
  return () => {
    manager.off('mint:added', handler);
    manager.off('mint:updated', handler);
  };
}
