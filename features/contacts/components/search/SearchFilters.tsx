import React, { useRef } from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import FilterItem from './SearchFilterItem';
import { Log } from '@/shared/lib/logger';

export const SEARCH_FILTERS_HEIGHT = 56;

export type ContactsFilter = 'All' | 'Recent' | 'Requests' | 'Mints' | 'Groups';

const BASE_FILTERS: readonly ContactsFilter[] = ['All', 'Recent', 'Requests', 'Mints'];

type SearchFiltersProps = {
  activeFilter: ContactsFilter;
  onFilterChange: (filter: ContactsFilter) => void;
  /**
   * Filters to display, in order. Defaults to the base set.
   * The parent owns visibility rules — during search it can narrow this
   * list to only pills that have matches for the current query.
   */
  filters?: readonly ContactsFilter[];
  /**
   * Extra pills rendered inline at the end of the same scrollable row.
   */
  trailing?: React.ReactElement | null;
};

export const SearchFilters = ({
  activeFilter,
  onFilterChange,
  filters = BASE_FILTERS,
  trailing = null,
}: SearchFiltersProps) => {
  const flatListRef = useRef<FlatList<ContactsFilter>>(null);

  return (
    <Log name="SearchFilters">
      <View style={styles.container}>
        <FlatList
          ref={flatListRef}
          data={filters}
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
          ListFooterComponent={trailing}
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
