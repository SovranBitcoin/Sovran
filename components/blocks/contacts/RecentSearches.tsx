import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { View } from 'components/ui/View/View';
import { HStack } from 'components/ui/View/HStack';
import { Text } from 'components/ui/Text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from 'providers/ThemeProvider';
import { useSearchHistoryStore, SearchHistoryEntry } from '@/stores/searchHistoryStore';

interface RecentSearchesProps {
  /** Context for grouping searches (e.g., 'payments', 'mints') */
  context?: string;
  /** Callback when a recent search is selected */
  onSearchSelect: (query: string) => void;
  /** Maximum number of items to show */
  maxItems?: number;
}

/**
 * Displays recent search suggestions
 *
 * Shows the user's search history with the ability to:
 * - Tap to apply a previous search
 * - Swipe/tap X to remove individual items
 * - Clear all recent searches
 */
export const RecentSearches = React.memo(function RecentSearches({
  context = 'default',
  onSearchSelect,
  maxItems = 5,
}: RecentSearchesProps) {
  const { getPrimaryColor } = useTheme();
  const { getRecentSearches, removeSearch, clearSearches } = useSearchHistoryStore();

  const recentSearches = useMemo(() => {
    return getRecentSearches(context).slice(0, maxItems);
  }, [getRecentSearches, context, maxItems]);

  const handleSearchSelect = useCallback(
    (entry: SearchHistoryEntry) => {
      onSearchSelect(entry.query);
    },
    [onSearchSelect]
  );

  const handleRemoveSearch = useCallback(
    (query: string) => {
      removeSearch(query, context);
    },
    [removeSearch, context]
  );

  const handleClearAll = useCallback(() => {
    clearSearches(context);
  }, [clearSearches, context]);

  if (recentSearches.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <HStack align="center" justify="space-between" style={styles.header}>
        <Text
          style={[styles.headerText, { color: getPrimaryColor('400') }]}
          overpass
          bold
          size={14}>
          Recent searches
        </Text>
        <Pressable onPress={handleClearAll} hitSlop={8}>
          <Text style={[styles.clearText, { color: getPrimaryColor('500') }]} size={12}>
            Clear all
          </Text>
        </Pressable>
      </HStack>

      {recentSearches.map((entry) => (
        <Pressable
          key={`${entry.query}-${entry.timestamp}`}
          style={({ pressed }) => [
            styles.searchItem,
            { backgroundColor: pressed ? getPrimaryColor('800') : 'transparent' },
          ]}
          onPress={() => handleSearchSelect(entry)}>
          <HStack align="center" justify="space-between" style={styles.searchItemContent}>
            <HStack align="center" style={styles.searchTextRow}>
              <IconSymbol
                name="clock.arrow.circlepath"
                size={16}
                color={getPrimaryColor('500')}
                style={styles.clockIcon}
              />
              <Text
                style={[styles.searchText, { color: getPrimaryColor('200') }]}
                numberOfLines={1}>
                {entry.query}
              </Text>
            </HStack>
            <Pressable
              onPress={() => handleRemoveSearch(entry.query)}
              hitSlop={8}
              style={styles.removeButton}>
              <IconSymbol name="xmark" size={14} color={getPrimaryColor('500')} />
            </Pressable>
          </HStack>
        </Pressable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  header: {
    marginBottom: 8,
  },
  headerText: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  clearText: {
    fontFamily: 'OverpassRegular',
  },
  searchItem: {
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginVertical: 2,
  },
  searchItemContent: {
    flex: 1,
  },
  searchTextRow: {
    flex: 1,
    marginRight: 8,
  },
  clockIcon: {
    marginRight: 10,
  },
  searchText: {
    fontFamily: 'OverpassRegular',
    fontSize: 15,
    flex: 1,
  },
  removeButton: {
    padding: 4,
  },
});
