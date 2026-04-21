import React, { useRef } from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import FilterItem from './SearchFilterItem';
import { SEARCH_FILTERS_HEIGHT } from '../../lib/constants/styles';
import { Log } from '@/shared/lib/logger';

export const BASE_FILTERS = ['All', 'Recent', 'Mints'] as const;
export const SEARCH_FILTERS = ['All', 'Recent', 'Mints', 'Groups'] as const;

type SearchFiltersProps = {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  /**
   * Filters to display, in order. Defaults to the base set.
   * The parent owns visibility rules — during search it can narrow this
   * list to only pills that have matches for the current query.
   */
  filters?: readonly string[];
};

export const SearchFilters = ({
  activeFilter,
  onFilterChange,
  filters = BASE_FILTERS,
}: SearchFiltersProps) => {
  const flatListRef = useRef<FlatList<string>>(null);

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
              activeFilterItem={activeFilter}
              setActiveFilterItem={onFilterChange}
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
