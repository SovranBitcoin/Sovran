import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useMintManagement } from '@/features/mint';
import { useRecentContacts } from '@/features/payments/hooks/useRecentContacts';
import { useMintContacts } from '@/features/payments/hooks/useMintContacts';
import { prefetchImages } from '@/shared/lib/imageCache';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { Screen, log, useLifecycleLogger } from '@/shared/lib/logger';
import { ScreenContainer } from '../components/ScreenContainer';
import { ContactListItem } from '../components/ContactListItem';
import { SearchFilters } from '../components/search/SearchFilters';
import { SEARCH_FILTERS_HEIGHT } from '../lib/constants/styles';
import { SearchResultsList } from '@/shared/ui/composed/SearchResultsList';

export const ContactsScreen = () => {
  useLifecycleLogger('ContactsScreen');
  const { isSearching, searchQuery } = useSearchContext();
  const [activeFilter, setActiveFilter] = useState('All');
  const [foreground, surface, separator] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
  ] as const);

  useEffect(() => {
    if (!isSearching) setActiveFilter('All');
  }, [isSearching]);

  const { keys: nostrKeys } = useNostrKeysContext();
  const { mints, getMintInfo } = useMintManagement();

  const { displayContacts, contactPubkeys, dmEvents } = useRecentContacts(nostrKeys);
  const { displayMints, mintPubkeys, mintInfoLoading } = useMintContacts(
    nostrKeys,
    mints,
    getMintInfo,
    dmEvents
  );

  const profileFilters = useMemo(() => {
    const allPubkeys = [...new Set([...contactPubkeys, ...mintPubkeys])];
    if (allPubkeys.length === 0) return null;
    return [{ kinds: [0], authors: allPubkeys }];
  }, [contactPubkeys, mintPubkeys]);

  const { events: profileEvents } = useSubscribe({ filters: profileFilters });

  const profilesMap = useMemo(() => {
    const t0 = performance.now();
    const map = new Map<string, any>();
    profileEvents?.forEach((event) => {
      try {
        map.set(event.pubkey, JSON.parse(event.content));
      } catch {
        // Skip invalid profile JSON
      }
    });
    const duration = Math.round((performance.now() - t0) * 100) / 100;
    if (duration > 20) {
      log.warn('contacts.profiles_parse.slow', { duration_ms: duration, count: map.size });
    }
    return map;
  }, [profileEvents]);

  useEffect(() => {
    prefetchImages(Array.from(profilesMap.values()).map((p: any) => p?.picture));
  }, [profilesMap]);

  const currentListData = useMemo(() => {
    switch (activeFilter) {
      case 'Recent':
        return displayContacts;
      case 'Mints':
        return displayMints;
      default: {
        // Mints take priority over contacts with the same pubkey
        // (e.g. Sovran's nostr pubkey appears in both lists)
        const byKey = new Map<string, any>();
        for (const item of displayContacts) {
          const key = item.pubkey || item.mint?.mintUrl;
          if (key) byKey.set(key, item);
        }
        for (const item of displayMints) {
          const key = item.pubkey || item.mint?.mintUrl;
          if (key) byKey.set(key, item);
        }
        return Array.from(byKey.values());
      }
    }
  }, [activeFilter, displayContacts, displayMints]);

  const handleFilterChange = useCallback((filter: string) => {
    log.debug('contacts.filter_changed', { filter });
    setActiveFilter(filter);
  }, []);

  const renderContactItem = useCallback(
    ({ item }: { item: any }) => {
      const profile = item.pubkey ? profilesMap.get(item.pubkey) : undefined;
      const lastMessage = item.dmEvent?.content;
      const isLoadingProfile = item.pubkey !== undefined && profile === undefined;
      return (
        <ContactListItem
          pubkey={item.pubkey}
          profile={profile}
          subtitle={lastMessage}
          type={item.type}
          mintInfo={item.mintInfo}
          mintUrl={item.mint?.mintUrl}
          isLoadingProfile={isLoadingProfile}
        />
      );
    },
    [profilesMap]
  );

  const renderEmpty = useCallback(() => {
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
  }, [foreground, activeFilter, mintInfoLoading]);

  const showSearchResults = isSearching && searchQuery.trim().length > 0 && activeFilter === 'All';

  return (
    <Screen name="ContactsScreen" style={styles.root}>
      {isSearching && (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={[
            styles.filtersRow,
            {
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
          <SearchResultsList searchQuery={searchQuery} />
        ) : (
          <LegendList
            data={currentListData}
            extraData={profilesMap.size}
            estimatedItemSize={68}
            keyExtractor={(item, index) => item.pubkey || item.mint?.mintUrl || `contact-${index}`}
            renderItem={renderContactItem}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="always"
            ListEmptyComponent={renderEmpty}
            contentContainerStyle={currentListData.length === 0 ? styles.emptyList : undefined}
          />
        )}
      </ScreenContainer>
    </Screen>
  );
};

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
