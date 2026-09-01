import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { List } from '@/shared/ui/composed/List';
import Icon from 'assets/icons';

import { useTabBarBottomPadding } from '@/shared/hooks/useTabBarBottomPadding';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useMintManagement } from '@/features/mint';
import { useNip17RecentContacts } from '@/features/payments/hooks/useNip17RecentContacts';
import type { RecentContact } from '@/features/payments/data/recentContactTypes';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { useMintContacts, type MintContact } from '@/features/payments/hooks/useMintContacts';
import { prefetchImages } from '@/shared/lib/imageCache';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatRelativeUnixSeconds } from '@/shared/lib/date';
import { SearchOverlay } from '@/shared/ui/composed/search/SearchOverlay';
import { Log, log, paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import {
  ContactRow,
  mintIdentity,
  nostrIdentity,
  type Identity,
} from '@/shared/ui/composed/ContactRow';
import { TierRow } from '@/shared/ui/composed/search/SearchResultRows';
import { TierBadge } from '@/shared/ui/composed/TierBadge';
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

function contactsListItemKey(item: ContactsListItem, index: number): string {
  if (item.type === 'request') return item.request.id || item.request.fromPubkey;
  if (item.type === 'mint') return item.mint?.mintUrl ?? item.pubkey ?? `mint-${index}`;
  return item.pubkey || `contact-${index}`;
}

/** Rows for the active filter; All/Recent merge sources deduped by pubkey. */
function buildContactsListData(
  activeFilter: ContactsFilter,
  whitenoiseContactRows: RecentContact[],
  displayContacts: RecentContact[],
  mintsWithProfile: MintContact[],
  requestRows: WhitenoiseRequestRow[]
): ContactsListItem[] {
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
}

export const ContactsScreen = () => {
  useLifecycleLogger('ContactsScreen');
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
    hasLoadedOnce: contactsHasLoadedOnce,
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
  // until the first DM-conversation fetch genuinely settles AND mint-info has
  // loaded, instead of the staggered per-source layout shifting. We gate on the
  // hook's `hasLoadedOnce` (not `!loading`) because `loading` starts false and
  // only flips true once the fetch effect runs — gating on `!loading` hid the
  // spinner on the first render and flashed cached mint rows before contacts
  // arrived. After the first settle the list owns its own pull-to-refresh; we
  // never flash the spinner again.
  const [contactsLoadedOnce, setContactsLoadedOnce] = useState(false);
  useEffect(() => {
    if (contactsHasLoadedOnce && !mintInfoLoading) setContactsLoadedOnce(true);
  }, [contactsHasLoadedOnce, mintInfoLoading]);
  const showContactsSpinner = !contactsLoadedOnce;

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
  const requestPubkeys = whitenoiseEnabled ? whitenoiseRequests.map((r) => r.fromPubkey) : [];

  // Accepted Marmot DM counterparties — Marmot uses kind-445 group events,
  // not kind-4/kind-14 DMs, so they don't show up via useRecentContacts.
  // Read them directly from our local DM-index and merge into the contact
  // sources below.
  const { entries: whitenoiseDmEntries } = useWhitenoiseDmContacts();
  const whitenoiseContactPubkeys = whitenoiseEnabled
    ? whitenoiseDmEntries.map((e) => e.pubkey)
    : [];

  // Profile metadata is served from the shared SWR cache. Cache hits paint
  // immediately; misses/stale entries trigger one batched kind-0 subscription
  // with `authors: missingOrStale`.
  const allPubkeys = [
    ...new Set([...contactPubkeys, ...mintPubkeys, ...requestPubkeys, ...whitenoiseContactPubkeys]),
  ];
  const { metadata: profilesMap } = useNostrProfileMetadataMany(allPubkeys);

  useEffect(() => {
    void prefetchImages(Array.from(profilesMap.values()).map((p) => p.picture));
  }, [profilesMap]);

  // Only surface mints whose nostr-contact kind-0 profile has actually landed.
  // A mint with a valid npub but no profile metadata yet renders as a bare URL
  // with no picture / nip05 / reputation — reads as "no contact info" to the
  // user. The row reappears automatically when the kind-0 event arrives.
  const mintsWithProfile = displayMints.filter((m) => !!m.pubkey && profilesMap.has(m.pubkey));

  const requestRows: WhitenoiseRequestRow[] = whitenoiseEnabled
    ? whitenoiseRequests.map((r) => ({
        type: 'request',
        pubkey: r.fromPubkey,
        request: r,
      }))
    : [];

  // Map accepted Marmot DM counterparties into the same row shape used by
  // useRecentContacts entries so renderContactItem treats them identically.
  // timestamp 0 keeps them below entries with genuine recent activity.
  const whitenoiseContactRows: RecentContact[] = whitenoiseEnabled
    ? whitenoiseDmEntries.map((e) => ({
        type: 'contact',
        pubkey: e.pubkey,
        dmEvent: null,
        nip17Content: undefined,
        timestamp: 0,
        protocol: 'whitenoise' as const,
      }))
    : [];

  const rawListData: ContactsListItem[] = buildContactsListData(
    activeFilter,
    whitenoiseContactRows,
    displayContacts,
    mintsWithProfile,
    requestRows
  );

  // Mock-mode allowlist filter: only show rows whose nostr pubkey is in
  // MOCK_ALLOWED_PUBKEYS_HEX (defined in mockDataStore). Mints / requests are
  // dropped entirely so the screen reads as a clean, hardcoded demo list.
  const currentListData: ContactsListItem[] = mockMode
    ? rawListData.filter(
        (item) => item.type === 'contact' && MOCK_ALLOWED_PUBKEYS_HEX.has(item.pubkey)
      )
    : rawListData;
  const handleFilterChange = (filter: ContactsFilter) => {
    log.debug('contacts.filter_changed', { filter });
    setActiveFilter(filter);
  };

  const renderContactItem = ({ item }: { item: ContactsListItem; index: number }) => {
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
    const lastMessageAt =
      item.type === 'contact' &&
      typeof item.timestamp === 'number' &&
      item.timestamp > 0 &&
      lastMessage
        ? formatRelativeUnixSeconds(item.timestamp)
        : undefined;
    // Label non-default DM protocols so a NIP-04 / White Noise conversation is
    // distinguishable from the default NIP-17 in the now-mixed list.
    const protocolLabel =
      item.type === 'contact' && item.protocol === 'nip04'
        ? 'NIP-04'
        : item.type === 'contact' && item.protocol === 'whitenoise'
          ? 'White Noise'
          : undefined;
    // Don't drive the avatar's loading skeleton off "profile is missing":
    // for strangers (Marmot DM accept, Requests pill) kind-0 may simply not
    // be on our relay set, so missing IS the steady state.
    const isLoadingProfile = false;
    const mintUrl = item.type === 'mint' ? item.mint?.mintUrl : undefined;
    // Dev-only data-source chip (n/c/r) for DM-backed rows, keyed by the
    // conversation's newest message id — same pattern as PostCard/notifications.
    const sourceBadge =
      item.type === 'contact' && item.newestMessageId ? (
        <TierBadge eventId={item.newestMessageId} />
      ) : undefined;

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
          protocolLabel || lastMessageAt || sourceBadge ? (
            <View style={styles.titleTrailingRow}>
              {protocolLabel || lastMessageAt ? (
                <Text style={{ fontSize: 12, color: muted }}>
                  {[protocolLabel, lastMessageAt].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              {sourceBadge}
            </View>
          ) : undefined
        }
        onPress={() => navigateToProfile(item.pubkey, mintUrl)}
        testID={`contact-row:nostr:${item.pubkey}`}
      />
    );
  };
  const renderGroupItem = ({ item }: { item: TierEntry; index: number }) => (
    <TierRow tier={item} source="contacts" />
  );

  const renderEmpty = () => {
    if (activeFilter === 'Mints' && mintInfoLoading) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: muted }]}>Loading mints...</Text>
        </View>
      );
    }
    return (
      <View
        style={styles.emptyContainer}
        testID={`contacts-empty:${activeFilter.toLowerCase()}`}
        accessible
        accessibilityLabel="No contacts to show">
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
  };

  // Idle Contacts-tab pills. Groups lives in the outer tab bar (not a pill),
  // and live search now has its own scope tabs in UnifiedSearch.
  // Memoized because the effect below depends on it: rebuilt inline it was a
  // fresh array every render, so the fallback effect re-ran on every render.
  const visibleFilters: readonly ContactsFilter[] = useMemo(
    () => (whitenoiseEnabled ? ['All', 'Recent', 'Requests', 'Mints'] : ['All', 'Recent', 'Mints']),
    [whitenoiseEnabled]
  );

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
  const handleTopTabPress = (_tab: string, index: number) => {
    const nextKey = TOP_TAB_KEYS[index];
    if (nextKey) setActiveTab(nextKey);
  };

  // --- Render helpers ---

  const renderContactsList = () => {
    // One centered spinner during the initial idle load — no per-source layout
    // shift. After the first settle the list owns its own pull-to-refresh.
    if (showContactsSpinner) {
      return (
        <View style={styles.emptyContainer}>
          <Spinner
            size={22}
            color={muted}
            visualScope="contacts.contacts.loading"
            visualKey="initial-spinner"
            visualSurface="contacts"
            visualComponent="ContactsInitialSpinner"
          />
        </View>
      );
    }
    return (
      <List
        data={currentListData}
        extraData={profilesMap}
        refreshControl={pullToAi.refreshControl}
        onEndReached={hasMoreContacts ? loadMoreContacts : undefined}
        onEndReachedThreshold={0.4}
        keyExtractor={contactsListItemKey}
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
    <List
      data={locationTiers}
      keyExtractor={(item) => item.key}
      refreshControl={pullToAi.refreshControl}
      renderItem={renderGroupItem}
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
      <SearchOverlay recentContext="contacts" />
    </Log>
  );
};

const styles = StyleSheet.create({
  titleTrailingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
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
