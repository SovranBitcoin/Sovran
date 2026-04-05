import { useState, useEffect, useCallback, useMemo } from 'react';
import { Keyboard } from 'react-native';
import { searchUsers as apiSearchUsers, type UserProfile } from '@/shared/lib/apiClient';
import { paymentLog } from '@/shared/lib/logger';
import { useSearchHistoryStore } from '@/shared/stores/profile/searchHistoryStore';
import { router } from 'expo-router';

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

  const searchUsers = useCallback(
    async (query: string) => {
      if (!query.trim()) return;
      setSearchLoading(true);
      setHasSearched(true);

      try {
        paymentLog.debug('payment.contacts.search', { query, limit: 10 });
        const result = await apiSearchUsers({ query, limit: 10 });
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
            paymentLog.info('payment.contacts.search.results', { query, resultCount: formatted.length });
            setSearchResults(formatted);
            if (formatted.length > 0) addSearchToHistory(query, 'payments');
          } else {
            setSearchResults([]);
          }
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        paymentLog.error('payment.contacts.search.error', { query, error: err instanceof Error ? err : new Error(String(err)) });
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [addSearchToHistory]
  );

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || trimmed.length < 2) {
      setHasSearched(false);
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    searchUsers(searchQuery);
  }, [searchQuery, searchUsers]);

  const displayResults: DisplayResult[] = useMemo(() => {
    if (searchLoading || !hasSearched) return PLACEHOLDER_RESULTS;
    return searchResults;
  }, [hasSearched, searchLoading, searchResults]);

  const showNoResults =
    searchQuery.trim().length > 0 && hasSearched && !searchLoading && searchResults.length === 0;

  const navigateToProfile = useCallback(({ pubkey }: { pubkey: string }) => {
    router.navigate({
      pathname: '/(user-flow)/profile' as any,
      params: { pubkey },
    });
  }, []);

  const handleSearchResultPress = useCallback(
    (result: DisplayResult) => {
      if (searchLoading || !result.profile) return;
      Keyboard.dismiss();
      requestAnimationFrame(() => {
        navigateToProfile({ pubkey: result.pubkey });
      });
    },
    [searchLoading, navigateToProfile]
  );

  return {
    displayResults,
    searchLoading,
    hasSearched,
    showNoResults,
    handleSearchResultPress,
  };
}
