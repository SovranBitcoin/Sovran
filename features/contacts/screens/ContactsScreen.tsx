import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list';
import Icon from 'assets/icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { useRouter } from 'expo-router';
import opacity from 'hex-color-opacity';

import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useMintManagement } from '@/features/mint';
import { useRecentContacts } from '@/features/payments/hooks/useRecentContacts';
import { useMintContacts } from '@/features/payments/hooks/useMintContacts';
import { prefetchImages } from '@/shared/lib/imageCache';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { Screen, log, useLifecycleLogger } from '@/shared/lib/logger';
import { SearchResultsList } from '@/shared/ui/composed/SearchResultsList';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { ScreenContainer } from '../components/ScreenContainer';
import { ContactListItem } from '../components/ContactListItem';
import { LocationTierItem } from '../components/LocationTierItem';
import { SearchFilters } from '../components/search/SearchFilters';
import { SEARCH_FILTERS_HEIGHT } from '../lib/constants/styles';
import { useLocationTiers, type TierEntry } from '@/features/bitchat/hooks/useLocationTiers';
import { isValidGeohash } from 'bitchat-module';

type TopTab = 'contacts' | 'groups';

/**
 * Bare geohash detection for the Groups pill header.
 * (All pill's geohash handling lives in `useAllSearchResults` + `SearchResultsList`.)
 */
function parseGeohashQuery(trimmed: string): string | null {
  if (!trimmed) return null;
  const hash = trimmed.startsWith('#')
    ? trimmed.slice(1).toLowerCase()
    : trimmed.toLowerCase();
  if (hash.length < 2) return null;
  if (!isValidGeohash(hash)) return null;
  if (!trimmed.startsWith('#') && /\s/.test(trimmed)) return null;
  return hash;
}

function GeohashJumpRow({ geohash }: { geohash: string }) {
  const router = useRouter();
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

export const ContactsScreen = () => {
  useLifecycleLogger('ContactsScreen');
  const { isSearching, searchQuery } = useSearchContext();
  const [activeTab, setActiveTab] = useState<TopTab>('contacts');
  const [activeFilter, setActiveFilter] = useState('All');
  const lastSearchFilterRef = useRef<string>('All');
  const [foreground, surface, separator, accent] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
    'accent',
  ] as const);
  const { tiers: locationTiers } = useLocationTiers();

  // When the search closes, restore the outer tab. If the user was on the
  // "Groups" pill, surface the groups list they were browsing.
  useEffect(() => {
    if (!isSearching) {
      if (lastSearchFilterRef.current === 'Groups') {
        setActiveTab('groups');
      }
      setActiveFilter('All');
    }
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
    lastSearchFilterRef.current = filter;
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
        <Icon name="mdi:account-group" size={30} color={opacity(foreground, 0.3)} />
        <Text style={[styles.emptyText, { color: opacity(foreground, 0.4) }]}>
          {activeFilter === 'Mints'
            ? 'No mints with nostr contacts found'
            : 'No recent contacts yet'}
        </Text>
      </View>
    );
  }, [foreground, activeFilter, mintInfoLoading]);

  const trimmedQuery = searchQuery.trim();
  const lowerQuery = trimmedQuery.toLowerCase();

  // Groups pill: filter tiers by label (e.g. "Province") or reverse-geocoded
  // displayName (e.g. "United Kingdom"). Case-insensitive prefix/substring.
  // (Mirrors the matching in `useAllSearchResults` so Groups pill and All pill
  // stay consistent for tier hits.)
  const matchingTiers = useMemo(() => {
    if (!lowerQuery) return [];
    return locationTiers.filter((tier: TierEntry) => {
      if (tier.transport === 'ble') {
        return tier.label.toLowerCase().startsWith(lowerQuery) && lowerQuery.length >= 3;
      }
      if (tier.label.toLowerCase().startsWith(lowerQuery)) return true;
      if (tier.displayName?.toLowerCase().includes(lowerQuery)) return true;
      return false;
    });
  }, [lowerQuery, locationTiers]);

  // Groups pill still surfaces the geohash jump row as a list header.
  const groupsGeohashQuery = useMemo(
    () => parseGeohashQuery(trimmedQuery),
    [trimmedQuery]
  );

  // ===========================
  // TOP TABS (hidden while searching)
  // ===========================

  const renderTab = useCallback(
    (tab: TopTab, label: string) => {
      const isActive = activeTab === tab;
      return (
        <Pressable
          key={tab}
          onPress={() => setActiveTab(tab)}
          style={[
            styles.tab,
            isActive && { borderBottomColor: accent, borderBottomWidth: 2 },
          ]}>
          <Text
            style={[
              styles.tabLabel,
              { color: isActive ? foreground : opacity(foreground, 0.4) },
              isActive && styles.tabLabelActive,
            ]}>
            {label}
          </Text>
        </Pressable>
      );
    },
    [activeTab, foreground, accent]
  );

  // --- Render helpers ---

  const renderContactsList = () => (
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
  );

  // Groups view — used both by the outer Groups tab and by the `Groups`
  // filter pill inside the Contacts tab (during search). Same data, same
  // rendering, geohash header when a bare geohash is typed.
  const renderGroupsList = () => {
    const tierData = isSearching && trimmedQuery ? matchingTiers : locationTiers;
    return (
      <LegendList
        data={tierData}
        estimatedItemSize={68}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <LocationTierItem tier={item} />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="always"
        ListHeaderComponent={
          groupsGeohashQuery ? <GeohashJumpRow geohash={groupsGeohashQuery} /> : null
        }
        ListEmptyComponent={
          !groupsGeohashQuery ? (
            <View style={styles.emptyContainer}>
              <Icon name="mdi:map-marker-radius" size={30} color={opacity(foreground, 0.3)} />
              <Text style={[styles.emptyText, { color: opacity(foreground, 0.4) }]}>
                {trimmedQuery ? 'No matching groups' : 'Getting your location...'}
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={
          tierData.length === 0 && !groupsGeohashQuery ? styles.emptyList : undefined
        }
      />
    );
  };

  // Decide which body to render. Groups view wins if either the outer tab
  // is Groups OR the Contacts-tab filter pill is 'Groups' (which is only
  // selectable during search). Otherwise on Contacts tab: All-search when
  // there's a query, otherwise the filtered local list.
  const showGroupsBody =
    activeTab === 'groups' || (activeTab === 'contacts' && activeFilter === 'Groups');

  const showAllSearch =
    activeTab === 'contacts' &&
    activeFilter === 'All' &&
    isSearching &&
    trimmedQuery.length > 0;

  return (
    <Screen name="ContactsScreen" style={styles.root}>
      {/* Outer tabs — hidden while searching; search scope is the pill bar below. */}
      {!isSearching && (
        <View
          style={[
            styles.tabBar,
            {
              backgroundColor: surface,
              borderBottomWidth: 0.5,
              borderBottomColor: separator,
            },
          ]}>
          {renderTab('contacts', 'Contacts')}
          {renderTab('groups', 'Groups')}
        </View>
      )}

      {/* Pill bar — only on Contacts tab. Groups tab owns its own filtering
          (matching tiers + geohash header) without needing pills.
          The `Groups` pill is added to the SearchFilters only while searching. */}
      {activeTab === 'contacts' && (
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
          <SearchFilters
            onFilterChange={handleFilterChange}
            showGroups={isSearching}
          />
        </Animated.View>
      )}

      <ScreenContainer>
        {showGroupsBody
          ? renderGroupsList()
          : showAllSearch
            ? <SearchResultsList searchQuery={searchQuery} />
            : renderContactsList()}
      </ScreenContainer>
    </Screen>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 16,
  },
  tabLabelActive: {
    fontWeight: '600',
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
