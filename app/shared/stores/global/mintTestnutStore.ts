/**
 * Testnut verdicts for the wallet's mints — which mints have a fake payment
 * backend (nagg's unpaid-quote probe saw them mark a never-paid quote paid).
 *
 * The verdict decides which ACCOUNT a mint's units belong to (`usd` vs `tusd`,
 * see wallet `account-units`), so test funds never share a balance, a mint
 * picker tab, a receive rail or a Balance split with real ones. That makes it
 * money-routing state, not presentation: it lives here rather than as a group
 * on `mintMetadataStore`, whose LRU a single 200-row discover seed can turn
 * over — evicting a verdict would silently merge a testnut back into the real
 * accounts.
 *
 * Reads are always local and synchronous. The network only ever runs in the
 * background (`shared/lib/mintTestnutRefresh`): on wallet start, on foreground,
 * and when a mint is added or trusted, one bulk `/nostr/mint/info` call covers
 * every trusted mint once a verdict is missing or a day old. A failed or
 * unanswered check keeps the previous verdict; only a probed row
 * (`probedAt` present) can set or clear the flag.
 *
 * Host-scoped (a mint is a testnut for everyone) → bare `AsyncStorage`,
 * matching `mintMetadataStore`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { DiscoverMint, MintInfoRow } from '@/shared/lib/apiClient';
import { evictLruOverCap } from '@/shared/lib/cache/evictLruOverCap';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { normalizeMintUrlKey } from '@/shared/lib/url';

const MAX_ENTRIES = 500;

interface MintTestnutEntry {
  testnut: boolean;
  /** nagg's verdict time (Unix seconds). Absent = nagg has not probed the mint. */
  probedAt?: number;
  /** Last time nagg answered for this mint — the re-check clock. */
  checkedAt: number;
}

const PersistedMintTestnutEntry = z.looseObject({
  testnut: z.boolean().default(false).catch(false),
  probedAt: z.number().int().nonnegative().optional().catch(undefined),
  checkedAt: z.number().int().nonnegative().default(0).catch(0),
});

const PersistedMintTestnutStore = z.object({
  byMintUrl: z.record(z.string().max(2048), PersistedMintTestnutEntry).default({}),
});

interface MintTestnutState {
  byMintUrl: Record<string, MintTestnutEntry>;
  /** Apply a `/nostr/mint/info` answer. Unprobed rows only move the clock. */
  applyMintInfos: (rows: readonly MintInfoRow[]) => void;
  /** Learn testnuts from a discover response (its `false` is not a verdict). */
  applyDiscover: (mints: readonly DiscoverMint[]) => void;
  clear: () => void;
}

function evictIfOverCap(byMintUrl: Record<string, MintTestnutEntry>): void {
  const trimmed = evictLruOverCap(byMintUrl, MAX_ENTRIES, (entry) => entry.checkedAt);
  if (trimmed) storeLog.debug('store.mint_testnut.evicted', trimmed);
}

export const useMintTestnutStore = create<MintTestnutState>()(
  persist(
    (set) => ({
      byMintUrl: {},

      applyMintInfos: (rows) => {
        if (rows.length === 0) return;
        const now = Date.now();
        set((state) => {
          const next = { ...state.byMintUrl };
          for (const row of rows) {
            const key = normalizeMintUrlKey(row.mintUrl);
            next[key] =
              row.probedAt == null
                ? { ...(next[key] ?? { testnut: false }), checkedAt: now }
                : { testnut: row.testnut, probedAt: row.probedAt, checkedAt: now };
          }
          evictIfOverCap(next);
          return { byMintUrl: next };
        });
      },

      applyDiscover: (mints) => {
        const testnuts = mints.filter((mint) => mint.testnut === true);
        if (testnuts.length === 0) return;
        set((state) => {
          const next = { ...state.byMintUrl };
          for (const mint of testnuts) {
            const key = normalizeMintUrlKey(mint.mintUrl);
            // checkedAt 0: the next background pass still asks nagg for the
            // probe time, and an LRU trim drops these seeds first.
            next[key] = { ...next[key], checkedAt: next[key]?.checkedAt ?? 0, testnut: true };
          }
          evictIfOverCap(next);
          return { byMintUrl: next };
        });
      },

      clear: () => {
        storeLog.info('store.mint_testnut.clear');
        set({ byMintUrl: {} });
      },
    }),
    persistConfig({
      name: 'mint-testnut-store',
      storage: AsyncStorage,
      schema: PersistedMintTestnutStore,
      logKey: 'mint_testnut',
      partialize: (state) => ({ byMintUrl: state.byMintUrl }),
    })
  )
);

/** Synchronous, local-only verdict read for non-React callers. */
export function isTestnutMint(mintUrl: string): boolean {
  return useMintTestnutStore.getState().byMintUrl[normalizeMintUrlKey(mintUrl)]?.testnut === true;
}

/**
 * Reactive verdict predicate. Its identity changes only when the SET of
 * testnut mints changes, so it is safe as a memo / effect dependency.
 */
export function useIsTestnutMint(): (mintUrl: string) => boolean {
  const signature = useMintTestnutStore((state) =>
    Object.keys(state.byMintUrl)
      .filter((key) => state.byMintUrl[key].testnut)
      .sort()
      .join('\n')
  );
  const testnutKeys = useMemo(() => new Set(signature ? signature.split('\n') : []), [signature]);
  return useCallback(
    (mintUrl: string) => testnutKeys.has(normalizeMintUrlKey(mintUrl)),
    [testnutKeys]
  );
}
