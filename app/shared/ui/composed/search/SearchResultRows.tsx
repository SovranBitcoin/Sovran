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
import { useTabBarBottomPadding } from '@/shared/hooks/useTabBarBottomPadding';
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

type SearchResultRowsProps = {
  results: AllSearchResult[];
  loading: boolean;
  /** The active query — gates the "no results" copy to non-trivial searches. */
  searchQuery: string;
  ListEmptyComponent?: React.ComponentType;
};

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
  loading,
  searchQuery,
  ListEmptyComponent = NoResultsFound,
}: SearchResultRowsProps) {
  const tabBarPadding = useTabBarBottomPadding();

  // Mirror useContactSearch's internal rule: short queries don't trigger a
  // real search, so don't flash "no results" at the user.
  const showNoResults =
    searchQuery.trim().length >= CONTACT_SEARCH_MIN_LENGTH && !loading && results.length === 0;

  const renderEmpty = () => {
    if (showNoResults) return <ListEmptyComponent />;
    return null;
  };

  const showPlaceholders = loading && results.length === 0 && searchQuery.trim().length >= 2;
  const listData = showPlaceholders ? PLACEHOLDER_DATA : showNoResults ? [] : results;

  return (
    <View style={styles.container}>
      <List
        data={listData}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemType={searchResultItemType}
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
