import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import FilterItem from './SearchFilterItem';
import { SEARCH_FILTERS_HEIGHT } from '../../lib/constants/styles';
import { Log } from '@/shared/lib/logger';

const BASE_FILTERS = ['All', 'Recent', 'Mints'] as const;
const SEARCH_FILTERS = ['All', 'Recent', 'Mints', 'Groups'] as const;

type SearchFiltersProps = {
  onFilterChange?: (filter: string) => void;
  /**
   * When true, include the `Groups` pill at the end. Groups is only a
   * meaningful scope during an active search — outside of that it lives
   * as the outer Contacts/Groups tab.
   */
  showGroups?: boolean;
};

export const SearchFilters = ({ onFilterChange, showGroups = false }: SearchFiltersProps) => {
  const [activeFilterItem, setActiveFilterItem] = useState<string>('All');
  const flatListRef = useRef<FlatList<string>>(null);

  const filters = useMemo<readonly string[]>(
    () => (showGroups ? SEARCH_FILTERS : BASE_FILTERS),
    [showGroups]
  );

  // If Groups pill was active and then disappears (search closed), fall back
  // to All internally so the active highlight doesn't point at a hidden pill.
  // Deliberately do NOT call `onFilterChange` here — the parent watches for
  // the last-active filter to drive "close-search-on-Groups-pill → switch to
  // Groups tab" behaviour, and firing a reset here would clobber that.
  useEffect(() => {
    if (!showGroups && activeFilterItem === 'Groups') {
      setActiveFilterItem('All');
    }
  }, [showGroups, activeFilterItem]);

  const handleFilterChange = (filter: string) => {
    setActiveFilterItem(filter);
    onFilterChange?.(filter);
  };

  return (
    <Log name="SearchFilters">
      <View style={styles.container}>
        <FlatList
          ref={flatListRef}
          data={filters as unknown as string[]}
          keyExtractor={(item) => item}
          renderItem={({ item, index }) => (
            <FilterItem
              item={item}
              index={index}
              flatListRef={flatListRef}
              activeFilterItem={activeFilterItem}
              setActiveFilterItem={handleFilterChange}
            />
          )}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    </Log>
  );
};

const styles = StyleSheet.create({
  container: {
    height: SEARCH_FILTERS_HEIGHT,
    marginHorizontal: -20,
  },
  content: {
    gap: 4,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
});
