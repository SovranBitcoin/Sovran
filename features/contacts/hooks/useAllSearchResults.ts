/**
 * @fileoverview Aggregate search hook for the "All" pill in Contacts search.
 *
 * Composes Nostr-profile contact hits (Nagg GraphQL via `useContactSearch`) with
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
import type { MintSearchResult, NostrSearchResult } from '@/shared/lib/apiClient';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import { parseGeohashQuery } from '../lib/parseGeohashQuery';
import { matchTiers } from '../lib/matchTiers';

export type AllSearchResult =
  | { type: 'geohash'; id: string; geohash: string; score: number }
  | { type: 'tier'; id: string; tier: TierEntry; score: number }
  | {
      type: 'contact';
      id: string;
      pubkey: string;
      profile?: NostrSearchResult;
      isLoadingProfile: boolean;
      score: number;
    }
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
  /** Real (non-placeholder) pubkeys behind the contact rows, for the Posts scope. */
  postsAuthors: string[];
  loading: boolean;
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

  // Pubkeys with a real (non-placeholder) row. The GraphQL profile search
  // endpoint can return sparse / stale profile data — sometimes just a
  // pubkey with none of `displayName`/`picture`/`nip05` populated — so we
  // layer the shared kind-0 metadata cache on top. Cache hits paint
  // immediately; missing/stale entries trigger a relay subscription. This
  // mirrors the same overlay the split-bill picker does for its
  // `useContactSearch` hits.
  const realPubkeys = useMemo(() => {
    // Single pass: filter (has profile, not a placeholder) + project to pubkey.
    const pubkeys: string[] = [];
    for (const r of displayResults) {
      if (r.profile && !r.pubkey.startsWith('placeholder-')) pubkeys.push(r.pubkey);
    }
    return pubkeys;
  }, [displayResults]);
  const { metadata: cachedMetadata } = useNostrProfileMetadataMany(realPubkeys);

  return useMemo(() => {
    const trimmed = query.trim();
    const lowerQuery = trimmed.toLowerCase();

    // --- geohash ---
    const geohash = parseGeohashQuery(trimmed);
    const geohashRow: AllSearchResult | null = geohash
      ? { type: 'geohash', id: `geohash:${geohash}`, geohash, score: SCORE_GEOHASH }
      : null;

    // --- contacts (GraphQL profile search, score preserves API order) ---
    // `isLoadingProfile` reflects whether *this row's* profile is absent —
    // not whether *some* query is in flight. `useContactSearch` keeps the
    // prior results visible during a new query (stale-while-revalidate), so
    // flagging every row loading on every keystroke would re-skeleton real
    // results and cause the jarring flash we see on rapid typing.
    const contactRows: AllSearchResult[] = displayResults.map((r: DisplayResult, i) => {
      // Overlay relay-cached kind-0 metadata over the GraphQL snapshot:
      // cache values win when defined (they're authoritative), falling
      // back to the API row otherwise. Without this, search hits whose
      // GraphQL response carries only a pubkey render as fallback gradient
      // + abbreviated pubkey title even though we already have the
      // profile cached from another surface.
      const cached = r.profile ? cachedMetadata.get(r.pubkey) : undefined;
      const profile: NostrSearchResult | undefined =
        r.profile && cached
          ? {
              ...r.profile,
              displayName: cached.displayName ?? r.profile.displayName,
              name: cached.name ?? r.profile.name,
              picture: cached.picture ?? r.profile.picture,
              nip05: cached.nip05 ?? r.profile.nip05,
              banner: cached.banner ?? r.profile.banner,
              lud16: cached.lud16 ?? r.profile.lud16,
              about: cached.about ?? r.profile.about,
              website: cached.website ?? r.profile.website,
            }
          : r.profile;
      return {
        type: 'contact' as const,
        id: `contact:${r.pubkey}`,
        pubkey: r.pubkey,
        profile,
        isLoadingProfile: !hasSearched || !r.profile,
        score: SCORE_CONTACT_BASE - i, // preserve order from API
      };
    });

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

    // Pubkeys with a real (non-placeholder) profile — the authors the Posts
    // scope fetches recent posts for, and the gate for showing the Posts tab.
    const postsAuthors = contactRows.flatMap((r) =>
      r.type === 'contact' && !r.pubkey.startsWith('placeholder-') ? [r.pubkey] : []
    );

    return {
      results: combined,
      people: contactRows,
      groups,
      postsAuthors,
      loading: searchLoading,
    };
  }, [query, displayResults, searchLoading, hasSearched, tiers, cachedMetadata]);
}
