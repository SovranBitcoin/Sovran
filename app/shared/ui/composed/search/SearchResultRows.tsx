/**
 * @fileoverview Presentational list for heterogeneous search results.
 *
 * Renders a pre-computed `AllSearchResult[]` (people / geohash / tier / mint)
 * through a single `ContactRow`-based dispatcher, with loading skeletons and a
 * "no results" empty state. It takes results as a prop rather than fetching, so
 * the unified search surface can feed it different buckets (All, People, Groups,
 * Mints) from one `useSearchAggregates` call without duplicating queries.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';

import { List } from '@/shared/ui/composed/List';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import type { AllSearchResult } from '@/features/contacts/hooks/useAllSearchResults';
import {
  ContactRow,
  geohashIdentity,
  mintIdentity,
  nostrIdentity,
} from '@/shared/ui/composed/ContactRow';
import { FollowBadge } from '@/shared/ui/composed/FollowBadge';
import { navigateToProfile } from '@/features/contacts/lib/navigateToProfile';
import { buildMintInfoHref } from '@/shared/lib/nav/mintInfoRoutes';
import { extractDomain, getMintDisplayName } from '@/shared/lib/url';
import { paymentLog, cashuLog, mintUrlLogFields } from '@/shared/lib/logger';
import { NoResultsFound } from '@/features/payments/components/NoResultsFound';
import { CONTACT_SEARCH_MIN_LENGTH } from '@/shared/lib/contactSearch';
import type { TierEntry } from '@/features/bitchat/hooks/useLocationTiers';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { Button } from '@/shared/ui/primitives/Button';
import { searchListState, type SearchStatus } from './searchListState';

type SearchResultRowsProps = {
  results: AllSearchResult[];
  /** The scope's read status; rows on screen always win over it. */
  status: SearchStatus;
  /** The active query — gates the "no results" copy to non-trivial searches. */
  searchQuery: string;
  /** Re-run the read after a failure; renders the error state's action. */
  onRetry?: () => void;
  ListEmptyComponent?: React.ComponentType;
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

const keyExtractor = (item: AllSearchResult) => item.id;

function searchResultItemType(item: AllSearchResult): string {
  return item.type === 'contact' && item.isLoadingProfile ? 'contact-loading' : item.type;
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
        router.push({ pathname: '/(user-flow)/geohashChat', params: { geohash } });
      }}
      testID={`contact-row:geohash:${geohash}`}
    />
  );
}

/** Geohash location-tier row — shared by the search results and the Contacts
 * Groups tab; `source` is telemetry only. */
export function TierRow({ tier, source }: { tier: TierEntry; source: 'search' | 'contacts' }) {
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
          source,
        });
        router.push({
          pathname: '/(user-flow)/geohashChat',
          params: { geohash: tier.geohash, tierLabel: tier.label, transport: tier.transport },
        });
      }}
      testID={`contact-row:geohash:${tier.geohash}`}
    />
  );
}

function MintRow({ mint }: { mint: Extract<AllSearchResult, { type: 'mint' }>['mint'] }) {
  const info = (mint.info ?? {}) as { icon_url?: string | null; name?: string };
  return (
    <ContactRow
      identity={mintIdentity({
        mintUrl: mint.url,
        displayName: getMintDisplayName(mint.url, info),
        iconUrl: info.icon_url ?? undefined,
        stats: { kymScore: mint.review_score ?? undefined, reviewCount: mint.review_count },
      })}
      subtitle={extractDomain(mint.url)}
      stats={['score']}
      trailingVariant="chevron"
      onPress={() => {
        cashuLog.info('mint.search.press', { ...mintUrlLogFields(mint.url), source: 'search' });
        router.push(buildMintInfoHref(mint.url));
      }}
      testID={`contact-row:mint:${mint.url}`}
    />
  );
}

function renderSearchResult(item: AllSearchResult) {
  switch (item.type) {
    case 'geohash':
      return <GeohashJumpRow geohash={item.geohash} />;
    case 'tier':
      return <TierRow tier={item.tier} source="search" />;
    case 'mint':
      return <MintRow mint={item.mint} />;
    case 'contact':
      return (
        <ContactRow
          identity={nostrIdentity(item.pubkey, item.profile, {
            isLoadingProfile: item.isLoadingProfile,
          })}
          titleTrailing={<FollowBadge pubkey={item.pubkey} />}
          onPress={() => navigateToProfile(item.pubkey)}
          testID={`contact-row:nostr:${item.pubkey}`}
        />
      );
  }
}

const renderItem = ({ item }: { item: AllSearchResult }) => renderSearchResult(item);

// Skeleton rows for a search in flight with nothing yet. `ContactRow` treats
// `isLoadingProfile: true` as the skeleton trigger, so the regular render path
// is reused instead of a parallel loader component.
const PLACEHOLDER_DATA: AllSearchResult[] = Array.from({ length: 4 }, (_, i) => ({
  type: 'contact' as const,
  id: `placeholder-${i}`,
  pubkey: `placeholder-${i}`,
  profile: undefined,
  isLoadingProfile: true,
  score: 0,
}));

export function SearchResultRows({
  results,
  status,
  searchQuery,
  onRetry,
  ListEmptyComponent = NoResultsFound,
}: SearchResultRowsProps) {
  // One decision from status + what is already on screen: rows always win;
  // placeholders only for a first paint; "no results" only for a settled
  // empty answer; a failed search is an error, never a fake "no results".
  const state = searchListState(
    status,
    results.length,
    searchQuery.trim().length,
    CONTACT_SEARCH_MIN_LENGTH
  );
  const showEmptyState = state === 'no-results' || state === 'error';

  const renderEmpty = () => {
    if (state === 'no-results') return <ListEmptyComponent />;
    if (state === 'error') return <SearchUnavailable onRetry={onRetry} />;
    return null;
  };

  const listData = state === 'placeholders' ? PLACEHOLDER_DATA : state === 'rows' ? results : [];

  return (
    <View style={styles.container}>
      <List
        screen
        data={listData}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemType={searchResultItemType}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="always"
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={showEmptyState ? styles.emptyList : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyList: { flexGrow: 1 },
});
