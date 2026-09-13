import { useNDK, type default as NDK } from '@nostr-dev-kit/ndk-mobile';
import { useState, useEffect, useMemo, useRef } from 'react';
import { CONTACT_SEARCH_MIN_LENGTH } from '@/shared/lib/contactSearch';
import { type NostrSearchResult } from '@/shared/lib/apiClient';
import type { SearchUsersResponse } from '@sovranbitcoin/schemas';
import { searchProfilesViaFacade } from '@/shared/lib/nostr/searchProfiles';
import { paymentLog, redactError } from '@/shared/lib/logger';
import { seedLowConfidenceProfiles } from '@/shared/lib/nostr/useEntityCache';

interface SearchResultData {
  pubkey: string;
  profile: NostrSearchResult;
}

interface PlaceholderResult {
  pubkey: string;
  profile?: undefined;
}

export type DisplayResult = SearchResultData | PlaceholderResult;

const PLACEHOLDER_RESULTS: PlaceholderResult[] = Array.from({ length: 6 }, (_, i) => ({
  pubkey: `placeholder-${i}`,
}));

// Keystrokes under this threshold don't hit the API. Matches the perceptual
// pause between typed characters for a normal typing cadence — long enough
// to coalesce a burst, short enough that a deliberate pause feels responsive.
const SEARCH_DEBOUNCE_MS = 600;

// Mirror the server-side `SearchQuery.min(3)` in `sovran-schemas/src/nostr-api.ts`.
// Anything shorter is rejected upstream, so suppress the request entirely.

/** The search-effect fetch body, verbatim: query the facade and seed caches. */
async function runContactSearch(ctx: {
  query: string;
  ndk?: NDK;
  signal: AbortSignal;
  setSearchResults: (results: SearchResultData[]) => void;
  setSearchLoading: (loading: boolean) => void;
}): Promise<void> {
  const { query, signal, setSearchResults, setSearchLoading } = ctx;
  const applyResults = (data: SearchUsersResponse) => {
    if (signal.aborted) return;
    if (data.results && Array.isArray(data.results)) {
      const formatted: SearchResultData[] = data.results.map((res) => ({
        pubkey: res.pubkey,
        profile: res,
      }));
      paymentLog.info('payment.contacts.search.results', {
        resultCount: formatted.length,
      });
      setSearchResults(formatted);
      if (formatted.length > 0) {
        const seeds: Record<string, { name?: string; picture?: string }> = {};
        for (const r of formatted) {
          seeds[r.pubkey] = {
            ...(r.profile.displayName || r.profile.name
              ? { name: r.profile.displayName ?? r.profile.name }
              : {}),
            ...(r.profile.picture ? { picture: r.profile.picture } : {}),
          };
        }
        seedLowConfidenceProfiles(seeds);
      }
    } else {
      setSearchResults([]);
    }
  };
  try {
    paymentLog.debug('payment.contacts.search', { limit: 10 });
    const result = await searchProfilesViaFacade({
      query,
      ndk: ctx.ndk,
      onCached: (data) => {
        if (signal.aborted) return;
        applyResults(data);
        setSearchLoading(false);
      },
      limit: 10,
      signal,
    });
    if (signal.aborted) return;
    if (result.isOk()) {
      applyResults(result.value);
    } else {
      paymentLog.warn('payment.contacts.search.failed', {
        error: redactError(result.error),
      });
      setSearchResults([]);
    }
  } catch (err) {
    if (signal.aborted) return;
    paymentLog.error('payment.contacts.search.error', {
      error: redactError(err),
    });
    setSearchResults([]);
  } finally {
    if (!signal.aborted) setSearchLoading(false);
  }
}

export function useContactSearch(searchQuery: string) {
  const { ndk } = useNDK();
  const [debouncedQuery, setDebouncedQuery] = useState({ value: '' });
  const [searchResults, setSearchResults] = useState<SearchResultData[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  // Debounce the query: every keystroke resets the timer, only the last one
  // in a burst flows through to the effect below. Short queries skip the
  // wait because they'll be rejected by the length guard anyway.
  useEffect(() => {
    requestRef.current?.abort();
    const trimmed = searchQuery.trim();
    if (!trimmed || trimmed.length < CONTACT_SEARCH_MIN_LENGTH) {
      setDebouncedQuery({ value: searchQuery });
      return;
    }
    const t = setTimeout(() => setDebouncedQuery({ value: searchQuery }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    const trimmed = debouncedQuery.value.trim();
    if (!trimmed || trimmed.length < CONTACT_SEARCH_MIN_LENGTH) {
      setHasSearched(false);
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    // Abort any in-flight request when the query changes or the component
    // unmounts. Without this the radio stays warm for every keystroke in a
    // typing burst even though only the last result is consumed.
    const controller = new AbortController();
    requestRef.current = controller;
    setSearchLoading(true);
    setHasSearched(true);

    void runContactSearch({
      query: debouncedQuery.value.trim().toLowerCase(),
      ndk,
      signal: controller.signal,
      setSearchResults,
      setSearchLoading,
    });
    return () => controller.abort();
  }, [debouncedQuery, ndk]);

  // Stale-while-revalidate: once the first response has landed we keep
  // showing those results while the next query is in flight. Skeletons
  // only appear on the very first search of a session — avoids the
  // per-keystroke flash that makes results look like they never change.
  const displayResults: DisplayResult[] = useMemo(() => {
    if (!hasSearched) return PLACEHOLDER_RESULTS;
    if (searchLoading && searchResults.length === 0) return PLACEHOLDER_RESULTS;
    return searchResults;
  }, [hasSearched, searchLoading, searchResults]);

  const showNoResults =
    debouncedQuery.value.trim().length > 0 &&
    hasSearched &&
    !searchLoading &&
    searchResults.length === 0;

  return {
    displayResults,
    searchLoading,
    hasSearched,
    showNoResults,
  };
}
