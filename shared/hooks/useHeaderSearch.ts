import { useState, useRef } from 'react';
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
  // Text to seed the (uncontrolled) search input with on its next remount.
  // Bumping `clearKey` remounts the TextInput; it reads this as its
  // `defaultValue`. Used to re-run a tapped recent-search chip.
  const [seedText, setSeedText] = useState('');
  const openedAtRef = useRef<number>(0);

  const onOpenSearch = () => {
    openedAtRef.current = Date.now();
    log.debug('header_search.open');
    setIsSearching(true);
  };

  const onCloseSearch = () => {
    const duration = openedAtRef.current ? Date.now() - openedAtRef.current : 0;
    log.debug('header_search.close', {
      duration_ms: duration,
      hadQuery: searchQuery.length > 0,
      queryLength: searchQuery.length,
    });
    setIsSearching(false);
    setSearchQuery('');
    setSeedText('');
    setClearKey((prev) => prev + 1);
    Keyboard.dismiss();
  };

  const onSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  // Programmatically run a query (e.g. tapping a recent-search chip): set the
  // results immediately and remount the input seeded with the text.
  const setQuery = (query: string) => {
    setSearchQuery(query);
    setSeedText(query);
    setClearKey((prev) => prev + 1);
  };

  return {
    isSearching,
    searchQuery,
    clearKey,
    seedText,
    onOpenSearch,
    onCloseSearch,
    onSearchChange,
    setQuery,
  };
}
