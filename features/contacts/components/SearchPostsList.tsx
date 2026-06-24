/**
 * "Posts" scope of search: recent posts authored by the people matching the
 * query. The matched pubkeys are supplied by the caller (the unified search
 * aggregates), and the feed client's `getPostsByPubkeys` (deployed `events`
 * resolver) fetches their posts, rendered read-only with `PostCard` — tapping a
 * post opens its thread.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { List } from '@/shared/ui/composed/List';
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

  const renderItem = ({ item }: { item: FeedItem }) => {
    if (item.type !== 'note') return null;
    return (
      <PostCard
        variant="feed"
        event={item.event}
        metrics={getMetrics(item.event.id)}
        quotedEvents={quotedMap}
        profiles={profilesMap}
        getMetrics={getMetrics}
        showFooterBorder
      />
    );
  };

  const renderEmptyPeople = (
    <View style={styles.center}>
      <EmptyState
        icon="mdi:magnify"
        title="No people found"
        subtitle="Search for people to see their recent posts."
      />
    </View>
  );
  const renderEmptyPosts = (
    <View style={styles.center}>
      <EmptyState
        icon="mdi:message-text"
        title="No posts"
        subtitle="The people matching your search haven't posted recently."
      />
    </View>
  );

  if (pubkeys.length === 0) {
    return renderEmptyPeople;
  }
  if (loading && noteItems.length === 0) {
    return (
      <View style={styles.center}>
        <Spinner />
      </View>
    );
  }
  if (noteItems.length === 0) {
    return renderEmptyPosts;
  }

  return (
    <List
      data={noteItems}
      keyExtractor={(item) => (item.type === 'note' ? item.event.id : '')}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 24 },
});
