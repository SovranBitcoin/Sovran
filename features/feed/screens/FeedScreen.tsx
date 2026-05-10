import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { ScreenContainer } from '@/features/contacts/components/ScreenContainer';
import FilterItem from '@/features/contacts/components/search/SearchFilterItem';
import { HomeFeed, PRIMAL_FEED_SPECS, categoryToLabel } from '@/features/feed/components/HomeFeed';
import { CATEGORY_PUBKEYS } from '@/features/feed/components/nostr/categoryNpubs';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import Icon from '@/assets/icons';
import { Log, feedLog, useLifecycleLogger } from '@/shared/lib/logger';
import { SearchResultsList } from '@/shared/ui/composed/SearchResultsList';

const SEARCH_FILTERS_HEIGHT = 56;
const SEARCH_FILTERS = ['People'] as const;

type FeedFiltersProps = {
  isSearching: boolean;
  onFilterChange?: (filter: string) => void;
};

function FeedFilters({ isSearching, onFilterChange }: FeedFiltersProps) {
  const feedFilters = useMemo(() => {
    const primalNames = PRIMAL_FEED_SPECS.map((s) => s.name);
    const categoryNames = Object.keys(CATEGORY_PUBKEYS).map(categoryToLabel);
    return [...primalNames];
  }, []);

  const filters = isSearching ? (SEARCH_FILTERS as unknown as string[]) : feedFilters;
  const [activeFilterItem, setActiveFilterItem] = useState<string>(filters[0]);
  const flatListRef = useRef<FlatList<string>>(null);

  useEffect(() => {
    const defaultFilter = filters[0];
    setActiveFilterItem(defaultFilter);
    onFilterChange?.(defaultFilter);
  }, [isSearching]);

  const handleFilterChange = (filter: string) => {
    feedLog.info('feed.filter.change', { filter, isSearching });
    setActiveFilterItem(filter);
    onFilterChange?.(filter);
  };

  return (
    <Log name="FeedFilters">
      <View style={filtersInnerStyles.container}>
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
          contentContainerStyle={filtersInnerStyles.content}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    </Log>
  );
}

const filtersInnerStyles = StyleSheet.create({
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

export function FeedScreen() {
  useLifecycleLogger('FeedScreen', feedLog);

  const { isSearching, searchQuery } = useSearchContext();
  const [activeFilter, setActiveFilter] = useState('Trending');
  const [foreground, surface, separator] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
  ] as const);

  const handleFilterChange = useCallback((filter: string) => {
    feedLog.info('feed.filter.change', { filter });
    setActiveFilter(filter);
  }, []);

  const hasSearchQuery = searchQuery.trim().length > 0;
  const showSearchResults = isSearching && hasSearchQuery;
  const showSearchPrompt = isSearching && !hasSearchQuery;

  return (
    <Log name="FeedScreen" style={[styles.root, { backgroundColor: surface }]}>
      <View
        style={[
          styles.filtersRow,
          {
            backgroundColor: surface,
            paddingHorizontal: 20,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: separator,
          },
        ]}>
        <FeedFilters isSearching={isSearching} onFilterChange={handleFilterChange} />
      </View>

      <ScreenContainer>
        {/* HomeFeed stays mounted to preserve scroll position and cached data */}
        <View style={[styles.flex1, isSearching && styles.hidden]}>
          <HomeFeed activeFilter={activeFilter} />
        </View>

        {showSearchResults && <SearchResultsList searchQuery={searchQuery} />}
        {showSearchPrompt && (
          <VStack spacing={24} align="center" className="mt-3 px-4" style={styles.flex1}>
            <VStack
              justify="center"
              align="center"
              className="bg-surface-secondary h-20 w-20 rounded-full">
              <Icon name="mingcute:search-3-line" size={40} color={opacity(foreground, 0.4)} />
            </VStack>
            <VStack spacing={12}>
              <Text className="text-center" color={opacity(foreground, 0.5)} bold size={20}>
                Search for someone by name
              </Text>
              <Text className="text-center" color={opacity(foreground, 0.4)} size={16}>
                Enter a name, NIP-05, or npub to find people
              </Text>
            </VStack>
          </VStack>
        )}
      </ScreenContainer>
    </Log>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  filtersRow: {
    height: SEARCH_FILTERS_HEIGHT,
  },
  flex1: {
    flex: 1,
  },
  hidden: {
    display: 'none' as const,
  },
});
