import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useMintManagement } from '@/features/mint';
import { useRecentContacts } from '@/features/payments/hooks/useRecentContacts';
import { useMintContacts } from '@/features/payments/hooks/useMintContacts';
import { useContactSearch, type DisplayResult } from '@/features/payments/hooks/useContactSearch';
import { prefetchImages } from '@/shared/lib/imageCache';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { useContactsSearch } from '@/app/(drawer)/(tabs)/contacts/_layout';
import { ScreenContainer } from '../components/ScreenContainer';
import { ContactListItem } from '../components/ContactListItem';
import { ContactSearchResultItem } from '../components/ContactSearchResultItem';
import { SearchFilters } from '../components/search/SearchFilters';
import { NoResultsFound } from '@/features/payments/components/NoResultsFound';
import { SEARCH_FILTERS_HEIGHT } from '../lib/constants/styles';
import { HEADER_SPRING_CONFIG } from '../lib/constants/animation-configs';

export const ContactsScreen = () => {
  const { isSearching, searchQuery } = useContactsSearch();
  const [activeFilter, setActiveFilter] = useState('All');
  const [foreground, surface, separator] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
  ] as const);

  // Reset filter when leaving search
  useEffect(() => {
    if (!isSearching) {
      setActiveFilter('All');
    }
  }, [isSearching]);

  const { keys: nostrKeys } = useNostrKeysContext();
  const { mints, getMintInfo } = useMintManagement();

  // Real data hooks (same as payments)
  const { displayContacts, contactPubkeys, dmEvents } = useRecentContacts(nostrKeys);
  const { displayMints, mintPubkeys, mintInfoLoading } = useMintContacts(
    nostrKeys,
    mints,
    getMintInfo,
    dmEvents
  );
  const { displayResults, searchLoading, hasSearched, showNoResults, handleSearchResultPress } =
    useContactSearch(searchQuery);

  // Profile subscription for avatars/names
  const profileFilters = useMemo(() => {
    const allPubkeys = [...new Set([...contactPubkeys, ...mintPubkeys])];
    if (allPubkeys.length === 0) return null;
    return [{ kinds: [0], authors: allPubkeys }];
  }, [contactPubkeys, mintPubkeys]);

  const { events: profileEvents } = useSubscribe({
    filters: profileFilters,
  });

  const profilesMap = useMemo(() => {
    const map = new Map<string, any>();
    profileEvents?.forEach((event) => {
      try {
        map.set(event.pubkey, JSON.parse(event.content));
      } catch {
        // Skip invalid profile JSON
      }
    });
    return map;
  }, [profileEvents]);

  useEffect(() => {
    prefetchImages(Array.from(profilesMap.values()).map((p: any) => p?.picture));
  }, [profilesMap]);

  // Determine which list to show based on active filter
  const currentListData = useMemo(() => {
    switch (activeFilter) {
      case 'Recent':
        return displayContacts;
      case 'Mints':
        return displayMints;
      default:
        // "All" — merge recent + mints, deduplicated by pubkey
        const seen = new Set<string>();
        const merged: any[] = [];
        for (const item of [...displayContacts, ...displayMints]) {
          if (item.pubkey && !seen.has(item.pubkey)) {
            seen.add(item.pubkey);
            merged.push(item);
          }
        }
        return merged;
    }
  }, [activeFilter, displayContacts, displayMints]);

  const handleFilterChange = useCallback((filter: string) => {
    setActiveFilter(filter);
  }, []);

  // Render a contact/mint item from the real data
  const renderContactItem = useCallback(
    ({ item }: { item: any }) => {
      const profile = item.pubkey ? profilesMap.get(item.pubkey) : undefined;
      const lastMessage = item.dmEvent?.content;

      return (
        <ContactListItem
          pubkey={item.pubkey}
          profile={profile}
          subtitle={lastMessage}
          type={item.type}
          mintInfo={item.mintInfo}
        />
      );
    },
    [profilesMap]
  );

  // Render a search result item
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

  const renderEmpty = useCallback(() => {
    if (isSearching && showNoResults) {
      return <NoResultsFound />;
    }

    if (activeFilter === 'Mints' && mintInfoLoading) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: opacity(foreground, 0.4) }]}>
            Loading mints...
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Feather name="users" size={30} color={opacity(foreground, 0.3)} />
        <Text style={[styles.emptyText, { color: opacity(foreground, 0.4) }]}>
          {activeFilter === 'Mints'
            ? 'No mints with nostr contacts found'
            : 'No recent contacts yet'}
        </Text>
      </View>
    );
  }, [isSearching, showNoResults, foreground, activeFilter, mintInfoLoading]);

  // Show API search results only when there's a typed query and "All" filter is active
  const showSearchResults = isSearching && searchQuery.trim().length > 0 && activeFilter === 'All';

  // Animated spacer — pushes ScreenContainer down when filters strip appears
  const rTopStyle = useAnimatedStyle(() => ({
    height: withSpring(isSearching ? SEARCH_FILTERS_HEIGHT : 0, HEADER_SPRING_CONFIG),
  }));

  return (
    <View style={styles.root}>
      {/* Spacer that animates to push content below the transparent header + filters */}
      <Animated.View style={rTopStyle} />

      {/* Filters strip — floats above ScreenContainer, fades in/out */}
      {isSearching && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={[
            styles.filtersRow,
            {
              top: 0,
              backgroundColor: surface,
              paddingHorizontal: 20,
              borderBottomWidth: 0.5,
              borderBottomColor: separator,
            },
          ]}>
          <SearchFilters onFilterChange={handleFilterChange} />
        </Animated.View>
      )}

      <ScreenContainer>
        {showSearchResults ? (
          <FlatList
            data={showNoResults ? [] : displayResults}
            keyExtractor={(item) => item.pubkey}
            renderItem={renderSearchResult}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={renderEmpty}
            contentContainerStyle={showNoResults ? styles.emptyList : undefined}
          />
        ) : (
          <FlatList
            data={currentListData}
            keyExtractor={(item) => item.pubkey || item.mint?.mintUrl || Math.random().toString()}
            renderItem={renderContactItem}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={renderEmpty}
            contentContainerStyle={currentListData.length === 0 ? styles.emptyList : undefined}
          />
        )}
      </ScreenContainer>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  filtersRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
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
