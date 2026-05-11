import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { LegendList } from '@legendapp/list';
import Icon from 'assets/icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import opacity from 'hex-color-opacity';

import { useGuardedRouter } from '@/shared/hooks/useGuardedRouter';
import { useTabBarBottomPadding } from '@/shared/hooks/useTabBarBottomPadding';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useMintManagement } from '@/features/mint';
import { useRecentContacts, type RecentContact } from '@/features/payments/hooks/useRecentContacts';
import { useMintContacts, type MintContact } from '@/features/payments/hooks/useMintContacts';
import { prefetchImages } from '@/shared/lib/imageCache';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { Log, log, paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { SearchResultsList } from '@/shared/ui/composed/SearchResultsList';
import {
  ContactRow,
  geohashIdentity,
  mintIdentity,
  nostrIdentity,
  type Identity,
} from '@/shared/ui/composed/ContactRow';
import { ScreenContainer } from '../components/ScreenContainer';
import { navigateToProfile } from '../lib/navigateToProfile';
import {
  SearchFilters,
  SEARCH_FILTERS_HEIGHT,
  type ContactsFilter,
} from '../components/search/SearchFilters';
import {
  useWhitenoiseRequests,
  type WhitenoiseRequest,
} from '@/features/whitenoise/hooks/useWhitenoiseRequests';
import { useWhitenoiseDmContacts } from '@/features/whitenoise/hooks/useWhitenoiseDmContacts';
import { RequestActions } from '@/features/whitenoise/components/RequestActions';
import { useLocationTiers, type TierEntry } from '@/features/bitchat/hooks/useLocationTiers';
import { parseGeohashQuery } from '../lib/parseGeohashQuery';
import { matchTiers } from '../lib/matchTiers';
import type { NostrProfileMetadata } from '@/shared/stores/global/nostrMetadataCache';

type TopTab = 'contacts' | 'groups';

interface WhitenoiseRequestRow {
  type: 'request';
  pubkey: string;
  request: WhitenoiseRequest;
}

type ContactsListItem = RecentContact | MintContact | WhitenoiseRequestRow;

// Hostname extraction for mint URL search. Pure; hoisted so the reference is
// stable across renders (each list filter pass would otherwise allocate a
// fresh closure).
function mintHost(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function GeohashJumpRow({ geohash }: { geohash: string }) {
  const router = useGuardedRouter();
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
        paymentLog.info('contact.geohash.press', { geohash, source: 'contacts' });
        router.push({
          pathname: '/(user-flow)/geohashChat',
          params: { geohash },
        });
      }}
      testID={`contact-row:geohash:${geohash}`}
    />
  );
}

function GroupsTierRow({ tier }: { tier: TierEntry }) {
  const router = useGuardedRouter();
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
        paymentLog.info('contact.tier.press', {
          tier: tier.key,
          transport: tier.transport,
          source: 'contacts',
        });
        router.push({
          pathname: '/(user-flow)/geohashChat',
          params: {
            geohash: tier.geohash,
            tierLabel: tier.label,
            transport: tier.transport,
          },
        });
      }}
      testID={`contact-row:geohash:${tier.geohash}`}
    />
  );
}

export const ContactsScreen = () => {
  useLifecycleLogger('ContactsScreen');
  const { isSearching, searchQuery } = useSearchContext();
  const [activeTab, setActiveTab] = useState<TopTab>('contacts');
  const [activeFilter, setActiveFilter] = useState<ContactsFilter>('All');
  const lastSearchFilterRef = useRef<ContactsFilter>('All');
  const [foreground, surface, separator, accent] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
    'accent',
  ] as const);
  const { tiers: locationTiers } = useLocationTiers();
  const tabBarPadding = useTabBarBottomPadding();

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

  // Pending White Noise (Marmot MLS) DM invites — surfaced as the
  // 'Requests' pill. The InviteReader (mounted by WhitenoiseProvider) keeps
  // this list fresh in the background; we just read from it here. Pulled
  // up next to contactPubkeys / mintPubkeys so the inviter pubkeys feed
  // into the same batched kind-0 metadata subscription below — otherwise
  // request rows would show empty avatar + "loading…" placeholders forever
  // because their pubkeys would never be in `authors`.
  const {
    requests: whitenoiseRequests,
    busyId: whitenoiseBusyId,
    accept: acceptWhitenoiseRequest,
    decline: declineWhitenoiseRequest,
  } = useWhitenoiseRequests();
  const requestPubkeys = useMemo(
    () => whitenoiseRequests.map((r) => r.fromPubkey),
    [whitenoiseRequests]
  );

  // Accepted Marmot DM counterparties — Marmot uses kind-445 group events,
  // not kind-4/kind-14 DMs, so they don't show up via useRecentContacts.
  // Read them directly from our local DM-index and merge into the contact
  // sources below.
  const { entries: whitenoiseDmEntries } = useWhitenoiseDmContacts();
  const whitenoiseContactPubkeys = useMemo(
    () => whitenoiseDmEntries.map((e) => e.pubkey),
    [whitenoiseDmEntries]
  );

  // Profile metadata is served from the shared SWR cache. Cache hits
  // paint immediately; misses/stale entries trigger one batched kind-0
  // subscription with `authors: missingOrStale`. Other surfaces
  // (UserMessagesScreen, UserProfileScreen, picker, search) populate
  // and consume the same cache, so visiting Contacts after using any
  // of them is essentially instant.
  const allPubkeys = useMemo(
    () => [
      ...new Set([
        ...contactPubkeys,
        ...mintPubkeys,
        ...requestPubkeys,
        ...whitenoiseContactPubkeys,
      ]),
    ],
    [contactPubkeys, mintPubkeys, requestPubkeys, whitenoiseContactPubkeys]
  );
  const { metadata: profilesMap } = useNostrProfileMetadataMany(allPubkeys);

  useEffect(() => {
    void prefetchImages(Array.from(profilesMap.values()).map((p) => p.picture));
  }, [profilesMap]);

  const trimmedQuery = searchQuery.trim();
  const lowerQuery = trimmedQuery.toLowerCase();

  // Match a query against human-readable nostr profile text. Deliberately
  // excludes the raw hex pubkey — those are 64-char hex and would false-match
  // any short alphanumeric query ("abc", "face", "123", …).
  const matchesProfileQuery = useCallback(
    (profile: NostrProfileMetadata | undefined): boolean => {
      if (!lowerQuery) return true;
      if (!profile) return false;
      const candidates = [profile.name, profile.displayName, profile.nip05];
      return candidates.some((v) => typeof v === 'string' && v.toLowerCase().includes(lowerQuery));
    },
    [lowerQuery]
  );

  const filteredDisplayContacts = useMemo(() => {
    if (!lowerQuery) return displayContacts;
    return displayContacts.filter((c) => {
      const profile = c.pubkey ? profilesMap.get(c.pubkey) : undefined;
      return matchesProfileQuery(profile);
    });
  }, [displayContacts, profilesMap, lowerQuery, matchesProfileQuery]);

  // Only surface mints whose nostr-contact kind-0 profile has actually landed.
  // A mint with a valid npub but no profile metadata yet renders as a bare
  // URL with no picture / nip05 / reputation — reads as "no contact info" to
  // the user. The row reappears automatically when the kind-0 event arrives
  // (this memo depends on `profilesMap`).
  const mintsWithProfile = useMemo(
    () => displayMints.filter((m) => !!m.pubkey && profilesMap.has(m.pubkey)),
    [displayMints, profilesMap]
  );

  const filteredDisplayMints = useMemo(() => {
    if (!lowerQuery) return mintsWithProfile;
    return mintsWithProfile.filter((m) => {
      const name = m.mintInfo?.name;
      if (typeof name === 'string' && name.toLowerCase().includes(lowerQuery)) return true;
      if (mintHost(m.mint?.mintUrl).includes(lowerQuery)) return true;
      const profile = m.pubkey ? profilesMap.get(m.pubkey) : undefined;
      return matchesProfileQuery(profile);
    });
  }, [mintsWithProfile, profilesMap, lowerQuery, matchesProfileQuery]);

  const requestRows = useMemo<WhitenoiseRequestRow[]>(
    () =>
      whitenoiseRequests.map((r) => ({
        type: 'request',
        pubkey: r.fromPubkey,
        request: r,
      })),
    [whitenoiseRequests]
  );

  // Map accepted Marmot DM counterparties into the same row shape used by
  // useRecentContacts entries so renderContactItem (and search filtering)
  // treats them identically. timestamp 0 keeps them below entries with
  // genuine recent activity until we wire group-history reads.
  const whitenoiseContactRows = useMemo<RecentContact[]>(
    () =>
      whitenoiseDmEntries.map((e) => ({
        type: 'contact',
        pubkey: e.pubkey,
        dmEvent: null,
        nip17Content: undefined,
        timestamp: 0,
      })),
    [whitenoiseDmEntries]
  );

  const filteredWhitenoiseContacts = useMemo(() => {
    if (!lowerQuery) return whitenoiseContactRows;
    return whitenoiseContactRows.filter((c) => {
      const profile = profilesMap.get(c.pubkey);
      return matchesProfileQuery(profile);
    });
  }, [whitenoiseContactRows, profilesMap, lowerQuery, matchesProfileQuery]);

  const currentListData = useMemo<ContactsListItem[]>(() => {
    switch (activeFilter) {
      case 'Recent': {
        // Merge NIP-17/NIP-04 recent contacts with accepted Marmot DM
        // counterparties, deduped by pubkey (NIP-17 entries win — they
        // carry actual lastMessage previews).
        const byKey = new Map<string, ContactsListItem>();
        for (const item of filteredWhitenoiseContacts) byKey.set(item.pubkey, item);
        for (const item of filteredDisplayContacts) {
          if (item.pubkey) byKey.set(item.pubkey, item);
        }
        return Array.from(byKey.values());
      }
      case 'Mints':
        return filteredDisplayMints;
      case 'Requests':
        return requestRows;
      default: {
        const byKey = new Map<string, ContactsListItem>();
        for (const item of filteredWhitenoiseContacts) {
          byKey.set(item.pubkey, item);
        }
        for (const item of filteredDisplayContacts) {
          if (item.pubkey) byKey.set(item.pubkey, item);
        }
        for (const item of filteredDisplayMints) {
          const key = item.pubkey || item.mint?.mintUrl;
          if (key) byKey.set(key, item);
        }
        return Array.from(byKey.values());
      }
    }
  }, [
    activeFilter,
    filteredDisplayContacts,
    filteredDisplayMints,
    filteredWhitenoiseContacts,
    requestRows,
  ]);

  const handleFilterChange = useCallback((filter: ContactsFilter) => {
    log.debug('contacts.filter_changed', { filter });
    setActiveFilter(filter);
    lastSearchFilterRef.current = filter;
  }, []);

  const renderContactItem = useCallback(
    ({ item }: { item: ContactsListItem }) => {
      // White Noise pending invite — keep it in this list so the empty/
      // loading/scrolling behaviour is the same as the other pills, but
      // swap the trailing slot for accept/decline buttons.
      if (item.type === 'request') {
        const req = item.request;
        const profile = profilesMap.get(req.fromPubkey);
        // Strangers' kind-0 metadata may simply not be on the user's
        // default relay set — that's the whole point of a "request". So
        // render with the seeded fallback immediately rather than a
        // skeleton forever. If metadata arrives later (the kind-0 batch
        // happens to find it), the avatar swaps to the image and the
        // displayName replaces the truncated-pubkey fallback.
        return (
          <ContactRow
            identity={[nostrIdentity(req.fromPubkey, profile, { isLoadingProfile: false })]}
            subtitle="Wants to start a White Noise chat"
            hideMetadata
            trailing={
              <RequestActions
                isBusy={whitenoiseBusyId === req.id}
                onAccept={() => {
                  paymentLog.info('contact.whitenoise.accept', { pubkey: req.fromPubkey });
                  void acceptWhitenoiseRequest(req);
                }}
                onDecline={() => {
                  paymentLog.info('contact.whitenoise.decline', { pubkey: req.fromPubkey });
                  void declineWhitenoiseRequest(req);
                }}
              />
            }
            testID={`request-row:${req.fromPubkey}`}
          />
        );
      }

      const profile = item.pubkey ? profilesMap.get(item.pubkey) : undefined;
      const lastMessage =
        typeof item.dmEvent?.content === 'string' ? item.dmEvent.content : undefined;
      // Don't drive the avatar's loading skeleton off "profile is missing":
      // for strangers (Marmot DM accept, Requests pill) kind-0 may simply
      // not be on our relay set, so missing IS the steady state. With
      // `resolveIdentityName` powering the title, the seeded fallback
      // avatar plus deterministic word-pair name renders immediately —
      // no skeleton-forever rows.
      const isLoadingProfile = false;
      const mintUrl = item.type === 'mint' ? item.mint?.mintUrl : undefined;

      // Layered identity: mint-type items also have a nostr contact key
      // (NIP-87 / NUT-06), so render the mint avatar/name with the nostr
      // reputation pills + NIP-05 badge on the accent row.
      const identity: Identity[] = [];
      if (item.type === 'mint' && mintUrl) {
        identity.push(
          mintIdentity({
            mintUrl,
            displayName: item.mintInfo?.name ?? mintUrl,
            iconUrl: item.mintInfo?.icon_url,
          })
        );
      }
      if (item.pubkey) {
        identity.push(nostrIdentity(item.pubkey, profile, { isLoadingProfile }));
      }

      // Replies mode: a last-message preview takes the subtitle slot and
      // suppresses metadata — the pill row would read as noise next to a
      // human sentence. Contacts without a last message fall back to
      // the default nostr subtitle (empty, NIP-05 lives in the accent).
      return (
        <ContactRow
          identity={identity}
          subtitle={lastMessage}
          hideMetadata={!!lastMessage}
          onPress={() => navigateToProfile(item.pubkey, mintUrl)}
          testID={`contact-row:nostr:${item.pubkey}`}
        />
      );
    },
    [profilesMap, whitenoiseBusyId, acceptWhitenoiseRequest, declineWhitenoiseRequest]
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
            : activeFilter === 'Requests'
              ? 'No pending White Noise invites'
              : 'No recent contacts yet'}
        </Text>
      </View>
    );
  }, [foreground, activeFilter, mintInfoLoading]);

  // Groups pill: filter tiers by label (e.g. "Province") or reverse-geocoded
  // displayName (e.g. "United Kingdom"). Shared with `useAllSearchResults`
  // so Groups pill and All pill stay consistent for tier hits.
  const matchingTiers = useMemo(
    () => matchTiers(locationTiers, lowerQuery),
    [lowerQuery, locationTiers]
  );

  // Groups pill still surfaces the geohash jump row as a list header.
  const groupsGeohashQuery = useMemo(() => parseGeohashQuery(trimmedQuery), [trimmedQuery]);

  // Pill visibility:
  //   • No active search → base pills (Groups lives in the outer tab bar).
  //   • Search open, empty query → all pills so the user can pick a scope.
  //   • Search open with a query → only pills that have at least one match.
  const visibleFilters = useMemo<readonly ContactsFilter[]>(() => {
    if (!isSearching) return ['All', 'Recent', 'Requests', 'Mints'];
    if (!lowerQuery) return ['All', 'Recent', 'Requests', 'Mints', 'Groups'];
    const list: ContactsFilter[] = ['All'];
    if (filteredDisplayContacts.length > 0) list.push('Recent');
    if (whitenoiseRequests.length > 0) list.push('Requests');
    if (filteredDisplayMints.length > 0) list.push('Mints');
    if (matchingTiers.length > 0 || groupsGeohashQuery) list.push('Groups');
    return list;
  }, [
    isSearching,
    lowerQuery,
    filteredDisplayContacts,
    filteredDisplayMints,
    whitenoiseRequests,
    matchingTiers,
    groupsGeohashQuery,
  ]);

  // When the active pill drops out of the visible set (e.g. query narrows
  // past its matches), silently fall back to 'All'. Intentionally bypass
  // `handleFilterChange` so `lastSearchFilterRef` is left alone — that ref
  // drives the Groups-tab switch when the search bar closes.
  useEffect(() => {
    if (!visibleFilters.includes(activeFilter)) {
      setActiveFilter('All');
    }
  }, [visibleFilters, activeFilter]);

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
          style={[styles.tab, isActive && { borderBottomColor: accent, borderBottomWidth: 2 }]}>
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
      extraData={profilesMap}
      estimatedItemSize={68}
      keyExtractor={(item, index) =>
        item.pubkey || (item.type === 'mint' ? item.mint?.mintUrl : undefined) || `contact-${index}`
      }
      renderItem={renderContactItem}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="always"
      ListEmptyComponent={renderEmpty}
      contentContainerStyle={
        currentListData.length === 0
          ? [styles.emptyList, { paddingBottom: tabBarPadding }]
          : { paddingBottom: tabBarPadding }
      }
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
        renderItem={({ item }) => <GroupsTierRow tier={item} />}
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
          tierData.length === 0 && !groupsGeohashQuery
            ? [styles.emptyList, { paddingBottom: tabBarPadding }]
            : { paddingBottom: tabBarPadding }
        }
      />
    );
  };

  // While searching, the outer Groups tab is folded into the Contacts
  // search flow — same pill bar, same unified SearchResultsList. The user
  // never sees a separate "Groups search". `activeTab` itself is left
  // alone so closing the search restores the original outer tab.
  const effectiveTab: TopTab = isSearching ? 'contacts' : activeTab;

  // Decide which body to render. Groups view wins if either the (effective)
  // outer tab is Groups OR the Contacts-tab filter pill is 'Groups' (which
  // is only selectable during search). Otherwise on Contacts tab: All-search
  // when there's a query, otherwise the filtered local list.
  const showGroupsBody =
    effectiveTab === 'groups' || (effectiveTab === 'contacts' && activeFilter === 'Groups');

  const showAllSearch =
    effectiveTab === 'contacts' && activeFilter === 'All' && isSearching && trimmedQuery.length > 0;

  return (
    <Log name="ContactsScreen" style={[styles.root, { backgroundColor: surface }]}>
      {/* Outer tabs — hidden while searching; search scope is the pill bar below. */}
      {!isSearching && (
        <View
          style={[
            styles.tabBar,
            {
              backgroundColor: surface,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: separator,
            },
          ]}>
          {renderTab('contacts', 'Contacts')}
          {renderTab('groups', 'Groups')}
        </View>
      )}

      {/* Pill bar — shown on the Contacts tab and during search (when the
          outer Groups tab is folded into the Contacts search flow). Groups
          tab in its idle state owns its own filtering (matching tiers +
          geohash header) without needing pills. The `Groups` pill is added
          to the SearchFilters only while searching. */}
      {effectiveTab === 'contacts' && (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={[
            styles.filtersRow,
            {
              backgroundColor: surface,
              paddingHorizontal: 20,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: separator,
            },
          ]}>
          <SearchFilters
            activeFilter={activeFilter}
            onFilterChange={handleFilterChange}
            filters={visibleFilters}
          />
        </Animated.View>
      )}

      <ScreenContainer>
        {showGroupsBody ? (
          renderGroupsList()
        ) : showAllSearch ? (
          <SearchResultsList searchQuery={searchQuery} />
        ) : (
          renderContactsList()
        )}
      </ScreenContainer>
    </Log>
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
