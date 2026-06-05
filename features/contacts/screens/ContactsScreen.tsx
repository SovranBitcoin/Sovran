import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import Icon from 'assets/icons';

import { useGuardedRouter } from '@/shared/hooks/useGuardedRouter';
import { useTabBarBottomPadding } from '@/shared/hooks/useTabBarBottomPadding';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useMintManagement } from '@/features/mint';
import {
  useNip17RecentContacts,
  type RecentContact,
} from '@/features/payments/hooks/useNip17RecentContacts';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { useMintContacts, type MintContact } from '@/features/payments/hooks/useMintContacts';
import { prefetchImages } from '@/shared/lib/imageCache';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatRelative } from '@/shared/lib/date';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { UnifiedSearch } from '@/shared/ui/composed/search/UnifiedSearch';
import { Log, log, paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import {
  ContactRow,
  geohashIdentity,
  mintIdentity,
  nostrIdentity,
  type Identity,
} from '@/shared/ui/composed/ContactRow';
import { UnderlineTabs } from '@/shared/ui/composed/UnderlineTabs';
import { usePullToAiRefreshControl } from '@/shared/blocks/PullToAiRefreshControl';
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
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { MOCK_ALLOWED_PUBKEYS_HEX } from '@/shared/stores/runtime/mockDataStore';

type TopTab = 'contacts' | 'groups';

interface WhitenoiseRequestRow {
  type: 'request';
  pubkey: string;
  request: WhitenoiseRequest;
}

type ContactsListItem = RecentContact | MintContact | WhitenoiseRequestRow;

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
  // While searching, the unified search surface takes over completely; the
  // idle tabs/pills/lists below are only the non-search experience.
  const { isSearching } = useSearchContext();
  const [activeTab, setActiveTab] = useState<TopTab>('contacts');
  const [activeFilter, setActiveFilter] = useState<ContactsFilter>('All');
  const [surface, separator, muted] = useThemeColor([
    'surface',
    'separator-secondary',
    'muted',
  ] as const);
  const { tiers: locationTiers } = useLocationTiers();
  const tabBarPadding = useTabBarBottomPadding();
  const pullToAi = usePullToAiRefreshControl();
  const whitenoiseEnabled = useSettingsStore((state) => state.whitenoiseEnabled);
  const mockMode = useSettingsStore((state) => state.mockMode);

  const { keys: nostrKeys } = useNostrKeysContext();
  const { mints, getMintInfo } = useMintManagement();

  const {
    displayContacts,
    contactPubkeys,
    conversations: dmConversations,
    loading: contactsLoading,
    hasMore: hasMoreContacts,
    loadMore: loadMoreContacts,
  } = useNip17RecentContacts(nostrKeys);
  const { displayMints, mintPubkeys, mintInfoLoading } = useMintContacts(
    nostrKeys,
    mints,
    getMintInfo,
    dmConversations
  );

  // Single loading gate for the idle contacts list: show one centered spinner
  // until the first DM-conversation + mint-info load settles, instead of the
  // staggered per-source layout shifting. After the first settle the list owns
  // its own pull-to-refresh; we never flash the spinner again.
  const [contactsLoadedOnce, setContactsLoadedOnce] = useState(false);
  useEffect(() => {
    if (!contactsLoading) setContactsLoadedOnce(true);
  }, [contactsLoading]);
  const showContactsSpinner = !contactsLoadedOnce && (contactsLoading || mintInfoLoading);

  // Pending White Noise (Marmot MLS) DM invites — surfaced as the 'Requests'
  // pill on the idle Contacts tab. The InviteReader (mounted by
  // WhitenoiseProvider) keeps this fresh in the background; we read from it
  // here. Pulled up next to contactPubkeys / mintPubkeys so the inviter
  // pubkeys feed into the same batched kind-0 metadata subscription below.
  const {
    requests: whitenoiseRequests,
    busyId: whitenoiseBusyId,
    accept: acceptWhitenoiseRequest,
    decline: declineWhitenoiseRequest,
  } = useWhitenoiseRequests();
  const requestPubkeys = useMemo(
    () => (whitenoiseEnabled ? whitenoiseRequests.map((r) => r.fromPubkey) : []),
    [whitenoiseEnabled, whitenoiseRequests]
  );

  // Accepted Marmot DM counterparties — Marmot uses kind-445 group events,
  // not kind-4/kind-14 DMs, so they don't show up via useRecentContacts.
  // Read them directly from our local DM-index and merge into the contact
  // sources below.
  const { entries: whitenoiseDmEntries } = useWhitenoiseDmContacts();
  const whitenoiseContactPubkeys = useMemo(
    () => (whitenoiseEnabled ? whitenoiseDmEntries.map((e) => e.pubkey) : []),
    [whitenoiseEnabled, whitenoiseDmEntries]
  );

  // Profile metadata is served from the shared SWR cache. Cache hits paint
  // immediately; misses/stale entries trigger one batched kind-0 subscription
  // with `authors: missingOrStale`.
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

  // Only surface mints whose nostr-contact kind-0 profile has actually landed.
  // A mint with a valid npub but no profile metadata yet renders as a bare URL
  // with no picture / nip05 / reputation — reads as "no contact info" to the
  // user. The row reappears automatically when the kind-0 event arrives.
  const mintsWithProfile = useMemo(
    () => displayMints.filter((m) => !!m.pubkey && profilesMap.has(m.pubkey)),
    [displayMints, profilesMap]
  );

  const requestRows = useMemo<WhitenoiseRequestRow[]>(
    () =>
      whitenoiseEnabled
        ? whitenoiseRequests.map((r) => ({
            type: 'request',
            pubkey: r.fromPubkey,
            request: r,
          }))
        : [],
    [whitenoiseEnabled, whitenoiseRequests]
  );

  // Map accepted Marmot DM counterparties into the same row shape used by
  // useRecentContacts entries so renderContactItem treats them identically.
  // timestamp 0 keeps them below entries with genuine recent activity.
  const whitenoiseContactRows = useMemo<RecentContact[]>(
    () =>
      whitenoiseEnabled
        ? whitenoiseDmEntries.map((e) => ({
            type: 'contact',
            pubkey: e.pubkey,
            dmEvent: null,
            nip17Content: undefined,
            timestamp: 0,
          }))
        : [],
    [whitenoiseEnabled, whitenoiseDmEntries]
  );

  const rawListData = useMemo<ContactsListItem[]>(() => {
    switch (activeFilter) {
      case 'Recent': {
        // Merge NIP-17 recent contacts with accepted Marmot DM counterparties,
        // deduped by nostr pubkey.
        const byKey = new Map<string, ContactsListItem>();
        for (const item of whitenoiseContactRows) byKey.set(item.pubkey, item);
        for (const item of displayContacts) {
          if (item.pubkey) byKey.set(item.pubkey, item);
        }
        return Array.from(byKey.values());
      }
      case 'Mints':
        return mintsWithProfile;
      case 'Requests':
        return requestRows;
      default: {
        const byKey = new Map<string, ContactsListItem>();
        for (const item of whitenoiseContactRows) {
          byKey.set(item.pubkey, item);
        }
        for (const item of displayContacts) {
          if (item.pubkey) byKey.set(item.pubkey, item);
        }
        for (const item of mintsWithProfile) {
          const key = item.pubkey || item.mint?.mintUrl;
          if (key) byKey.set(key, item);
        }
        return Array.from(byKey.values());
      }
    }
  }, [activeFilter, displayContacts, mintsWithProfile, whitenoiseContactRows, requestRows]);

  // Mock-mode allowlist filter: only show rows whose nostr pubkey is in
  // MOCK_ALLOWED_PUBKEYS_HEX (defined in mockDataStore). Mints / requests are
  // dropped entirely so the screen reads as a clean, hardcoded demo list.
  const currentListData = useMemo<ContactsListItem[]>(() => {
    if (!mockMode) return rawListData;
    return rawListData.filter(
      (item) => item.type === 'contact' && MOCK_ALLOWED_PUBKEYS_HEX.has(item.pubkey)
    );
  }, [rawListData, mockMode]);

  const handleFilterChange = useCallback((filter: ContactsFilter) => {
    log.debug('contacts.filter_changed', { filter });
    setActiveFilter(filter);
  }, []);

  const renderContactItem = useCallback(
    ({ item }: { item: ContactsListItem }) => {
      // White Noise pending invite — keep it in this list so the empty/
      // loading/scrolling behaviour is the same as the other pills, but
      // swap the trailing slot for accept/decline buttons.
      if (item.type === 'request') {
        const req = item.request;
        const profile = profilesMap.get(req.fromPubkey);
        // Strangers' kind-0 metadata may simply not be on the user's default
        // relay set — that's the whole point of a "request". So render with
        // the seeded fallback immediately rather than a skeleton forever.
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
      // Relative date of the last message so it's obvious how long ago it was.
      // RecentContact.timestamp is in Nostr seconds; formatRelative wants ms.
      const lastMessageAt =
        item.type === 'contact' &&
        typeof item.timestamp === 'number' &&
        item.timestamp > 0 &&
        lastMessage
          ? formatRelative(item.timestamp * 1000, 'compact')
          : undefined;
      // Don't drive the avatar's loading skeleton off "profile is missing":
      // for strangers (Marmot DM accept, Requests pill) kind-0 may simply not
      // be on our relay set, so missing IS the steady state.
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
      // human sentence.
      return (
        <ContactRow
          identity={identity}
          subtitle={lastMessage}
          hideMetadata={!!lastMessage}
          titleTrailing={
            lastMessageAt ? (
              <Text style={{ fontSize: 12, color: muted }}>{lastMessageAt}</Text>
            ) : undefined
          }
          onPress={() => navigateToProfile(item.pubkey, mintUrl)}
          testID={`contact-row:nostr:${item.pubkey}`}
        />
      );
    },
    [profilesMap, whitenoiseBusyId, acceptWhitenoiseRequest, declineWhitenoiseRequest, muted]
  );

  const renderEmpty = useCallback(() => {
    if (activeFilter === 'Mints' && mintInfoLoading) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: muted }]}>Loading mints...</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Icon name="mdi:account-group" size={30} color={muted} />
        <Text style={[styles.emptyText, { color: muted }]}>
          {activeFilter === 'Mints'
            ? 'No mints with nostr contacts found'
            : activeFilter === 'Requests'
              ? 'No pending White Noise invites'
              : 'No recent contacts yet'}
        </Text>
      </View>
    );
  }, [muted, activeFilter, mintInfoLoading]);

  // Idle Contacts-tab pills. Groups lives in the outer tab bar (not a pill),
  // and live search now has its own scope tabs in UnifiedSearch.
  const visibleFilters = useMemo<readonly ContactsFilter[]>(() => {
    const baseFilters: ContactsFilter[] = ['All', 'Recent'];
    if (whitenoiseEnabled) baseFilters.push('Requests');
    baseFilters.push('Mints');
    return baseFilters;
  }, [whitenoiseEnabled]);

  // If the active pill drops out of the visible set (e.g. White Noise gets
  // disabled while 'Requests' is active), fall back to 'All'.
  useEffect(() => {
    if (!visibleFilters.includes(activeFilter)) {
      setActiveFilter('All');
    }
  }, [visibleFilters, activeFilter]);

  // ===========================
  // TOP TABS. Labels are display-only; the index -> TopTab map preserves the
  // internal 'contacts'/'groups' state type.
  // ===========================

  const TOP_TAB_KEYS: readonly TopTab[] = ['contacts', 'groups'];
  const TOP_TAB_LABELS = ['Contacts', 'Groups'] as const;
  const activeTabLabel = TOP_TAB_LABELS[TOP_TAB_KEYS.indexOf(activeTab)] ?? 'Contacts';
  const handleTopTabPress = useCallback((_tab: string, index: number) => {
    const nextKey = TOP_TAB_KEYS[index];
    if (nextKey) setActiveTab(nextKey);
  }, []);

  // --- Render helpers ---

  const renderContactsList = () => {
    // One centered spinner during the initial idle load — no per-source layout
    // shift. After the first settle the list owns its own pull-to-refresh.
    if (showContactsSpinner) {
      return (
        <View style={styles.emptyContainer}>
          <Spinner size={22} color={muted} />
        </View>
      );
    }
    return (
      <LegendList
        data={currentListData}
        extraData={profilesMap}
        estimatedItemSize={68}
        refreshControl={pullToAi.refreshControl}
        onEndReached={hasMoreContacts ? loadMoreContacts : undefined}
        onEndReachedThreshold={0.4}
        keyExtractor={(item, index) => {
          return (
            item.pubkey ||
            (item.type === 'mint' ? item.mint?.mintUrl : undefined) ||
            `contact-${index}`
          );
        }}
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
  };

  // Groups tab — the user's location tiers (provinces, countries, transports).
  const renderGroupsList = () => (
    <LegendList
      data={locationTiers}
      estimatedItemSize={68}
      keyExtractor={(item) => item.key}
      refreshControl={pullToAi.refreshControl}
      renderItem={({ item }) => <GroupsTierRow tier={item} />}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="always"
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Icon name="mdi:map-marker-radius" size={30} color={muted} />
          <Text style={[styles.emptyText, { color: muted }]}>Getting your location...</Text>
        </View>
      }
      contentContainerStyle={
        locationTiers.length === 0
          ? [styles.emptyList, { paddingBottom: tabBarPadding }]
          : { paddingBottom: tabBarPadding }
      }
    />
  );

  // Live search is a single, consistent surface shared with Feed and Wallet.
  if (isSearching) {
    return (
      <Log name="ContactsScreen" style={[styles.root, { backgroundColor: surface }]}>
        <UnifiedSearch recentContext="contacts" />
      </Log>
    );
  }

  return (
    <Log name="ContactsScreen" style={[styles.root, { backgroundColor: surface }]}>
      <View
        style={{
          backgroundColor: surface,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: separator,
        }}>
        <UnderlineTabs
          tabs={TOP_TAB_LABELS}
          selectedTab={activeTabLabel}
          handleTabPress={handleTopTabPress}
        />
      </View>

      {/* Contacts-tab pill bar (All / Recent / Requests / Mints). The Groups
          tab owns its own list and needs no pills. */}
      {activeTab === 'contacts' && (
        <View
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
        </View>
      )}

      <ScreenContainer>
        {activeTab === 'groups' ? renderGroupsList() : renderContactsList()}
      </ScreenContainer>
    </Log>
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
