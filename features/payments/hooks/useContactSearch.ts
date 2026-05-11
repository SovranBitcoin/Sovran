import { useState, useEffect, useMemo } from 'react';
import { searchUsers as apiSearchUsers, type UserProfile } from '@/shared/lib/apiClient';
import { paymentLog } from '@/shared/lib/logger';
import { useSearchHistoryStore } from '@/shared/stores/profile/searchHistoryStore';
import { useNostrMetadataCache } from '@/shared/stores/global/nostrMetadataCache';
import { Hex64 } from '@sovranbitcoin/schemas';

interface SearchResultData {
  pubkey: string;
  profile: UserProfile;
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
const SEARCH_DEBOUNCE_MS = 250;

// Mirror the server-side `SearchQuery.min(3)` in `sovran-schemas/src/nostr-api.ts`.
// Anything shorter is rejected upstream, so suppress the request entirely.
export const CONTACT_SEARCH_MIN_LENGTH = 3;

export function useContactSearch(searchQuery: string) {
  const addSearchToHistory = useSearchHistoryStore((state) => state.addSearch);
  const seedFromSearchResults = useNostrMetadataCache((s) => s.seedFromSearchResults);
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [searchResults, setSearchResults] = useState<SearchResultData[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Debounce the query: every keystroke resets the timer, only the last one
  // in a burst flows through to the effect below. Short queries skip the
  // wait because they'll be rejected by the length guard anyway.
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || trimmed.length < CONTACT_SEARCH_MIN_LENGTH) {
      setDebouncedQuery(searchQuery);
      return;
    }
    const t = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
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
    setSearchLoading(true);
    setHasSearched(true);

    const search = async () => {
      try {
        paymentLog.debug('payment.contacts.search', { query: debouncedQuery, limit: 10 });
        const result = await apiSearchUsers({
          query: debouncedQuery,
          limit: 10,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (result.isOk()) {
          const data = result.value;
          if (data.results && Array.isArray(data.results)) {
            const formatted: SearchResultData[] = data.results.map((res) => {
              let profileEventPubkey = res.pubkey;
              if (res.profileEvent) {
                try {
                  const parsed: unknown = JSON.parse(res.profileEvent);
                  if (parsed !== null && typeof parsed === 'object' && 'pubkey' in parsed) {
                    const validated = Hex64.safeParse(parsed.pubkey);
                    if (validated.success) {
                      profileEventPubkey = validated.data;
                    }
                  }
                } catch {
                  // Invalid profileEvent JSON
                }
              }
              return {
                pubkey: res.pubkey,
                profile: { ...res, pubkey: profileEventPubkey },
              };
            });
            paymentLog.info('payment.contacts.search.results', {
              query: debouncedQuery,
              resultCount: formatted.length,
            });
            setSearchResults(formatted);
            if (formatted.length > 0) {
              seedFromSearchResults(formatted);
              addSearchToHistory(debouncedQuery, 'payments');
            }
          } else {
            setSearchResults([]);
          }
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        paymentLog.error('payment.contacts.search.error', {
          query: debouncedQuery,
          error: err instanceof Error ? err : new Error(String(err)),
        });
        setSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    };

    void search();
    return () => controller.abort();
  }, [debouncedQuery, addSearchToHistory, seedFromSearchResults]);

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
    debouncedQuery.trim().length > 0 && hasSearched && !searchLoading && searchResults.length === 0;

  return {
    displayResults,
    searchLoading,
    hasSearched,
    showNoResults,
  };
}
