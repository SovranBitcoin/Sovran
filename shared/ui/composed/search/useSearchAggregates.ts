/**
 * @fileoverview Single aggregation seam behind the unified search surface.
 *
 * Composes the existing people/place search (`useAllSearchResults`) with the
 * server-backed mint search (`useMintSearch`) into one set of per-scope buckets
 * plus a flat, relevance-ranked "All" feed. Every search surface (Contacts,
 * Feed, Wallet) reads this one hook, so they all aggregate the same things and
 * stay in sync — no per-surface result wiring.
 *
 * Mint search only fires once the query is long enough to be worth a network
 * round-trip; below that the Mints bucket is simply empty (and its tab hidden).
 */
import { useMemo } from 'react';

import {
  useAllSearchResults,
  type AllSearchResult,
} from '@/features/contacts/hooks/useAllSearchResults';
import { useMintSearch } from '@/features/mint/hooks/useMintSearch';

/** Shorter than the people minimum (3) — mint names are often 2-letter brands. */
const MINT_SEARCH_MIN_LENGTH = 2;

/** Mint relevance band: below the geohash jump (110) and top contacts (100…),
 *  above tier matches (80–90), so the ranked "All" feed interleaves sensibly. */
const SCORE_MINT_BASE = 95;

export type SearchAggregates = {
  /** Trimmed query the buckets reflect. */
  query: string;
  /** Flat relevance-ranked feed: people + places + mints (the "All" scope). */
  all: AllSearchResult[];
  /** Contact rows (the People scope). */
  people: AllSearchResult[];
  /** Geohash-jump + tier rows (the Groups scope). */
  groups: AllSearchResult[];
  /** Mint rows (the Mints scope). */
  mints: AllSearchResult[];
  /** Real pubkeys behind the people rows (the Posts scope fetches their posts). */
  postsAuthors: string[];
  /** Per-scope counts, used to decide which scope tabs are visible. */
  counts: { people: number; groups: number; mints: number; posts: number };
  /** Combined loading (people OR mints) — drives the All scope skeletons. */
  loading: boolean;
  /** People search in flight — drives the People scope skeletons. */
  peopleLoading: boolean;
  /** Mint search in flight — drives the Mints scope skeletons. */
  mintsLoading: boolean;
};

export function useSearchAggregates(query: string): SearchAggregates {
  const { results, people, groups, postsAuthors, loading } = useAllSearchResults(query);

  const trimmed = query.trim();
  const mintEnabled = trimmed.length >= MINT_SEARCH_MIN_LENGTH;
  const { results: mintResults, loading: mintLoading } = useMintSearch(query, 'ALL', {
    enabled: mintEnabled,
  });

  const mints = mintResults.map((mint, i) => ({
    type: 'mint' as const,
    id: `mint:${mint.url}`,
    mint,
    score: SCORE_MINT_BASE - i,
  }));

  const all = useMemo<AllSearchResult[]>(() => {
    const combined = [...results, ...mints];
    combined.sort((a, b) => b.score - a.score);
    return combined;
  }, [results, mints]);

  return {
    query: trimmed,
    all,
    people,
    groups,
    mints,
    postsAuthors,

    counts: {
      // People/Posts gate on *real* matched authors (not the placeholder
      // skeleton rows present mid-load), so their tabs don't flicker in and
      // back out while a search is in flight.
      people: postsAuthors.length,
      groups: groups.length,
      mints: mints.length,
      posts: postsAuthors.length,
    },

    loading: loading || (mintEnabled && mintLoading),
    peopleLoading: loading,
    mintsLoading: mintEnabled && mintLoading,
  };
}
