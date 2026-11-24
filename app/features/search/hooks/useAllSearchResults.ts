/**
 * @fileoverview Aggregate people-and-places search behind the Search tab.
 *
 * Composes Nostr-profile contact hits (the facade's profile search via `useContactSearch`) with
 * location-tier matches and geohash jump cards, so a single query like
 * "Province", "London", "Bluetooth", or a bare geohash surfaces the right
 * result regardless of category.
 *
 * Each entry in the returned array is a discriminated union — the consumer
 * renders the right row variant per `type`. Results are sorted by a simple
 * relevance score so the geohash jump card always floats to the top,
 * contacts follow (preserving API order via an incrementing score), and
 * tier matches fall below.
 */

import { useMemo } from 'react';

import { useOverlaidContactSearch, type ContactSearchRow } from './useOverlaidContactSearch';
import { useLocationTiers, type TierEntry } from '@/features/bitchat/hooks/useLocationTiers';
import type { MintSearchResult } from '@/shared/lib/apiClient';
import type { SearchStatus } from '@/shared/ui/composed/search/searchListState';
import { parseGeohashQuery } from '../lib/parseGeohashQuery';
import { matchTiers } from '../lib/matchTiers';

/**
 * Place matches use the location only once a query is typed, and only when the
 * person already allowed it: opening Search never shows the location prompt.
 */
const LOCATION_TIER_OPTIONS = { requestPermission: false } as const;

export type AllSearchResult =
  | { type: 'geohash'; id: string; geohash: string; score: number }
  | { type: 'tier'; id: string; tier: TierEntry; score: number }
  // The `contact` arm is `ContactSearchRow`, owned by `useOverlaidContactSearch`
  // (the single owner of the kind-0-overlay-over-`useContactSearch` assembly that
  // both this hook and the Send modal consume).
  | ContactSearchRow
  // `mint` rows are not produced here (this hook never hits the mint search
  // API) — they're merged in by `useSearchAggregates`. The arm lives on the
  // shared union so the row renderer can dispatch on it.
  | { type: 'mint'; id: string; mint: MintSearchResult; score: number };

interface UseAllSearchResultsResult {
  /** People + places (geohash + tier), relevance-sorted. The unscoped feed. */
  results: AllSearchResult[];
  /** Contact rows only (for the People scope + post-author derivation). */
  people: AllSearchResult[];
  /** Geohash-jump + tier rows only (for the Groups scope). */
  groups: AllSearchResult[];
  /** Real pubkeys behind the contact rows (placeholder rows excluded). */
  peoplePubkeys: string[];
  loading: boolean;
  /** People-search read status (drives placeholders / no-results / error). */
  status: SearchStatus;
  retry: () => void;
}

// Score constants — arrange the All feed with geohash jump on top, then
// contact API hits (scored inside `useOverlaidContactSearch`), then tier matches.
const SCORE_GEOHASH = 110;
const SCORE_TIER_LABEL = 90;
const SCORE_TIER_DISPLAYNAME = 80;

export function useAllSearchResults(query: string): UseAllSearchResultsResult {
  // Contact hits + kind-0 overlay come from the shared owner; this hook adds the
  // location/tier + geohash dimensions the Search tab's "All" scope needs.
  const { contactRows, loading, status, retry } = useOverlaidContactSearch(query);
  const { tiers } = useLocationTiers({
    ...LOCATION_TIER_OPTIONS,
    enabled: query.trim().length > 0,
  });

  return useMemo(() => {
    const trimmed = query.trim();
    const lowerQuery = trimmed.toLowerCase();

    // --- geohash ---
    const geohash = parseGeohashQuery(trimmed);
    const geohashRow: AllSearchResult | null = geohash
      ? { type: 'geohash', id: `geohash:${geohash}`, geohash, score: SCORE_GEOHASH }
      : null;

    // --- contacts --- come pre-overlaid + scored from `useOverlaidContactSearch`.

    // --- tiers (label prefix or displayName substring) ---
    const tierRows: AllSearchResult[] = matchTiers(tiers, lowerQuery).map((tier) => {
      const labelMatch = tier.label.toLowerCase().startsWith(lowerQuery);
      return {
        type: 'tier' as const,
        id: `tier:${tier.key}`,
        tier,
        score: labelMatch ? SCORE_TIER_LABEL : SCORE_TIER_DISPLAYNAME,
      };
    });

    // Places (geohash jump + tier matches) bucket — drives the Groups scope.
    const groups: AllSearchResult[] = [...(geohashRow ? [geohashRow] : []), ...tierRows];

    const combined: AllSearchResult[] = [...groups, ...contactRows];
    combined.sort((a, b) => b.score - a.score);

    // Gates the People scope tab on real matches.
    const peoplePubkeys = contactRows.map((r) => r.pubkey);

    return {
      results: combined,
      people: contactRows,
      groups,
      peoplePubkeys,
      loading,
      status,
      retry,
    };
  }, [query, contactRows, loading, status, retry, tiers]);
}
