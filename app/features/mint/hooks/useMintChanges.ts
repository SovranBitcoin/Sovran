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
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
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
import { fetchMintChanges } from '@/shared/lib/apiClient';
import { cashuLog } from '@/shared/lib/logger';
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

/** Reactive read of the cached changelog response. */
function useCachedMintChanges() {
  return mintChangesCache.use((state) => state.byKey[MINT_CHANGES_CACHE_KEY]?.data);
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

export function useMintChanges(): UseMintChangesResult {
  const { trustedMints } = useMints();
  const response = useCachedMintChanges();
  const nutsFor = useNutsResolver();

  const [isLoading, setIsLoading] = useState(
    () => !mintChangesCache.getEntry(MINT_CHANGES_CACHE_KEY)
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback((mode: 'initial' | 'refresh', signal: AbortSignal) => {
    const cached = mintChangesCache.getEntry(MINT_CHANGES_CACHE_KEY);
    // Persisted data paints immediately; a fresh entry needs no round-trip.
    if (mode === 'initial' && mintChangesCache.isFresh(cached)) {
      setIsLoading(false);
      return;
    }
    if (mode === 'refresh') setIsRefreshing(true);
    else setIsLoading(!cached);

    void mintChangesCache
      .run(
        MINT_CHANGES_CACHE_KEY,
        async () => {
          const result = await fetchMintChanges({ signal });
          if (result.isErr()) throw result.error;
          return { data: result.value };
        },
        '',
        mode === 'refresh'
      )
      .then((data) => {
        if (signal.aborted) return;
        setErrorMessage(null);
        cashuLog.info('mint.changes.loaded', {
          mode,
          changes: data.changes.length,
          trackedMints: data.trackedMints,
        });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        cashuLog.warn('mint.changes.load_failed', { mode, message });
        setErrorMessage(describeError(error, 'nagg').text);
      })
      .finally(() => {
        if (signal.aborted) return;
        setIsLoading(false);
        setIsRefreshing(false);
      });
  }, []);

  // A pull-to-refresh outlives its own effect, so its controller is held here
  // and aborted when the screen loses focus — otherwise a slow refresh lands on
  // an unmounted list.
  const refreshControllerRef = useRef<AbortController | null>(null);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      load('initial', controller.signal);
      return () => {
        controller.abort();
        refreshControllerRef.current?.abort();
        refreshControllerRef.current = null;
      };
    }, [load])
  );

  const refresh = useCallback(() => {
    if (isRefreshing) return;
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    load('refresh', controller.signal);
  }, [isRefreshing, load]);

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
 * detail screen's data. Reads the same cached response as the list, so opening
 * a row costs no fetch.
 */
export function useMintChangeRevisions(mintUrl: string | undefined): MintChangeRevision[] {
  const response = useCachedMintChanges();
  const nutsFor = useNutsResolver();
  return useMemo(() => {
    if (!response || !mintUrl) return [];
    const key = normalizeMintUrlKey(mintUrl);
    const entries = decodeFeed(response).entries.filter(
      (entry) => normalizeMintUrlKey(entry.mintUrl) === key
    );
    return buildMintChangeListItems(entries, nutsFor)[0]?.revisions ?? [];
  }, [response, mintUrl, nutsFor]);
}
