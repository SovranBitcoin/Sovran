/**
 * @fileoverview The Search tab's sectioned result list.
 *
 * Renders the flat `SearchListItem[]` that `buildSearchSections` produces
 * (section headers, the pasted-payment action card, people, mints and nearby
 * rows) in one virtualized list, with first-paint placeholders, a
 * "no results" state and a failed-search state. It takes the rows as props
 * rather than fetching, so one `useSearchAggregates` call feeds it.
 */
import { View } from 'react-native';
import { usePaymentFlowMachine } from 'wallet/react';

import { DetectedActionRow } from '@/features/send/components/DetectedActionRow';
import { startContactSend } from '@/features/send/lib/startContactSend';
import type { SearchListItem } from '@/features/search/lib/searchSections';
import { navigateToProfile } from '@/features/search/lib/navigateToProfile';
import { NoResultsFound } from '@/features/payments/components/NoResultsFound';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { CONTACT_SEARCH_MIN_LENGTH } from '@/shared/lib/contactSearch';
import { paymentLog, cashuLog, mintUrlLogFields } from '@/shared/lib/logger';
import { buildMintInfoHref } from '@/shared/lib/nav/mintInfoRoutes';
import { extractDomain, getMintDisplayName } from '@/shared/lib/url';
import { useWalletContext } from '@/runtime/WalletProjection';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import {
  ContactRow,
  geohashIdentity,
  mintIdentity,
  nostrIdentity,
} from '@/shared/ui/composed/ContactRow';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { FollowBadge } from '@/shared/ui/composed/FollowBadge';
import { List } from '@/shared/ui/composed/List';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import type { TierEntry } from '@/features/bitchat/hooks/useLocationTiers';
import { runAfterNativeSearchDismiss } from './nativeSearchDismiss';
import { searchListState, type SearchStatus } from './searchListState';

type SearchResultRowsProps = {
  items: SearchListItem[];
  /** The remote people search's status; rows on screen always win over it. */
  status: SearchStatus;
  /** The active query — gates the "no results" copy to non-trivial searches. */
  searchQuery: string;
  /** Length of what the remote people search is given; 0 when it is off for this query. */
  remoteQueryLength: number;
  /** Re-run the people search after a failure; renders the error state's action. */
  onRetry?: () => void;
};

function SearchUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon="mdi:cloud-off-outline"
      title="Search unavailable"
      subtitle="Couldn't reach the search service."
      action={
        onRetry ? (
          <Button
            text="Try again"
            variant="secondary"
            onPress={onRetry}
            testID="search-error-retry"
          />
        ) : undefined
      }
    />
  );
}

/**
 * The People section's last row when the remote search failed but other rows
 * are on screen: the local matches stay, and this says what is missing.
 */
function PeopleSearchFailedRow({ onRetry }: { onRetry?: () => void }) {
  const muted = useThemeColor('muted');
  return (
    <View
      className="flex-row items-center gap-3 px-4 py-3"
      testID="search-people-error"
      accessibilityLiveRegion="polite">
      <Text size={14} color={muted} className="min-w-0 flex-1">
        {"Couldn't search for more people."}
      </Text>
      {onRetry ? (
        <View className="shrink-0">
          <Button
            text="Try again"
            size="compact"
            variant="secondary"
            onPress={onRetry}
            testID="search-people-error-retry"
          />
        </View>
      ) : null}
    </View>
  );
}

const keyExtractor = (item: SearchListItem) => item.id;

function searchResultItemType(item: SearchListItem): string {
  return item.type === 'person' && item.isLoadingProfile ? 'person-loading' : item.type;
}

function SectionHeader({ title, section }: { title: string; section: string }) {
  const muted = useThemeColor('muted');
  return (
    <View className="px-4 pb-1 pt-5" testID={`search-section-${section}`}>
      <Text bold size={13} color={muted} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

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
        paymentLog.info('contact.geohash.press', { geohash, source: 'search' });
        runAfterNativeSearchDismiss(() => {
          router.push({ pathname: '/geohashChat', params: { geohash } });
        });
      }}
      testID={`contact-row:geohash:${geohash}`}
    />
  );
}

/** A location tier, or the Bluetooth mesh (which needs no location). */
function TierRow({ tier }: { tier: TierEntry }) {
  return (
    <ContactRow
      identity={geohashIdentity(tier.geohash, {
        label: tier.label,
        displayName: tier.displayName,
        transport: tier.transport,
        icon: tier.icon,
      })}
      subtitle={tier.transport === 'ble' ? 'People near you over Bluetooth' : undefined}
      trailingVariant="chevron"
      onPress={() => {
        paymentLog.info('contact.tier.press', {
          tier: tier.key,
          transport: tier.transport,
          source: 'search',
        });
        runAfterNativeSearchDismiss(() => {
          router.push({
            pathname: '/geohashChat',
            params: { geohash: tier.geohash, tierLabel: tier.label, transport: tier.transport },
          });
        });
      }}
      testID={`contact-row:geohash:${tier.geohash}`}
    />
  );
}

function MintRow({ mint }: { mint: Extract<SearchListItem, { type: 'mint' }> }) {
  const displayName = getMintDisplayName(mint.mintUrl, { name: mint.displayName });
  return (
    <ContactRow
      identity={mintIdentity({
        mintUrl: mint.mintUrl,
        displayName,
        iconUrl: mint.iconUrl,
        stats: { kymScore: mint.kymScore, reviewCount: mint.reviewCount },
      })}
      subtitle={mint.owned ? 'In your wallet' : extractDomain(mint.mintUrl)}
      stats={mint.owned ? [] : ['score']}
      trailingVariant="chevron"
      onPress={() => {
        cashuLog.info('mint.search.press', {
          ...mintUrlLogFields(mint.mintUrl),
          source: 'search',
          owned: mint.owned,
        });
        // Hand the destination everything this row is ALREADY showing, so the
        // mint page does not skeleton a name and icon the person can see.
        runAfterNativeSearchDismiss(() => {
          router.push(
            buildMintInfoHref(mint.mintUrl, {
              displayName,
              iconUrl: mint.iconUrl,
              kymScore: mint.kymScore,
              reviewCount: mint.reviewCount,
            })
          );
        });
      }}
      testID={`contact-row:mint:${mint.mintUrl}`}
    />
  );
}

// Tapping a person opens their profile, where Send Money lives.
function PersonRow({ person }: { person: Extract<SearchListItem, { type: 'person' }> }) {
  return (
    <ContactRow
      identity={nostrIdentity(person.pubkey, person.profile, {
        isLoadingProfile: person.isLoadingProfile,
      })}
      titleTrailing={<FollowBadge pubkey={person.pubkey} />}
      // Same height while the profile loads, with a NIP-05, and without one.
      reserveAccentLine
      onPress={() => navigateToProfile(person.pubkey)}
      testID={`contact-row:nostr:${person.pubkey}`}
    />
  );
}

// Skeleton rows for a people search in flight with nothing yet. `ContactRow`
// treats `isLoadingProfile: true` as the skeleton trigger, so the regular
// render path is reused instead of a parallel loader component.
const PLACEHOLDER_DATA: SearchListItem[] = Array.from({ length: 4 }, (_, i) => ({
  type: 'person' as const,
  id: `placeholder-${i}`,
  pubkey: `placeholder-${i}`,
  source: 'search' as const,
  profile: undefined,
  isLoadingProfile: true,
}));

export function SearchResultRows({
  items,
  status,
  searchQuery,
  remoteQueryLength,
  onRetry,
}: SearchResultRowsProps) {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  // One decision from status + what is already on screen: rows always win;
  // placeholders only for a first paint; "no results" only for a settled
  // empty answer; a failed search is an error, never a fake "no results".
  const state = searchListState(
    status,
    items.length,
    searchQuery.trim().length,
    CONTACT_SEARCH_MIN_LENGTH,
    remoteQueryLength
  );
  const showEmptyState = state === 'no-results' || state === 'error';
  const emptyContent =
    state === 'no-results' ? (
      <NoResultsFound />
    ) : state === 'error' ? (
      <SearchUnavailable onRetry={onRetry} />
    ) : null;
  const listData = state === 'placeholders' ? PLACEHOLDER_DATA : state === 'rows' ? items : [];

  const renderItem = ({ item }: { item: SearchListItem }) => {
    switch (item.type) {
      case 'header':
        return <SectionHeader title={item.title} section={item.section} />;
      case 'action':
        return (
          <DetectedActionRow
            descriptor={item.descriptor}
            testIDPrefix="search-action"
            onExecute={() => {
              paymentLog.info('search.action.execute', { kind: item.descriptor.kind });
              // The same canonical entry as Send's paste: identical parse,
              // dedup and `'paste'` tagging, and a fresh generation. Search
              // is a payment root, so stale routing context goes first. The
              // `'search'` source keeps a pasted token out of scan history.
              clearPaymentContext('search.action');
              void machine.scan?.(item.descriptor.raw, { source: 'search', reset: true });
            }}
            onStartContactSend={(target) => {
              paymentLog.info('search.action.contact', { kind: item.descriptor.kind });
              void startContactSend(machine, target, { root: 'search.action' });
            }}
          />
        );
      case 'geohash':
        return <GeohashJumpRow geohash={item.geohash} />;
      case 'tier':
        return <TierRow tier={item.tier} />;
      case 'mint':
        return <MintRow mint={item} />;
      case 'person':
        return <PersonRow person={item} />;
      case 'people-error':
        return <PeopleSearchFailedRow onRetry={onRetry} />;
    }
  };

  return (
    <View className="flex-1">
      <List
        screen
        data={listData}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemType={searchResultItemType}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="always"
        ListEmptyComponent={emptyContent}
        contentContainerClassName={showEmptyState ? 'grow' : undefined}
      />
    </View>
  );
}
