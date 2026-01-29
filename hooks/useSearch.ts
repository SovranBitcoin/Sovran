import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

/**
 * Configuration options for the useSearch hook
 */
interface UseSearchOptions<T> {
  /** Items to filter */
  items: T[];
  /** Function to extract searchable text from an item */
  getSearchableText: (item: T) => string | string[];
  /** Debounce delay in milliseconds (default: 300ms) */
  debounceMs?: number;
  /** Minimum characters to trigger search (default: 1) */
  minSearchLength?: number;
}

/**
 * Result returned by the useSearch hook
 */
interface UseSearchResult<T> {
  /** Current search query (raw, un-debounced) */
  searchQuery: string;
  /** Debounced search query */
  debouncedQuery: string;
  /** Whether a search is active (query length >= minSearchLength) */
  isSearching: boolean;
  /** Whether debounce is pending (user is still typing) */
  isDebouncing: boolean;
  /** Filtered items based on debounced query */
  filteredItems: T[];
  /** Handler to update search query */
  onSearchChange: (query: string) => void;
  /** Handler to clear search */
  onClearSearch: () => void;
}

/**
 * Custom hook for debounced search functionality
 *
 * Based on React Native best practices skill pattern for search optimization.
 * Uses uncontrolled input pattern for better responsiveness.
 *
 * @example
 * ```tsx
 * const { filteredItems, onSearchChange, isSearching } = useSearch({
 *   items: contacts,
 *   getSearchableText: (contact) => [contact.name, contact.email],
 *   debounceMs: 300,
 * });
 * ```
 */
export function useSearch<T>({
  items,
  getSearchableText,
  debounceMs = 300,
  minSearchLength = 1,
}: UseSearchOptions<T>): UseSearchResult<T> {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isDebouncing, setIsDebouncing] = useState(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle search change with debounce
  const onSearchChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      setIsDebouncing(true);

      // Clear existing timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      // Set new debounce timeout
      debounceTimeoutRef.current = setTimeout(() => {
        setDebouncedQuery(query);
        setIsDebouncing(false);
      }, debounceMs);
    },
    [debounceMs]
  );

  // Clear search
  const onClearSearch = useCallback(() => {
    setSearchQuery('');
    setDebouncedQuery('');
    setIsDebouncing(false);

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Compute if searching is active
  const isSearching = searchQuery.trim().length >= minSearchLength;

  // Memoized filtered items
  const filteredItems = useMemo(() => {
    if (debouncedQuery.trim().length < minSearchLength) {
      return items;
    }

    const normalizedQuery = debouncedQuery.toLowerCase().trim();

    return items.filter((item) => {
      const searchableText = getSearchableText(item);
      const textsToSearch = Array.isArray(searchableText) ? searchableText : [searchableText];

      return textsToSearch.some((text) => text && text.toLowerCase().includes(normalizedQuery));
    });
  }, [items, debouncedQuery, minSearchLength, getSearchableText]);

  return {
    searchQuery,
    debouncedQuery,
    isSearching,
    isDebouncing,
    filteredItems,
    onSearchChange,
    onClearSearch,
  };
}

/**
 * Hook for simple debounced value
 * Useful when you only need debouncing without the full search functionality
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
