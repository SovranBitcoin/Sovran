import React, { useMemo, useRef, useState } from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import FilterItem from '@/features/contacts/components/search/SearchFilterItem';
import { SEARCH_FILTERS_HEIGHT } from '@/features/contacts/lib/constants/styles';
import { PRIMAL_FEED_SPECS, categoryToLabel } from './HomeFeed';
import { CATEGORY_PUBKEYS } from './nostr/categoryNpubs';
import { feedLog, Log } from '@/shared/lib/logger';

const SEARCH_FILTERS = ['People'] as const;

type FeedFiltersProps = {
  isSearching: boolean;
  onFilterChange?: (filter: string) => void;
};

export const FeedFilters = ({ isSearching, onFilterChange }: FeedFiltersProps) => {
  const feedFilters = useMemo(() => {
    const primalNames = PRIMAL_FEED_SPECS.map((s) => s.name);
    const categoryNames = Object.keys(CATEGORY_PUBKEYS).map(categoryToLabel);
    return [...primalNames];
  }, []);

  const filters = isSearching ? (SEARCH_FILTERS as unknown as string[]) : feedFilters;
  const [activeFilterItem, setActiveFilterItem] = useState<string>(filters[0]);
  const flatListRef = useRef<FlatList<string>>(null);

  // Reset to first filter when switching modes
  const prevIsSearching = useRef(isSearching);
  if (prevIsSearching.current !== isSearching) {
    prevIsSearching.current = isSearching;
    const defaultFilter = filters[0];
    setActiveFilterItem(defaultFilter);
    onFilterChange?.(defaultFilter);
  }

  const handleFilterChange = (filter: string) => {
    feedLog.info('feed.filter.change', { filter, isSearching });
    setActiveFilterItem(filter);
    onFilterChange?.(filter);
  };

  return (
    <Log name="FeedFilters">
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
