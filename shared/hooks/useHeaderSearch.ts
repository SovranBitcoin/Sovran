import { useState, useCallback, useRef } from 'react';
import { Keyboard } from 'react-native';
import { log } from '@/shared/lib/logger';

/**
 * Shared search toggle state machine for header search UIs.
 *
 * Used by contacts layout and mint add screen to provide a consistent
 * "search icon → search bar → X close" interaction pattern.
 */
export function useHeaderSearch() {
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [clearKey, setClearKey] = useState(0);
  const openedAtRef = useRef<number>(0);

  const onOpenSearch = useCallback(() => {
    openedAtRef.current = Date.now();
    log.debug('header_search.open');
    setIsSearching(true);
  }, []);

  const onCloseSearch = useCallback(() => {
    const duration = openedAtRef.current ? Date.now() - openedAtRef.current : 0;
    log.debug('header_search.close', {
      duration_ms: duration,
      hadQuery: searchQuery.length > 0,
      queryLength: searchQuery.length,
    });
    setIsSearching(false);
    setSearchQuery('');
    setClearKey((prev) => prev + 1);
    Keyboard.dismiss();
  }, [searchQuery]);

  const onSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  return { isSearching, searchQuery, clearKey, onOpenSearch, onCloseSearch, onSearchChange };
}
