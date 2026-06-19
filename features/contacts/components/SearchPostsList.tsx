/**
 * "Posts" scope of search: recent posts authored by the people matching the
 * query. The matched pubkeys are supplied by the caller (the unified search
 * aggregates), and the feed client's `getPostsByPubkeys` (deployed `events`
 * resolver) fetches their posts, rendered read-only with `PostCard` — tapping a
 * post opens its thread.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
} from '@legendapp/list/react-native';

import { getFeedClient } from '@/features/feed/data/useFeedClient';
import type { FeedParseResult } from '@/features/feed/data/feedClient';
import { searchPostsCache, searchPostsKey } from '@/features/contacts/data/searchPostsCache';
import {
  DEFAULT_METRICS,
  type FeedEvent,
  type FeedItem,
  type NoteMetrics,
  type ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';
import { PostCard } from '@/features/feed/components/nostr/PostCard';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import {
  remeasureVisualLayoutScope,
  useVisualListLogger,
  VISUAL_LIST_VIEWABILITY_CONFIG,
} from '@/shared/lib/contentShiftLog';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';

const SEARCH_POSTS_VISUAL_SCOPE = 'search.posts.list';

export function SearchPostsList({ pubkeys }: { pubkeys: string[] }) {
  const pubkeysKey = pubkeys.join(',');

  // Warm-navigation seed: if these matched pubkeys were fetched earlier this
  // session, initialise from the cached posts so returning to the Posts tab
  // paints instantly instead of flashing a spinner.
  const initialCacheKey = pubkeys.length ? searchPostsKey(pubkeysKey) : null;
  const seed =
    initialCacheKey && !searchPostsCache.isColdStart(initialCacheKey)
      ? searchPostsCache.getEntry(initialCacheKey)?.data
      : undefined;

  const [noteItems, setNoteItems] = useState<FeedItem[]>(() =>
    seed ? seed.orderedFeedItems.filter((item) => item.type === 'note') : []
  );
  const [metricsMap, setMetricsMap] = useState<Map<string, NoteMetrics>>(
    () => seed?.metricsMap ?? new Map()
  );
  const [profilesMap, setProfilesMap] = useState<Map<string, ProfileInfo>>(
    () => seed?.profilesMap ?? new Map()
  );
  const [quotedMap, setQuotedMap] = useState<Map<string, FeedEvent>>(
    () => seed?.quotedEventsMap ?? new Map()
  );
  const [loading, setLoading] = useState(() => !!initialCacheKey && !seed);

  useEffect(() => {
    if (pubkeys.length === 0) {
      setNoteItems([]);
      return;
    }

    const apply = (res: FeedParseResult) => {
      setNoteItems(res.orderedFeedItems.filter((item) => item.type === 'note'));
      setMetricsMap(res.metricsMap);
      setProfilesMap(res.profilesMap);
      setQuotedMap(res.quotedEventsMap);
    };

    // Warm navigation: paint cached posts for these pubkeys instantly. Fresh →
    // skip the network; stale → revalidate silently (no spinner). Cold → spinner.
    const cacheKey = searchPostsKey(pubkeysKey);
    const cached = searchPostsCache.isColdStart(cacheKey)
      ? undefined
      : searchPostsCache.getEntry(cacheKey);
    if (cached) {
      apply(cached.data);
      setLoading(false);
      if (searchPostsCache.isFresh(cached)) return;
    } else {
      setLoading(true);
    }

    const controller = new AbortController();
    const client = getFeedClient();
    void client
      .getPostsByPubkeys({ pubkeys, limit: 30, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        apply(res);
        searchPostsCache.setEntry(cacheKey, res, { viewerKey: '' });
        searchPostsCache.markTouched(cacheKey);
      })
      .catch(() => {
        /* best-effort; an empty state covers the failure */
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
        client.dispose?.();
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkeysKey]);

  const getMetrics = useMemo(
    () => (id: string) => metricsMap.get(id) ?? DEFAULT_METRICS,
    [metricsMap]
  );

  const visualExtra = useCallback(
    () => ({
      pubkeyCount: pubkeys.length,
      rows: noteItems.length,
      loading,
    }),
    [loading, noteItems.length, pubkeys.length]
  );
  const listRef = useRef<LegendListRef>(null);
  const visualList = useVisualListLogger<FeedItem>({
    scope: SEARCH_POSTS_VISUAL_SCOPE,
    surface: 'search',
    component: 'SearchPostsLegendList',
    phase: loading ? 'loading' : 'ready',
    extra: visualExtra,
    getItemKey: (item, _index, fallbackKey) => (item.type === 'note' ? item.event.id : fallbackKey),
    getItemContext: (item, index) => ({
      itemType: item.type,
      index,
    }),
    getListState: () => listRef.current?.getState() ?? null,
  });

  const renderItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<FeedItem>) => {
      if (item.type !== 'note') return null;
      return (
        <VisualLayoutProbe
          scope={SEARCH_POSTS_VISUAL_SCOPE}
          surface="search"
          component="SearchPostsRow"
          itemKey={item.event.id}
          itemType="note"
          index={index}
          phase={loading ? 'loading' : 'ready'}
          extra={visualExtra}>
          <PostCard
            variant="feed"
            event={item.event}
            metrics={getMetrics(item.event.id)}
            quotedEvents={quotedMap}
            profiles={profilesMap}
            getMetrics={getMetrics}
            showFooterBorder
          />
        </VisualLayoutProbe>
      );
    },
    [getMetrics, loading, profilesMap, quotedMap, visualExtra]
  );

  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    remeasureVisualLayoutScope(SEARCH_POSTS_VISUAL_SCOPE, 'scroll', {
      minIntervalMs: 500,
      maxItems: 24,
      extra: { scrollY: Math.round(event.nativeEvent.contentOffset.y) },
    });
  }, []);

  const renderEmptyPeople = useMemo(
    () => (
      <VisualLayoutProbe
        scope={SEARCH_POSTS_VISUAL_SCOPE}
        surface="search"
        component="SearchPostsEmptyPeople"
        itemKey="empty-people"
        itemType="empty"
        phase="empty"
        style={styles.center}
        extra={visualExtra}>
        <EmptyState
          icon="mdi:magnify"
          title="No people found"
          subtitle="Search for people to see their recent posts."
        />
      </VisualLayoutProbe>
    ),
    [visualExtra]
  );
  const renderEmptyPosts = useMemo(
    () => (
      <VisualLayoutProbe
        scope={SEARCH_POSTS_VISUAL_SCOPE}
        surface="search"
        component="SearchPostsEmptyPosts"
        itemKey="empty-posts"
        itemType="empty"
        phase="empty"
        style={styles.center}
        extra={visualExtra}>
        <EmptyState
          icon="mdi:message-text"
          title="No posts"
          subtitle="The people matching your search haven't posted recently."
        />
      </VisualLayoutProbe>
    ),
    [visualExtra]
  );

  if (pubkeys.length === 0) {
    return renderEmptyPeople;
  }
  if (loading && noteItems.length === 0) {
    return (
      <VisualLayoutProbe
        scope={SEARCH_POSTS_VISUAL_SCOPE}
        surface="search"
        component="SearchPostsInitialSpinner"
        itemKey="initial-spinner"
        itemType="spinner"
        phase="loading"
        style={styles.center}
        extra={visualExtra}>
        <Spinner
          visualScope={SEARCH_POSTS_VISUAL_SCOPE}
          visualSurface="search"
          visualComponent="SearchPostsInitialSpinner"
          visualKey="spinner"
          visualExtra={visualExtra}
        />
      </VisualLayoutProbe>
    );
  }
  if (noteItems.length === 0) {
    return renderEmptyPosts;
  }

  return (
    <LegendList
      ref={listRef}
      data={noteItems}
      keyExtractor={(item) => (item.type === 'note' ? item.event.id : '')}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      onItemSizeChanged={visualList.onItemSizeChanged}
      onLoad={visualList.onLoad}
      onMetricsChange={visualList.onMetricsChange}
      onStickyHeaderChange={visualList.onStickyHeaderChange}
      onScroll={handleScroll}
      onViewableItemsChanged={visualList.onViewableItemsChanged}
      viewabilityConfig={VISUAL_LIST_VIEWABILITY_CONFIG}
      scrollEventThrottle={16}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 24 },
});
