/**
 * @fileoverview Unified "All" search-results feed.
 *
 * Renders a heterogeneous list of contact / geohash / tier results from
 * `useAllSearchResults` through a single dispatcher row. Every variant
 * ultimately renders via `ListRow` so the feed looks consistent regardless
 * of what type of result a given row represents.
 *
 * The geohash jump card (previously a hand-styled pressable in
 * ContactsScreen) is now just a `ListRow` with an accent-tinted icon
 * circle — no more one-off card styling.
 */

import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list';
import { router } from 'expo-router';
import opacity from 'hex-color-opacity';

import {
  useAllSearchResults,
  type AllSearchResult,
} from '@/features/contacts/hooks/useAllSearchResults';
import { ContactListItem } from '@/features/contacts/components/ContactListItem';
import { LocationTierItem } from '@/features/contacts/components/LocationTierItem';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { NoResultsFound } from '@/features/payments/components/NoResultsFound';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';

type SearchResultsListProps = {
  searchQuery: string;
  ListEmptyComponent?: React.ComponentType;
};

const keyExtractor = (item: AllSearchResult) => item.id;

function GeohashJumpRow({ geohash }: { geohash: string }) {
  const [foreground, accent] = useThemeColor(['foreground', 'accent'] as const);
  return (
    <ListRow
      iconCircle={{
        icon: 'mdi:pound',
        color: accent,
        size: 44,
        backgroundColor: opacity(accent, 0.12),
      }}
      title={`Go to #${geohash}`}
      subtitle="Open geohash chat channel"
      trailing={
        <Icon name="mdi:arrow-right" size={18} color={opacity(foreground, 0.35)} />
      }
      onPress={() => {
        router.push({
          pathname: '/(user-flow)/geohashChat',
          params: { geohash },
        } as any);
      }}
    />
  );
}

export function SearchResultsList({
  searchQuery,
  ListEmptyComponent = NoResultsFound,
}: SearchResultsListProps) {
  const { results, loading } = useAllSearchResults(searchQuery);

  const showNoResults = useMemo(() => {
    const trimmed = searchQuery.trim();
    // Mirror useContactSearch's internal rule: <2 chars doesn't trigger a
    // real search, so don't flash "no results" at the user.
    if (trimmed.length < 2) return false;
    if (loading) return false;
    return results.length === 0;
  }, [results.length, loading, searchQuery]);

  const renderItem = useCallback(({ item }: { item: AllSearchResult }) => {
    switch (item.type) {
      case 'geohash':
        return <GeohashJumpRow geohash={item.geohash} />;
      case 'tier':
        return <LocationTierItem tier={item.tier} />;
      case 'contact':
        return (
          <ContactListItem
            pubkey={item.pubkey}
            profile={item.profile}
            isLoadingProfile={item.isLoadingProfile}
          />
        );
    }
  }, []);

  const renderEmpty = useCallback(() => {
    if (showNoResults) return <ListEmptyComponent />;
    return null;
  }, [showNoResults, ListEmptyComponent]);

  return (
    <View style={styles.container}>
      <LegendList
        data={showNoResults ? [] : results}
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
