import React, { useState, useCallback } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useContactSearch, type DisplayResult } from '@/features/payments/hooks/useContactSearch';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { useFeedSearch } from '@/app/(drawer)/(tabs)/feed/_layout';
import { ScreenContainer } from '@/features/contacts/components/ScreenContainer';
import { ContactSearchResultItem } from '@/features/contacts/components/ContactSearchResultItem';
import { FeedFilters } from '../components/FeedFilters';
import { NoResultsFound } from '@/features/payments/components/NoResultsFound';
import { SEARCH_FILTERS_HEIGHT } from '@/features/contacts/lib/constants/styles';
import { HomeFeed } from '@/features/feed/components/HomeFeed';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import Icon from '@/assets/icons';

export function FeedScreen() {
  const { isSearching, searchQuery } = useFeedSearch();
  const [activeFilter, setActiveFilter] = useState('Trending');
  const [foreground, surface, separator] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
  ] as const);

  const { displayResults, searchLoading, hasSearched, showNoResults, handleSearchResultPress } =
    useContactSearch(searchQuery);

  const handleFilterChange = useCallback((filter: string) => {
    setActiveFilter(filter);
  }, []);

  // Render a search result item (people)
  const renderSearchResult = useCallback(
    ({ item }: { item: DisplayResult }) => (
      <ContactSearchResultItem
        result={item}
        loading={searchLoading || !hasSearched}
        onPress={handleSearchResultPress}
      />
    ),
    [searchLoading, hasSearched, handleSearchResultPress]
  );

  const renderSearchEmpty = useCallback(() => {
    if (showNoResults) {
      return <NoResultsFound />;
    }
    return null;
  }, [showNoResults]);

  const renderFeedEmpty = useCallback(() => {
    return (
      <View style={styles.emptyContainer}>
        <Feather name="rss" size={30} color={opacity(foreground, 0.3)} />
        <Text style={[styles.emptyText, { color: opacity(foreground, 0.4) }]}>
          No posts yet
        </Text>
      </View>
    );
  }, [foreground]);

  // When search is active with empty query, show prompt instead of feed
  const renderSearchPrompt = useCallback(() => {
    return (
      <VStack spacing={24} align="center" className="mt-3 px-4">
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
    );
  }, [foreground]);

  const hasSearchQuery = searchQuery.trim().length > 0;
  const showSearchUI = isSearching;

  return (
    <View style={styles.root}>
      {/* Filters strip — always visible, switches between feed tabs and search tabs */}
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
        {showSearchUI ? (
          hasSearchQuery ? (
            <FlatList
              data={showNoResults ? [] : displayResults}
              keyExtractor={(item) => item.pubkey}
              renderItem={renderSearchResult}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={renderSearchEmpty}
              contentContainerStyle={showNoResults ? styles.emptyList : undefined}
            />
          ) : (
            renderSearchPrompt()
          )
        ) : (
          <HomeFeed activeFilter={activeFilter} />
        )}
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  filtersRow: {
    height: SEARCH_FILTERS_HEIGHT,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 90,
    gap: 16,
  },
  emptyText: {
    fontSize: 17,
  },
  emptyList: {
    flexGrow: 1,
  },
});
