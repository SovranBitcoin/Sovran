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

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useTabBarBottomPadding } from '@/shared/hooks/useTabBarBottomPadding';
import {
  useAllSearchResults,
  type AllSearchResult,
} from '@/features/contacts/hooks/useAllSearchResults';
import { ContactRow, geohashIdentity, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { navigateToContact } from '@/features/contacts/lib/navigateToProfile';
import { NoResultsFound } from '@/features/payments/components/NoResultsFound';
import { CONTACT_SEARCH_MIN_LENGTH } from '@/features/payments/hooks/useContactSearch';
import type { TierEntry } from '@/features/bitchat/hooks/useLocationTiers';

type SearchResultsListProps = {
  searchQuery: string;
  ListEmptyComponent?: React.ComponentType;
};

const keyExtractor = (item: AllSearchResult) => item.id;

function GeohashJumpRow({ geohash }: { geohash: string }) {
  return (
    <ContactRow
      identity={geohashIdentity(geohash, {
        label: `Go to #${geohash}`,
        transport: 'geohash',
        icon: 'mdi:pound',
      })}
      subtitle="Open geohash chat channel"
      trailingVariant="chevron"
      onPress={() => {
        router.push({
          pathname: '/(user-flow)/geohashChat',
          params: { geohash },
        } as any);
      }}
      testID={`contact-row:geohash:${geohash}`}
    />
  );
}

function TierRow({ tier }: { tier: TierEntry }) {
  return (
    <ContactRow
      identity={geohashIdentity(tier.geohash, {
        label: tier.label,
        displayName: tier.displayName,
        transport: tier.transport,
        icon: tier.icon,
      })}
      trailingVariant="chevron"
      onPress={() => {
        router.push({
          pathname: '/(user-flow)/geohashChat',
          params: {
            geohash: tier.geohash,
            tierLabel: tier.label,
            transport: tier.transport,
          },
        } as any);
      }}
      testID={`contact-row:geohash:${tier.geohash}`}
    />
  );
}

export function SearchResultsList({
  searchQuery,
  ListEmptyComponent = NoResultsFound,
}: SearchResultsListProps) {
  const { results, loading } = useAllSearchResults(searchQuery);
  const tabBarPadding = useTabBarBottomPadding();

  const showNoResults = useMemo(() => {
    const trimmed = searchQuery.trim();
    // Mirror useContactSearch's internal rule: short queries don't trigger
    // a real search, so don't flash "no results" at the user.
    if (trimmed.length < CONTACT_SEARCH_MIN_LENGTH) return false;
    if (loading) return false;
    return results.length === 0;
  }, [results.length, loading, searchQuery]);

  const renderItem = useCallback(({ item }: { item: AllSearchResult }) => {
    switch (item.type) {
      case 'geohash':
        return <GeohashJumpRow geohash={item.geohash} />;
      case 'tier':
        return <TierRow tier={item.tier} />;
      case 'contact':
        return (
          <ContactRow
            identity={nostrIdentity(item.pubkey, item.profile, {
              isLoadingProfile: item.isLoadingProfile,
            })}
            onPress={() => navigateToContact(item.pubkey)}
            testID={`contact-row:nostr:${item.pubkey}`}
          />
        );
    }
  }, []);

  const renderEmpty = useCallback(() => {
    if (showNoResults) return <ListEmptyComponent />;
    return null;
  }, [showNoResults, ListEmptyComponent]);

  // While the Nostr search is in flight and we have nothing yet, render
  // skeleton placeholder rows so the feed doesn't look empty. `ContactRow`
  // treats `isLoadingProfile: true` as the skeleton trigger, so we reuse
  // the regular render path instead of a parallel loader component.
  const showPlaceholders = loading && results.length === 0 && searchQuery.trim().length >= 2;
  const placeholderData = useMemo<AllSearchResult[]>(
    () =>
      Array.from({ length: 4 }, (_, i) => ({
        type: 'contact' as const,
        id: `placeholder-${i}`,
        pubkey: `placeholder-${i}`,
        profile: undefined,
        isLoadingProfile: true,
        score: 0,
      })),
    []
  );

  return (
    <View style={styles.container}>
      <LegendList
        data={showPlaceholders ? placeholderData : showNoResults ? [] : results}
        estimatedItemSize={68}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="always"
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={
          showNoResults
            ? [styles.emptyList, { paddingBottom: tabBarPadding }]
            : { paddingBottom: tabBarPadding }
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyList: { flexGrow: 1 },
});
