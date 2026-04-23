/**
 * @fileoverview Aggregate search hook for the "All" pill in Contacts search.
 *
 * Composes Nostr-profile contact hits (REST API via `useContactSearch`) with
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

import { useContactSearch, type DisplayResult } from '@/features/payments/hooks/useContactSearch';
import { useLocationTiers, type TierEntry } from '@/features/bitchat/hooks/useLocationTiers';
import { isValidGeohash } from 'bitchat-module';
import type { UserProfile } from '@/shared/lib/apiClient';

export type AllSearchResult =
  | { type: 'geohash'; id: string; geohash: string; score: number }
  | { type: 'tier'; id: string; tier: TierEntry; score: number }
  | {
      type: 'contact';
      id: string;
      pubkey: string;
      profile?: UserProfile;
      isLoadingProfile: boolean;
      score: number;
    };

export interface UseAllSearchResultsResult {
  results: AllSearchResult[];
  loading: boolean;
}

/**
 * Extract a geohash from the raw query: accept both "#abc" and bare "abc"
 * as long as it's at least 2 chars and passes `isValidGeohash`. We decline
 * to match if the query contains whitespace — that's almost certainly a
 * word search, not a geohash, even if every letter happens to be base32.
 */
function parseGeohashQuery(trimmed: string): string | null {
  if (!trimmed) return null;
  const hash = trimmed.startsWith('#')
    ? trimmed.slice(1).toLowerCase()
    : trimmed.toLowerCase();
  if (hash.length < 2) return null;
  if (!isValidGeohash(hash)) return null;
  if (!trimmed.startsWith('#') && /\s/.test(trimmed)) return null;
  return hash;
}

/**
 * Match tiers by `label` prefix OR reverse-geocoded `displayName` substring.
 * BLE ("Bluetooth") only matches ≥3-char queries so stray "bl" doesn't
 * surface it.
 */
function matchTiers(tiers: TierEntry[], lowerQuery: string): TierEntry[] {
  if (!lowerQuery) return [];
  return tiers.filter((tier) => {
    if (tier.transport === 'ble') {
      return tier.label.toLowerCase().startsWith(lowerQuery) && lowerQuery.length >= 3;
    }
    if (tier.label.toLowerCase().startsWith(lowerQuery)) return true;
    if (tier.displayName?.toLowerCase().includes(lowerQuery)) return true;
    return false;
  });
}

// Score constants — arrange the All feed with geohash jump on top, then
// contact API hits, then tier matches.
const SCORE_GEOHASH = 110;
const SCORE_CONTACT_BASE = 100;
const SCORE_TIER_LABEL = 90;
const SCORE_TIER_DISPLAYNAME = 80;

export function useAllSearchResults(query: string): UseAllSearchResultsResult {
  const { displayResults, searchLoading, hasSearched } = useContactSearch(query);
  const { tiers } = useLocationTiers();

  return useMemo(() => {
    const trimmed = query.trim();
    const lowerQuery = trimmed.toLowerCase();

    // --- geohash ---
    const geohash = parseGeohashQuery(trimmed);
    const geohashRow: AllSearchResult | null = geohash
      ? { type: 'geohash', id: `geohash:${geohash}`, geohash, score: SCORE_GEOHASH }
      : null;

    // --- contacts (REST API, score preserves API order) ---
    // `isLoadingProfile` reflects whether *this row's* profile is absent —
    // not whether *some* query is in flight. `useContactSearch` keeps the
    // prior results visible during a new query (stale-while-revalidate), so
    // flagging every row loading on every keystroke would re-skeleton real
    // results and cause the jarring flash we see on rapid typing.
    const contactRows: AllSearchResult[] = displayResults.map((r: DisplayResult, i) => ({
      type: 'contact' as const,
      id: `contact:${r.pubkey}`,
      pubkey: r.pubkey,
      profile: r.profile,
      isLoadingProfile: !hasSearched || !r.profile,
      score: SCORE_CONTACT_BASE - i, // preserve order from API
    }));

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

    const combined: AllSearchResult[] = [
      ...(geohashRow ? [geohashRow] : []),
      ...contactRows,
      ...tierRows,
    ];
    combined.sort((a, b) => b.score - a.score);

    return {
      results: combined,
      loading: searchLoading,
    };
  }, [query, displayResults, searchLoading, hasSearched, tiers]);
}
