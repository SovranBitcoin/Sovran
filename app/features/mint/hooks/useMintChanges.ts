import { describeError } from '@/shared/lib/errors';
/**
 * The Notifications → Mints data source: what the mints in THIS wallet changed
 * about their own NUT-06 info, newest first.
 *
 * nagg serves one ecosystem-wide changelog (there is no per-mint filter on the
 * endpoint and the whole recorded history fits in a single response), so the
 * fetch is cached once (`mintChangesCache`) and every consumer filters it down
 * locally. Decoding stays a pure `useMemo` over the cached wire response —
 * cache the fetch, not the derived rows.
 *
 * The read itself is `useCachedRead` (the reference consumer): a fresh
 * persisted entry paints with zero round-trips, a stale one paints and
 * revalidates, and every arrival is logged under `read.mintChanges.*`.
 */
import { useCallback, useMemo } from 'react';
import { useMints } from '@cashu/coco-react';

import { MINT_CHANGES_CACHE_KEY, mintChangesCache } from '@/features/mint/data/mintChangesCache';
import { decodeFeed } from '@/features/mint/lib/mintChanges/decode';
import {
  buildMintChangeListItems,
  flattenMintChangeUpdates,
  type MintChangeRevision,
  type MintChangeUpdate,
} from '@/features/mint/lib/mintChanges/groupEntries';
import type { NutsMap } from '@/features/mint/lib/mintChanges/interpret';
import { fetchMintChanges, type MintChangesResponse } from '@/shared/lib/apiClient';
import { useCachedRead } from '@/shared/lib/read/useCachedRead';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { normalizeMintUrlKey } from '@/shared/lib/url';

interface UseMintChangesResult {
  /** One row per update across the mints this wallet trusts, newest first. */
  updates: MintChangeUpdate[];
  /** How many mints the wallet trusts — what the empty state is speaking for. */
  trustedMintCount: number;
  isLoading: boolean;
  isRefreshing: boolean;
  errorMessage: string | null;
  refresh: () => void;
}

/**
 * Resolves a mint's CURRENT capability map so a limit change can name its unit
 * — the patch says `max_amount: 25000 → 100000` and nothing about sats. Reads
 * the same per-mint metadata the rows already use for icons.
 */
function useNutsResolver(): (mintUrl: string) => NutsMap {
  const byMintUrl = useMintMetadataStore((state) => state.byMintUrl);
  return useCallback(
    (mintUrl: string) => {
      const entry = byMintUrl[normalizeMintUrlKey(mintUrl)];
      if (entry?.nuts) return entry.nuts;
      const info = entry?.info;
      return info && typeof info === 'object'
        ? (info as { nuts?: Record<string, unknown> }).nuts
        : undefined;
    },
    [byMintUrl]
  );
}

function useMintChangesSource() {
  const read = useCachedRead<MintChangesResponse>({
    store: mintChangesCache,
    surface: 'mintChanges',
    key: MINT_CHANGES_CACHE_KEY,
    viewerKey: '',
    fetcher: async ({ signal }) => {
      const result = await fetchMintChanges({ signal });
      if (result.isErr()) throw result.error;
      return { data: result.value };
    },
  });
  const errorMessage = read.error ? describeError(read.error, 'nagg').text : null;
  return {
    response: read.data,
    isLoading: read.status === 'loading',
    isRefreshing: read.isFetching && read.mode === 'refresh',
    errorMessage,
    refresh: read.refresh,
  };
}

export function useMintChanges(): UseMintChangesResult {
  const { trustedMints } = useMints();
  const { response, isLoading, isRefreshing, errorMessage, refresh } = useMintChangesSource();
  const nutsFor = useNutsResolver();

  // `trustedMints` is a fresh array on every coco emit; key the memo on the URLs
  // themselves so the decode/group pass doesn't re-run for an identical wallet.
  const trustedMintsKey = trustedMints
    .map((mint) => mint.mintUrl)
    .sort()
    .join('|');

  const entries = useMemo(() => {
    if (!response) return [];
    const trusted = new Set(
      trustedMintsKey ? trustedMintsKey.split('|').map(normalizeMintUrlKey) : []
    );
    if (trusted.size === 0) return [];
    return decodeFeed(response).entries.filter((entry) =>
      trusted.has(normalizeMintUrlKey(entry.mintUrl))
    );
  }, [response, trustedMintsKey]);

  const updates = useMemo(
    () => flattenMintChangeUpdates(buildMintChangeListItems(entries, nutsFor)),
    [entries, nutsFor]
  );

  return {
    updates,
    trustedMintCount: trustedMints.length,
    isLoading,
    isRefreshing,
    errorMessage,
    refresh,
  };
}

/**
 * Every recorded revision of ONE mint, newest first, already phrased — the
 * detail screen's data. Reuses the list cache when fresh and fetches on cold
 * direct navigation, so a deep link does not falsely show empty history.
 */
export function useMintChangeRevisions(mintUrl: string | undefined) {
  const { response, ...status } = useMintChangesSource();
  const nutsFor = useNutsResolver();
  const revisions = useMemo<MintChangeRevision[]>(() => {
    if (!response || !mintUrl) return [];
    const key = normalizeMintUrlKey(mintUrl);
    const entries = decodeFeed(response).entries.filter(
      (entry) => normalizeMintUrlKey(entry.mintUrl) === key
    );
    return buildMintChangeListItems(entries, nutsFor)[0]?.revisions ?? [];
  }, [response, mintUrl, nutsFor]);
  return { revisions, ...status };
}
