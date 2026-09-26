import { useEffect, useMemo, useRef } from 'react';
import { ACCOUNT_UNITS } from 'wallet';

import { discoverMints, DiscoverMintsResponse } from '@/shared/lib/apiClient';
import { cacheOperatorStats } from '@/shared/lib/nostr/fetchProfiles';
import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';
import { useCachedRead, type ReadStatus } from '@/shared/lib/read/useCachedRead';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { useMintTestnutStore } from '@/shared/stores/global/mintTestnutStore';
import { extractAvailableCurrencies } from '@/features/mint/lib/availableCurrencies';
import { MINT_DISCOVER_CACHE_KEY, mintDiscoverCache } from '@/features/mint/data/mintDiscoverCache';
import {
  discoverMintToSearchResult,
  discoveryMethodMatches,
  matchesMintCurrency,
  matchesMintQuery,
  type MintSearchRow,
} from '@/features/mint/lib/mintDiscoveryRows';

const DISCOVERY_UNITS = ACCOUNT_UNITS.map((unit) => unit.toUpperCase());

interface UseMintSearchReturn {
  results: MintSearchRow[];
  /** First paint with nothing cached; a refetch over cached rows is not loading. */
  loading: boolean;
  status: ReadStatus;
  error: string | null;
  /** Re-run discovery (retry after a failure / pull-to-refresh). */
  refresh: () => void;
  availableUnits: string[];
  matchCountByUnit: Record<string, number>;
}

/**
 * Mint discovery hook, backed by nagg's single `/nostr/mint/discover` app-view.
 *
 * One network call returns every mint with audit state, units, review/favourite
 * aggregates and the operator's Vertex reputation — so query + currency
 * filtering happen client-side (instant, no per-keystroke request) and the old
 * separate search + per-mint review N+1 fan-out are gone. The response lives in
 * the persisted `mintDiscoverCache`: re-entry and currency-tab changes paint
 * the cached rows at 0ms and a stale cache revalidates in the background.
 * Inline operator follower/score is seeded into the mint metadata cache so the
 * operator-profile lookup is a cache hit, not another round-trip.
 */
export function useMintSearch(
  query: string,
  currency: string,
  options?: { enabled?: boolean; method?: string }
): UseMintSearchReturn {
  const enabled = options?.enabled ?? true;
  const method = options?.method;

  const read = useCachedRead<DiscoverMintsResponse>({
    store: mintDiscoverCache,
    surface: 'discoverMints',
    key: enabled ? MINT_DISCOVER_CACHE_KEY : null,
    viewerKey: '',
    fetcher: async ({ signal }) => {
      const res = await discoverMints({ signal });
      if (res.isErr()) throw res.error;
      // Dev tier badges: discovery is served by nagg's app-view only (no
      // cache/relay fallback exists for this surface), so every row that
      // arrives is honestly 'n'. Keyed by mint URL — the badge store keys
      // by string, not strictly event ids.
      recordDebugTiers(
        res.value.mints.map((m) => m.mintUrl),
        'nagg'
      );
      // Seed the unified cache from the discovery rows so the selector, audit
      // and operator-profile lookups all become cache hits (not round-trips).
      useMintMetadataStore.getState().upsertFromDiscover(res.value.mints);
      // The operator's reach and reputation go to the single owner as well, so
      // the profile page and any other row for the same person agree with this
      // list — and the person is linked to the mint they run.
      cacheOperatorStats(
        res.value.mints.map((m) => ({
          pubkey: m.operatorPubkey,
          followers: m.followers,
          follows: m.follows,
          score: m.vertexScore,
          rank: m.vertexRank,
          operatesMint: m.mintUrl,
        }))
      );
      // Testnut rows classify a mint the moment it is added, ahead of the
      // background verdict refresh.
      useMintTestnutStore.getState().applyDiscover(res.value.mints);
      return { data: res.value };
    },
  });

  // The persisted payload is validated on read: a shape mismatch (schema
  // drift across app versions) evicts the entry and refetches once.
  const parsed = useMemo(() => {
    if (!read.data) return undefined;
    const result = DiscoverMintsResponse.safeParse(read.data);
    return result.success ? result.data : null;
  }, [read.data]);
  const evictedRef = useRef(false);
  const refresh = read.refresh;
  useEffect(() => {
    if (parsed !== null || evictedRef.current) return;
    evictedRef.current = true;
    mintDiscoverCache.removeEntry(MINT_DISCOVER_CACHE_KEY);
    refresh();
  }, [parsed, refresh]);

  const allMints = useMemo<MintSearchRow[]>(
    () => (parsed ? parsed.mints.map(discoverMintToSearchResult) : []),
    [parsed]
  );

  const results = useMemo(() => {
    const q = query.trim();
    return allMints.filter(
      (m) =>
        matchesMintQuery(m, q) &&
        matchesMintCurrency(m, currency) &&
        discoveryMethodMatches(m, method, currency)
    );
  }, [allMints, query, currency, method]);

  // Keep the selected rail unit visible even when discovery has no rows for it.
  const availableUnits = extractAvailableCurrencies([
    ['SAT', currency],
    ...allMints.map((mint) => mint.supported_units),
  ]).filter((unit) => DISCOVERY_UNITS.includes(unit));
  const matchCountByUnit: Record<string, number> = Object.fromEntries(
    DISCOVERY_UNITS.map((unit) => [unit, 0])
  );
  for (const mint of allMints) {
    if (!matchesMintQuery(mint, query.trim())) continue;
    for (const unit of DISCOVERY_UNITS) {
      if (matchesMintCurrency(mint, unit) && discoveryMethodMatches(mint, method, unit)) {
        matchCountByUnit[unit] += 1;
      }
    }
  }

  return {
    results,
    loading: read.status === 'loading',
    status: read.status,
    error: read.error ? 'Failed to load mints' : null,
    refresh: read.refresh,
    availableUnits,
    matchCountByUnit,
  };
}
