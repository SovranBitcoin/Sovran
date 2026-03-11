import React, { useState, useCallback } from 'react';
import { View, FlatList, Text, StyleSheet } from 'react-native';
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

  // Show people search results when searching with a query
  const showSearchResults = isSearching && searchQuery.trim().length > 0;

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
        {showSearchResults ? (
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
