/**
 * "Posts" scope of search: recent posts authored by the people matching the
 * query. The matched pubkeys are supplied by the caller (the unified search
 * aggregates), and the feed client's `getPostsByPubkeys` fetches their posts,
 * rendered read-only with `PostCard` — tapping a post opens its thread.
 *
 * The read is `useCachedRead` over `searchPostsCache`: returning to the Posts
 * tab for the same people paints at 0ms (fresh → no round-trip, stale →
 * silent revalidate); a tier-exhausted answer is an error with a retry, not
 * "no posts" (SYSTEM.md F06).
 */
import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useShallowMemo } from '@/shared/hooks/useShallowMemo';
import { List } from '@/shared/ui/composed/List';
import { getFeedClient } from '@/features/feed/data/useFeedClient';
import { readIsUnavailable, type FeedParseResult } from '@/features/feed/data/feedClient';
import { searchPostsCache, searchPostsKey } from '@/features/contacts/data/searchPostsCache';
import { DEFAULT_METRICS, type FeedItem } from '@/features/feed/components/nostr/feedTypes';
import { PostCard } from '@/features/feed/components/nostr/PostCard';
import { useCachedRead } from '@/shared/lib/read/useCachedRead';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { Button } from '@/shared/ui/primitives/Button';
import { Spinner } from '@/shared/ui/primitives/Spinner';

/** One posts read; a client per call, disposed after. Module-level so the
 *  try/finally stays out of the component (React Compiler cannot lower it). */
async function fetchPostsByPubkeys(
  pubkeys: string[],
  signal: AbortSignal | undefined,
  readId: string
): Promise<{ data: FeedParseResult }> {
  const client = getFeedClient();
  try {
    const res = await client.getPostsByPubkeys({ pubkeys, limit: 30, signal, readId });
    // Do not cache an unavailable answer: the next open should retry.
    if (readIsUnavailable(res.read)) throw new Error('posts unavailable');
    return { data: res };
  } finally {
    client.dispose?.();
  }
}

export function SearchPostsList({ pubkeys }: { pubkeys: string[] }) {
  // Stabilised by content, not identity: callers rebuild the array on every
  // render, and the read below must not refire for an equal list.
  const stablePubkeys = useShallowMemo(pubkeys);
  const pubkeysKey = stablePubkeys.join(',');

  const read = useCachedRead<FeedParseResult>({
    store: searchPostsCache,
    surface: 'searchPosts',
    key: stablePubkeys.length ? searchPostsKey(pubkeysKey) : null,
    viewerKey: '',
    focusRevalidate: false,
    classify: (res) =>
      readIsUnavailable(res.read)
        ? 'error'
        : res.orderedFeedItems.some((item) => item.type === 'note')
          ? 'ready'
          : 'empty',
    fetcher: ({ signal, readId }) => fetchPostsByPubkeys(stablePubkeys, signal, readId),
  });

  const noteItems = useMemo(
    () => (read.data?.orderedFeedItems ?? []).filter((item) => item.type === 'note'),
    [read.data]
  );
  const metricsMap = read.data?.metricsMap;
  const profilesMap = read.data?.profilesMap;
  const quotedMap = read.data?.quotedEventsMap;

  const getMetrics = useMemo(
    () => (id: string) => metricsMap?.get(id) ?? DEFAULT_METRICS,
    [metricsMap]
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      if (item.type !== 'note') return null;
      return (
        <PostCard
          variant="feed"
          event={item.event}
          metrics={getMetrics(item.event.id)}
          quotedEvents={quotedMap ?? EMPTY_QUOTED}
          profiles={profilesMap ?? EMPTY_PROFILES}
          getMetrics={getMetrics}
          showFooterBorder
        />
      );
    },
    [getMetrics, profilesMap, quotedMap]
  );

  if (pubkeys.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="mdi:magnify"
          title="No people found"
          subtitle="Search for people to see their recent posts."
        />
      </View>
    );
  }
  if (noteItems.length === 0) {
    if (read.status === 'error') {
      return (
        <View style={styles.center}>
          <EmptyState
            icon="mdi:cloud-off-outline"
            title="Posts unavailable"
            subtitle="Couldn't load recent posts right now."
            action={
              <Button
                text="Try again"
                variant="secondary"
                onPress={read.refresh}
                testID="search-posts-retry"
              />
            }
          />
        </View>
      );
    }
    if (read.status === 'empty' || read.status === 'ready') {
      return (
        <View style={styles.center}>
          <EmptyState
            icon="mdi:message-text"
            title="No posts"
            subtitle="The people matching your search haven't posted recently."
          />
        </View>
      );
    }
    return (
      <View style={styles.center}>
        <Spinner />
      </View>
    );
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

const EMPTY_QUOTED: FeedParseResult['quotedEventsMap'] = new Map();
const EMPTY_PROFILES: FeedParseResult['profilesMap'] = new Map();

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 24 },
});
