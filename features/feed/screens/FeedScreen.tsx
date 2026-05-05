import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { ScreenContainer } from '@/features/contacts/components/ScreenContainer';
import { FeedFilters, SEARCH_FILTERS_HEIGHT } from '../components/FeedFilters';
import { HomeFeed } from '@/features/feed/components/HomeFeed';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import Icon from '@/assets/icons';
import { Log, feedLog, useLifecycleLogger } from '@/shared/lib/logger';
import { SearchResultsList } from '@/shared/ui/composed/SearchResultsList';

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
    <Log name="FeedScreen" style={styles.root}>
      <View
        style={[
          styles.filtersRow,
          {
            backgroundColor: surface,
            paddingHorizontal: 20,
            borderBottomWidth: 0.5,
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
