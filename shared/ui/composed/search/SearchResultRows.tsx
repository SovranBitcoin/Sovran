/**
 * @fileoverview Presentational list for heterogeneous search results.
 *
 * Renders a pre-computed `AllSearchResult[]` (people / geohash / tier / mint)
 * through a single `ContactRow`-based dispatcher, with loading skeletons and a
 * "no results" empty state. It takes results as a prop rather than fetching, so
 * the unified search surface can feed it different buckets (All, People, Groups,
 * Mints) from one `useSearchAggregates` call without duplicating queries.
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';

import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import { useVisualListLogger, VISUAL_LIST_VIEWABILITY_CONFIG } from '@/shared/lib/contentShiftLog';
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
import { paymentLog, cashuLog } from '@/shared/lib/logger';
import { NoResultsFound } from '@/features/payments/components/NoResultsFound';
import { CONTACT_SEARCH_MIN_LENGTH } from '@/features/payments/hooks/useContactSearch';
import type { TierEntry } from '@/features/bitchat/hooks/useLocationTiers';

type SearchResultRowsProps = {
  results: AllSearchResult[];
  loading: boolean;
  /** The active query — gates the "no results" copy to non-trivial searches. */
  searchQuery: string;
  ListEmptyComponent?: React.ComponentType;
};

const keyExtractor = (item: AllSearchResult) => item.id;
const SEARCH_RESULTS_VISUAL_SCOPE = 'search.results';

function searchResultItemType(item: AllSearchResult): string {
  return item.type === 'contact' && item.isLoadingProfile ? 'contact-loading' : item.type;
}

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
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
        paymentLog.info('contact.tier.press', {
          tier: tier.key,
          transport: tier.transport,
          source: 'search',
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

export function SearchResultRows({
  results,
  loading,
  searchQuery,
  ListEmptyComponent = NoResultsFound,
}: SearchResultRowsProps) {
  const tabBarPadding = useTabBarBottomPadding();

  const showNoResults = useMemo(() => {
    const trimmed = searchQuery.trim();
    // Mirror useContactSearch's internal rule: short queries don't trigger a
    // real search, so don't flash "no results" at the user.
    if (trimmed.length < CONTACT_SEARCH_MIN_LENGTH) return false;
    if (loading) return false;
    return results.length === 0;
  }, [results.length, loading, searchQuery]);

  const renderSearchResult = useCallback((item: AllSearchResult) => {
    switch (item.type) {
      case 'geohash':
        return <GeohashJumpRow geohash={item.geohash} />;
      case 'tier':
        return <TierRow tier={item.tier} />;
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
  }, []);

  const renderEmpty = useCallback(() => {
    if (showNoResults) return <ListEmptyComponent />;
    return null;
  }, [showNoResults, ListEmptyComponent]);

  // While the search is in flight and we have nothing yet, render skeleton
  // placeholder rows so the feed doesn't look empty. `ContactRow` treats
  // `isLoadingProfile: true` as the skeleton trigger, so we reuse the regular
  // render path instead of a parallel loader component.
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
  const listData = showPlaceholders ? placeholderData : showNoResults ? [] : results;
  const listRef = useRef<LegendListRef>(null);
  const visualList = useVisualListLogger<AllSearchResult>({
    scope: SEARCH_RESULTS_VISUAL_SCOPE,
    surface: 'search',
    component: 'SearchResultRowsList',
    phase: loading ? 'loading' : 'ready',
    extra: {
      loading,
      placeholders: showPlaceholders,
      queryLength: searchQuery.trim().length,
      rows: listData.length,
    },
    getItemKey: (item) => item.id,
    getItemContext: (item) => ({
      rowKey: item.id,
      rowLabel: searchResultItemType(item),
      itemType: searchResultItemType(item),
    }),
    getListState: () => listRef.current?.getState() ?? null,
  });

  const renderItem = useCallback(
    ({ item, index }: { item: AllSearchResult; index: number }) => (
      <VisualLayoutProbe
        scope={SEARCH_RESULTS_VISUAL_SCOPE}
        surface="search"
        component="SearchResultRow"
        itemKey={item.id}
        itemType={searchResultItemType(item)}
        index={index}
        extra={{
          loading,
          placeholders: showPlaceholders,
          queryLength: searchQuery.trim().length,
        }}>
        {renderSearchResult(item)}
      </VisualLayoutProbe>
    ),
    [loading, renderSearchResult, searchQuery, showPlaceholders]
  );

  return (
    <View style={styles.container}>
      <LegendList
        ref={listRef}
        data={listData}
        estimatedItemSize={68}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemType={searchResultItemType}
        onItemSizeChanged={visualList.onItemSizeChanged}
        onLoad={visualList.onLoad}
        onMetricsChange={visualList.onMetricsChange}
        onStickyHeaderChange={visualList.onStickyHeaderChange}
        onViewableItemsChanged={visualList.onViewableItemsChanged}
        viewabilityConfig={VISUAL_LIST_VIEWABILITY_CONFIG}
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
