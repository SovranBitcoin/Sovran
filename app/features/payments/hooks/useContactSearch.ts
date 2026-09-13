import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { useMemo } from 'react';
import { CONTACT_SEARCH_MIN_LENGTH } from '@/shared/lib/contactSearch';
import { type NostrSearchResult } from '@/shared/lib/apiClient';
import type { SearchUsersResponse } from '@sovranbitcoin/schemas';
import {
  isProfileSearchRefinement,
  profileSearchCache,
  profileSearchKey,
} from '@/features/payments/data/profileSearchCache';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { useCachedRead } from '@/shared/lib/read/useCachedRead';
import { searchProfilesViaFacade } from '@/shared/lib/nostr/searchProfiles';
import { seedLowConfidenceProfiles } from '@/shared/lib/nostr/useEntityCache';
import type { SearchStatus } from '@/shared/ui/composed/search/searchListState';

export interface SearchResultData {
  pubkey: string;
  profile: NostrSearchResult;
}

/**
 * Pause between keystrokes before a query is sent. Short enough that a
 * deliberate pause feels responsive, long enough to coalesce a burst; the
 * in-flight request is NOT cancelled by a keystroke inside this window.
 */
export const SEARCH_DEBOUNCE_MS = 350;

/** Seed the entity cache with the hit's name/picture so rows paint before kind-0 resolves. */
function seedProfiles(data: SearchUsersResponse): void {
  if (!data.results.length) return;
  const seeds: Record<string, { name?: string; picture?: string }> = {};
  for (const res of data.results) {
    seeds[res.pubkey] = {
      ...(res.displayName || res.name ? { name: res.displayName ?? res.name } : {}),
      ...(res.picture ? { picture: res.picture } : {}),
    };
  }
  seedLowConfidenceProfiles(seeds);
}

/**
 * People search: debounced, cached by normalized query, stale-while-revalidate.
 *
 * Contract (SYSTEM.md §7/§14): rows on screen stay while a refinement loads
 * (`keepPreviousData`, refinements only — an unrelated query never opens on
 * the previous query's people); a query already searched this session paints at 0ms;
 * a partial answer (first tier, Vertex pre-refresh) paints immediately and is
 * upgraded in place; a failed search is `error`, never a fake "no results".
 */
export function useContactSearch(searchQuery: string) {
  const { ndk } = useNDK();
  const normalized = searchQuery.trim().toLowerCase();
  const tooShort = normalized.length < CONTACT_SEARCH_MIN_LENGTH;
  // A query below the minimum follows immediately (clearing must not wait out
  // the debounce); a real query waits for the typing burst to settle.
  const debounced = useDebouncedValue(normalized, SEARCH_DEBOUNCE_MS, { immediate: tooShort });
  const active = debounced.length >= CONTACT_SEARCH_MIN_LENGTH ? debounced : null;

  const read = useCachedRead<SearchUsersResponse>({
    store: profileSearchCache,
    surface: 'searchProfiles',
    key: active ? profileSearchKey(active) : null,
    viewerKey: '',
    strategy: 'aggregate',
    focusRevalidate: false,
    // A refinement is the same surface: keep the previous rows while it loads.
    // An unrelated query is not — it starts from the loading state.
    keepPreviousData: isProfileSearchRefinement,
    classify: (data) => (data.results.length === 0 ? 'empty' : 'ready'),
    fetcher: async ({ signal, readId, partial }) => {
      const query = active ?? '';
      const paint = (data: SearchUsersResponse) => {
        seedProfiles(data);
        partial(data);
      };
      const result = await searchProfilesViaFacade({
        query,
        ndk,
        limit: 10,
        signal,
        readId,
        onCached: paint,
        onUpdate: paint,
      });
      if (result.isErr()) throw result.error;
      seedProfiles(result.value);
      return { data: result.value };
    },
  });

  const results = useMemo<SearchResultData[]>(
    () => (read.data?.results ?? []).map((profile) => ({ pubkey: profile.pubkey, profile })),
    [read.data]
  );
  const status: SearchStatus = active ? read.status : 'idle';

  return {
    results,
    status,
    /** True while a real query is active (results, empty or error apply to it). */
    hasSearched: !!active,
    /** A request is in flight for the active query (initial or refinement). */
    searchLoading: status === 'loading' || status === 'revalidating',
    /** The painted rows are a first-tier / pre-Vertex answer; more may land. */
    partial: read.partial,
    error: read.error,
    retry: read.refresh,
  };
}
