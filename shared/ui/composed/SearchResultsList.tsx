import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list';
import { useContactSearch, type DisplayResult } from '@/features/payments/hooks/useContactSearch';
import { ContactListItem } from '@/features/contacts/components/ContactListItem';
import { NoResultsFound } from '@/features/payments/components/NoResultsFound';

type SearchResultsListProps = {
  searchQuery: string;
  ListEmptyComponent?: React.ComponentType;
};

const keyExtractor = (item: DisplayResult) => item.pubkey;

export function SearchResultsList({
  searchQuery,
  ListEmptyComponent = NoResultsFound,
}: SearchResultsListProps) {
  const { displayResults, searchLoading, hasSearched, showNoResults } =
    useContactSearch(searchQuery);

  const renderItem = useCallback(
    ({ item }: { item: DisplayResult }) => (
      <ContactListItem
        pubkey={item.pubkey}
        profile={item.profile}
        isLoadingProfile={searchLoading || !hasSearched || !item.profile}
      />
    ),
    [searchLoading, hasSearched]
  );

  const renderEmpty = useCallback(() => {
    if (showNoResults) return <ListEmptyComponent />;
    return null;
  }, [showNoResults, ListEmptyComponent]);

  return (
    <View style={styles.container}>
      <LegendList
        data={showNoResults ? [] : displayResults}
        estimatedItemSize={68}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="always"
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={showNoResults ? styles.emptyList : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyList: { flexGrow: 1 },
});
