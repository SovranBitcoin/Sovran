import { useState, useEffect, useMemo } from 'react';
import { searchUsers as apiSearchUsers, type UserProfile } from '@/shared/lib/apiClient';
import { paymentLog } from '@/shared/lib/logger';
import { useSearchHistoryStore } from '@/shared/stores/profile/searchHistoryStore';

export interface SearchResultData {
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

export function useContactSearch(searchQuery: string) {
  const addSearchToHistory = useSearchHistoryStore((state) => state.addSearch);
  const [searchResults, setSearchResults] = useState<SearchResultData[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || trimmed.length < 2) {
      setHasSearched(false);
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    setHasSearched(true);

    const search = async () => {
      try {
        paymentLog.debug('payment.contacts.search', { query: searchQuery, limit: 10 });
        const result = await apiSearchUsers({ query: searchQuery, limit: 10 });
        if (cancelled) return;
        if (result.isOk()) {
          const data = result.value;
          if (data.results && Array.isArray(data.results)) {
            const formatted: SearchResultData[] = data.results.map((res) => {
              let profileEventPubkey = res.pubkey;
              if (res.profileEvent) {
                try {
                  const parsed = JSON.parse(res.profileEvent);
                  if (parsed?.pubkey) profileEventPubkey = parsed.pubkey;
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
              query: searchQuery,
              resultCount: formatted.length,
            });
            setSearchResults(formatted);
            if (formatted.length > 0) addSearchToHistory(searchQuery, 'payments');
          } else {
            setSearchResults([]);
          }
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        if (cancelled) return;
        paymentLog.error('payment.contacts.search.error', {
          query: searchQuery,
          error: err instanceof Error ? err : new Error(String(err)),
        });
        setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    };

    search();
    return () => { cancelled = true; };
  }, [searchQuery, addSearchToHistory]);

  const displayResults: DisplayResult[] = useMemo(() => {
    if (searchLoading || !hasSearched) return PLACEHOLDER_RESULTS;
    return searchResults;
  }, [hasSearched, searchLoading, searchResults]);

  const showNoResults =
    searchQuery.trim().length > 0 && hasSearched && !searchLoading && searchResults.length === 0;

  return {
    displayResults,
    searchLoading,
    hasSearched,
    showNoResults,
  };
}
