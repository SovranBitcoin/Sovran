import { useEffect, useMemo, useRef } from 'react';

import {
  discoverMints,
  DiscoverMintsResponse,
  type DiscoverMint,
  type MintSearchResult,
} from '@/shared/lib/apiClient';
import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';
import { mintMethodsFromNuts, mintMethodUnitPairsFromNuts } from '@/shared/lib/cashu/mintNuts';
import { useCachedRead, type ReadStatus } from '@/shared/lib/read/useCachedRead';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { extractAvailableCurrencies } from '@/features/mint/lib/availableCurrencies';
import { MINT_DISCOVER_CACHE_KEY, mintDiscoverCache } from '@/features/mint/data/mintDiscoverCache';

const DISCOVERY_UNITS = ['SAT', 'USD', 'EUR', 'GBP'];

/** Discovery row + the app-local method field (the shared MintSearchResult
 *  schema predates the capability data; extend locally rather than changing
 *  the cross-repo contract). */
type MintSearchRow = MintSearchResult & {
  supported_methods: string[];
  /** NUT-04 (method, unit) pairs (lowercased) — the discovery filter matches the
   *  rail's exact pair, e.g. (bolt12, sat), not the method alone. */
  supported_method_units: { method: string; unit: string }[];
};

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
 * Map a nagg discovery row to the screen's MintSearchResult shape. Review score
 * + count come inline (no per-mint fan-out); the operator's Nostr pubkey is
 * surfaced as a NUT-06 `contact` entry so the existing operator-profile path
 * still resolves. Exported for testing.
 */
export function discoverMintToSearchResult(m: DiscoverMint): MintSearchRow {
  const contact = m.operatorPubkey ? [{ method: 'nostr', info: m.operatorPubkey }] : [];
  return {
    url: m.mintUrl,
    name: m.name || m.mintUrl,
    supported_units: m.supportedUnits ?? [],
    // Derived from the raw NUT-06 nuts map (nuts['4'].methods) — nagg ships
    // capabilities undistilled by design.
    supported_methods: mintMethodsFromNuts(m.nuts),
    supported_method_units: mintMethodUnitPairsFromNuts(m.nuts, '4'),
    state: m.state ?? 'unknown',
    n_mints: m.nMints ?? 0,
    n_melts: m.nMelts ?? 0,
    n_errors: m.nErrors ?? 0,
    review_score: m.averageScore,
    review_count: m.reviewCount,
    info: {
      ...(m.iconUrl ? { icon_url: m.iconUrl } : {}),
      ...(m.description ? { description: m.description } : {}),
      contact,
    },
  };
}

function matchesQuery(result: MintSearchResult, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return result.name.toLowerCase().includes(needle) || result.url.toLowerCase().includes(needle);
}

function matchesCurrency(result: MintSearchResult, currency: string): boolean {
  if (!currency || currency === 'ALL') return true;
  const units = currency
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  if (units.length === 0) return true;
  return result.supported_units.some((u) => units.includes(u.toLowerCase()));
}

/**
 * Method filter for receive-rail discovery CTAs. A mint matches only when nagg
 * reported it advertises the method — absence means "not known to support", so
 * rows without the field are excluded while the filter is on.
 *
 * When a concrete currency (unit) is selected, matching is on the NUT-04
 * (method, unit) PAIR: a mint that advertises `bolt12` only for `eur` must NOT
 * match a `sat` rail. `currency === 'ALL'` (or empty) falls back to method-only
 * — the user explicitly chose to browse every unit. Exported for testing.
 */
export function discoveryMethodMatches(
  result: MintSearchRow,
  method: string | undefined,
  currency: string
): boolean {
  if (!method) return true;
  const wantMethod = method.toLowerCase();
  const units = currency
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter((u) => u && u !== 'all');
  if (units.length === 0) {
    return result.supported_methods.some((m) => m.toLowerCase() === wantMethod);
  }
  return result.supported_method_units.some(
    (p) => p.method === wantMethod && units.includes(p.unit)
  );
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
        matchesQuery(m, q) &&
        matchesCurrency(m, currency) &&
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
    if (!matchesQuery(mint, query.trim())) continue;
    for (const unit of DISCOVERY_UNITS) {
      if (matchesCurrency(mint, unit) && discoveryMethodMatches(mint, method, unit)) {
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
