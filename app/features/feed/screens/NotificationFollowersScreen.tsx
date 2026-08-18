import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  type LayoutChangeEvent,
  type ViewToken,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import opacity from 'hex-color-opacity';

import { tryNpubEncode } from '@/features/feed/components/nostr/feedParse';
import type { FeedNotification, FeedNotificationsResult } from '@/features/feed/data/feedClient';
import {
  notificationFollowersCache,
  notificationFollowersKey,
} from '@/features/feed/data/notificationFollowersCache';
import { getFeedClient } from '@/features/feed/data/useFeedClient';
import { takeNotificationFollowersSeed } from '@/features/feed/lib/notificationFollowersSeedCache';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import {
  remeasureVisualLayoutScope,
  useVisualListLogger,
  visualToken,
  visualViewabilityRange,
  VISUAL_LIST_VIEWABILITY_CONFIG,
} from '@/shared/lib/contentShiftLog';
import {
  emptyNotificationsResult,
  filterNotificationsResult,
  mergeNotificationsResult,
} from '@/features/feed/lib/notificationResults';
import { useNotificationPolicyStore } from '@/features/feed/stores/notificationPolicyStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useTabBarBottomPadding } from '@/shared/hooks/useTabBarBottomPadding';
import { formatRelative } from '@/shared/lib/date';
import { feedLog, Log, useLifecycleLogger } from '@/shared/lib/logger';
import { truncateMiddle } from '@/shared/lib/strings';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { Screen } from '@/shared/ui/composed/Screen';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const FOLLOW_PAGE_SIZE = 50;
const FOLLOW_FETCH_MAX_PAGES = 4;
const NOTIFICATION_FOLLOWERS_VISUAL_SCOPE = 'feed.notification_followers.list';

type FollowFetchResult = {
  result: FeedNotificationsResult;
  hasMore: boolean;
};

type VisualFlatListMetrics = {
  contentLength: number | null;
  scroll: number;
  size: number | null;
};

export function NotificationFollowersScreen() {
  useLifecycleLogger('NotificationFollowersScreen', feedLog);

  const params = useLocalSearchParams<{ seedId?: string }>();
  const seedId = typeof params.seedId === 'string' ? params.seedId : undefined;
  const seedRef = useRef<FeedNotificationsResult | null>(null);
  if (seedRef.current === null) {
    seedRef.current = takeNotificationFollowersSeed(seedId);
  }

  const { keys: nostrKeys } = useNostrKeysContext();
  const viewerPubkey = nostrKeys?.pubkey;
  const policy = useNotificationPolicyStore((state) => state.policy);
  const replyScope = useNotificationPolicyStore((state) => state.replyScope);

  // Prefer a one-shot seed handed over by the notifications screen; otherwise
  // fall back to this session's cached Follows page (warm navigation) so a
  // re-entry paints instantly instead of flashing a spinner.
  const warmCached =
    viewerPubkey && !notificationFollowersCache.isColdStart(notificationFollowersKey(viewerPubkey))
      ? notificationFollowersCache.getEntry(notificationFollowersKey(viewerPubkey))?.data
      : undefined;
  const initialResult =
    seedRef.current!.notifications.length > 0 ? seedRef.current! : (warmCached ?? seedRef.current!);

  const [result, setResult] = useState<FeedNotificationsResult>(() => initialResult);
  const [isInitialLoading, setIsInitialLoading] = useState(
    () => initialResult.notifications.length === 0
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const followerListMetricsRef = useRef<VisualFlatListMetrics>({
    contentLength: null,
    scroll: 0,
    size: null,
  });
  // True only for a real seed (fresh from the notifications screen → no fetch on
  // first focus). A warm-cache-derived initialResult stays false so the focus
  // effect runs loadFirstPage and applies the SWR isFresh gate.
  const seededInitialPageRef = useRef(seedRef.current!.notifications.length > 0);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(initialResult.paginationUntil > 0);
  const paginationUntilRef = useRef(initialResult.paginationUntil);

  // Persist a freshly-handed-over seed into the session cache once, so the next
  // focus / re-mount reads it as a warm page instead of refetching. Only write
  // a real seed (not a value we just read back from the cache).
  useEffect(() => {
    if (viewerPubkey && seedRef.current && seedRef.current.notifications.length > 0) {
      const key = notificationFollowersKey(viewerPubkey);
      notificationFollowersCache.setEntry(key, seedRef.current, { viewerKey: viewerPubkey });
      notificationFollowersCache.markTouched(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tabBarPadding = useTabBarBottomPadding();
  const [foreground, surface, separator, muted, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
    'muted',
    'surface-tertiary',
  ] as const);

  const fetchFollowPages = useCallback(
    async ({
      signal,
      until,
      refresh,
    }: {
      signal: AbortSignal;
      until?: number;
      refresh?: boolean;
    }): Promise<FollowFetchResult | null> => {
      if (!viewerPubkey) return null;
      const client = getFeedClient();
      let cursor = until;
      let merged = emptyNotificationsResult();
      let hasMore = false;

      try {
        for (let pageIndex = 0; pageIndex < FOLLOW_FETCH_MAX_PAGES; pageIndex += 1) {
          const page = await client.getNotifications({
            viewerPubkey,
            tab: 'ALL',
            policy,
            replyScope,
            limit: FOLLOW_PAGE_SIZE,
            until: cursor,
            refresh: refresh && pageIndex === 0,
            // The detail screen needs the full ungrouped follow list, not the
            // collapsed group the All tab renders.
            grouped: false,
            signal,
          });
          if (signal.aborted) return null;

          const followPage = filterNotificationsResult(
            page,
            (notification) => notification.reason === 'follow'
          );
          merged = mergeNotificationsResult(merged, followPage);
          merged.paginationUntil = page.paginationUntil;
          hasMore = page.paginationUntil > 0 && page.notifications.length >= FOLLOW_PAGE_SIZE;
          cursor = page.paginationUntil;

          if (followPage.notifications.length > 0 || !hasMore || cursor <= 0) break;
        }
      } finally {
        client.dispose?.();
      }

      return { result: merged, hasMore };
    },
    [policy, replyScope, viewerPubkey]
  );

  const applyFirstPage = useCallback((page: FollowFetchResult | null) => {
    const next = page?.result ?? emptyNotificationsResult();
    paginationUntilRef.current = next.paginationUntil;
    hasMoreRef.current = !!page?.hasMore;
    setResult(next);
  }, []);

  const loadFirstPage = useCallback(
    (signal: AbortSignal, mode: 'initial' | 'refresh') => {
      const sequence = ++loadSequenceRef.current;
      if (!viewerPubkey) {
        applyFirstPage(null);
        setErrorMessage(null);
        setIsInitialLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
        return;
      }

      const cacheKey = notificationFollowersKey(viewerPubkey);

      // Warm navigation (key touched earlier this session): paint the cached
      // page instantly. If still fresh, that paint is authoritative — skip the
      // network. Cold start: show the spinner, never a stale first paint.
      let paintedFromCache = false;
      if (mode === 'initial') {
        const cached = notificationFollowersCache.isColdStart(cacheKey)
          ? undefined
          : notificationFollowersCache.getEntry(cacheKey);
        if (cached) {
          applyFirstPage({ result: cached.data, hasMore: cached.data.paginationUntil > 0 });
          setIsInitialLoading(false);
          paintedFromCache = true;
          if (notificationFollowersCache.isFresh(cached)) {
            setErrorMessage(null);
            return;
          }
        } else {
          setResult(emptyNotificationsResult());
          setIsInitialLoading(true);
        }
      } else {
        setIsRefreshing(true);
      }
      setErrorMessage(null);

      // Only an explicit pull-to-refresh forces nagg to revalidate; an initial
      // focus reads the shared response cache (stale entries revalidate in the
      // background), so opening the screen avoids a full recompute each mount.
      void fetchFollowPages({ signal, refresh: mode === 'refresh' })
        .then((page) => {
          if (signal.aborted || sequence !== loadSequenceRef.current) return;
          applyFirstPage(page);
          if (page) {
            notificationFollowersCache.setEntry(cacheKey, page.result, { viewerKey: viewerPubkey });
            notificationFollowersCache.markTouched(cacheKey);
          }
        })
        .catch((error) => {
          if (signal.aborted || sequence !== loadSequenceRef.current) return;
          const message = error instanceof Error ? error.message : String(error);
          feedLog.warn('feed.notification_followers.load_failed', { message });
          setErrorMessage(message);
          // Keep the warm-painted page on a transient revalidate failure.
          if (mode === 'initial' && !paintedFromCache) applyFirstPage(null);
        })
        .finally(() => {
          if (signal.aborted || sequence !== loadSequenceRef.current) return;
          if (mode === 'initial') setIsInitialLoading(false);
          else setIsRefreshing(false);
        });
    },
    [applyFirstPage, fetchFollowPages, viewerPubkey]
  );

  useFocusEffect(
    useCallback(() => {
      if (seededInitialPageRef.current) {
        seededInitialPageRef.current = false;
        setIsInitialLoading(false);
        return () => {
          refreshControllerRef.current?.abort();
          refreshControllerRef.current = null;
          loadSequenceRef.current += 1;
        };
      }

      const controller = new AbortController();
      loadFirstPage(controller.signal, 'initial');
      return () => {
        controller.abort();
        refreshControllerRef.current?.abort();
        refreshControllerRef.current = null;
        loadSequenceRef.current += 1;
      };
    }, [loadFirstPage])
  );

  const handleRefresh = useCallback(() => {
    if (isRefreshing) return;
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    loadFirstPage(controller.signal, 'refresh');
  }, [isRefreshing, loadFirstPage]);

  const loadMoreFollowers = useCallback(async () => {
    if (
      loadingMoreRef.current ||
      isInitialLoading ||
      isRefreshing ||
      !viewerPubkey ||
      !hasMoreRef.current ||
      paginationUntilRef.current <= 0
    ) {
      return;
    }

    const sequence = loadSequenceRef.current;
    const controller = new AbortController();
    const cursor = paginationUntilRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const page = await fetchFollowPages({
        signal: controller.signal,
        until: cursor,
        refresh: false,
      });
      if (!page || controller.signal.aborted || sequence !== loadSequenceRef.current) return;

      paginationUntilRef.current = page.result.paginationUntil;
      hasMoreRef.current = page.hasMore;
      setResult((previous) => mergeNotificationsResult(previous, page.result));
    } catch (error) {
      if (controller.signal.aborted || sequence !== loadSequenceRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      feedLog.warn('feed.notification_followers.load_more_failed', { message });
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [fetchFollowPages, isInitialLoading, isRefreshing, viewerPubkey]);

  const openProfile = useCallback((notification: FeedNotification) => {
    router.push({
      pathname: '/(user-flow)/profile',
      params: { pubkey: notification.event.pubkey },
    });
  }, []);

  const followers = result.notifications;
  const visualPhase = isInitialLoading ? 'initial-loading' : isRefreshing ? 'refreshing' : 'ready';
  const {
    onMetricsChange: onVisualListMetricsChange,
    onViewableItemsChanged: onVisualViewableItemsChanged,
  } = useVisualListLogger<FeedNotification>({
    scope: NOTIFICATION_FOLLOWERS_VISUAL_SCOPE,
    surface: 'notifications',
    component: 'NotificationFollowersFlatList',
    phase: visualPhase,
    extra: () => ({
      followers: followers.length,
      rows: followers.length,
      loadingMore: isLoadingMore,
    }),
    getItemKey: (notification) => `follower:${notification.event.id}`,
    getItemContext: (notification) => ({
      itemType: notification.reason,
      rowLabel: notification.reason,
    }),
  });
  const reportFollowerListMetrics = useCallback(
    (reason: string) => {
      const metrics = followerListMetricsRef.current;
      onVisualListMetricsChange({
        reason,
        size: metrics.size,
        scroll: metrics.scroll,
        scrollLength: metrics.size,
        contentLength: metrics.contentLength,
      });
    },
    [onVisualListMetricsChange]
  );
  const handleListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      followerListMetricsRef.current.size = event.nativeEvent.layout.height;
      reportFollowerListMetrics('layout');
    },
    [reportFollowerListMetrics]
  );
  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      followerListMetricsRef.current.contentLength = height;
      reportFollowerListMetrics('content-size');
    },
    [reportFollowerListMetrics]
  );
  const handleListViewableItemsChanged = useCallback(
    ({ viewableItems, changed }: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      onVisualViewableItemsChanged({
        ...visualViewabilityRange([...viewableItems, ...changed]),
        viewableItems: viewableItems.map(visualToken<FeedNotification>),
        changed: changed.map(visualToken<FeedNotification>),
      });
    },
    [onVisualViewableItemsChanged]
  );
  const handleListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      followerListMetricsRef.current = {
        contentLength: contentSize.height,
        scroll: contentOffset.y,
        size: layoutMeasurement.height,
      };
      reportFollowerListMetrics('scroll');
      remeasureVisualLayoutScope(NOTIFICATION_FOLLOWERS_VISUAL_SCOPE, 'scroll', {
        extra: {
          phase: visualPhase,
          followers: followers.length,
          loadingMore: isLoadingMore,
        },
      });
    },
    [followers.length, isLoadingMore, reportFollowerListMetrics, visualPhase]
  );

  return (
    <Screen name="NotificationFollowersScreen" scroll="custom" bgColor={surface}>
      <Log name="NotificationFollowersContent" style={styles.root}>
        <FlatList
          data={followers}
          keyExtractor={(notification) => notification.event.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: tabBarPadding },
            followers.length === 0 && styles.emptyListContent,
          ]}
          contentInsetAdjustmentBehavior="never"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={foreground}
            />
          }
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: separator }]} />
          )}
          ListEmptyComponent={
            isInitialLoading ? (
              <VisualLayoutProbe
                scope={NOTIFICATION_FOLLOWERS_VISUAL_SCOPE}
                surface="notifications"
                component="NotificationFollowersInitialSpinner"
                itemKey="empty:initial-spinner"
                itemType="spinner"
                extra={{ phase: visualPhase }}>
                <Spinner size={22} color={opacity(foreground, 0.65)} style={styles.loader} />
              </VisualLayoutProbe>
            ) : (
              <VisualLayoutProbe
                scope={NOTIFICATION_FOLLOWERS_VISUAL_SCOPE}
                surface="notifications"
                component="NotificationFollowersEmptyState"
                itemKey={errorMessage ? 'empty:error' : 'empty:no-results'}
                itemType={errorMessage ? 'error' : 'empty'}
                extra={{ viewerReady: !!viewerPubkey }}>
                <EmptyFollowers errorMessage={errorMessage} foreground={foreground} muted={muted} />
              </VisualLayoutProbe>
            )
          }
          ListFooterComponent={
            // Only when there's content — never stacked on the empty/initial spinner.
            isLoadingMore && followers.length > 0 ? (
              <VisualLayoutProbe
                scope={NOTIFICATION_FOLLOWERS_VISUAL_SCOPE}
                surface="notifications"
                component="NotificationFollowersPaginationSpinner"
                itemKey="footer:pagination-spinner"
                itemType="spinner"
                extra={{ followers: followers.length }}>
                <Spinner size={18} color={opacity(foreground, 0.65)} style={styles.footerSpinner} />
              </VisualLayoutProbe>
            ) : null
          }
          onLayout={handleListLayout}
          onContentSizeChange={handleContentSizeChange}
          onEndReached={loadMoreFollowers}
          onEndReachedThreshold={0.4}
          onScroll={handleListScroll}
          scrollEventThrottle={250}
          viewabilityConfig={VISUAL_LIST_VIEWABILITY_CONFIG}
          onViewableItemsChanged={handleListViewableItemsChanged}
          renderItem={({ item, index }) => (
            <VisualLayoutProbe
              scope={NOTIFICATION_FOLLOWERS_VISUAL_SCOPE}
              surface="notifications"
              component="NotificationFollowerRow"
              itemKey={`follower:${item.event.id}`}
              itemType={item.reason}
              index={index}
              extra={{ phase: visualPhase }}>
              <FollowerRow
                notification={item}
                result={result}
                foreground={foreground}
                muted={muted}
                pressedBackground={opacity(surfaceTertiary, 0.45)}
                onPress={() => openProfile(item)}
              />
            </VisualLayoutProbe>
          )}
        />
      </Log>
    </Screen>
  );
}

function FollowerRow({
  notification,
  result,
  foreground,
  muted,
  pressedBackground,
  onPress,
}: {
  notification: FeedNotification;
  result: FeedNotificationsResult;
  foreground: string;
  muted: string;
  pressedBackground: string;
  onPress: () => void;
}) {
  const profile = result.profilesMap.get(notification.event.pubkey);
  const npub = tryNpubEncode(notification.event.pubkey);
  const displayPubkey = truncateMiddle(npub || notification.event.pubkey, 10);
  const name = profile?.name || displayPubkey;
  const timestamp = formatFollowTimestamp(notification.event.created_at);

  return (
    <Pressable
      accessibilityRole="button"
      haptics
      activeOpacity={1}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: pressedBackground }]}>
      <HStack align="center" gap={12}>
        <Avatar
          state={profile?.picture ? 'image' : 'fallback'}
          picture={profile?.picture}
          name={name}
          seed={notification.event.pubkey}
          size={46}
        />
        <VStack gap={3} flex={1}>
          <HStack align="flex-start" justify="space-between" gap={8} style={styles.titleLine}>
            <Text numberOfLines={2} size={16} style={[styles.titleText, { color: foreground }]}>
              {name} followed you
            </Text>
            {timestamp ? (
              <Text numberOfLines={1} size={13} style={[styles.timestampText, { color: muted }]}>
                {timestamp}
              </Text>
            ) : null}
          </HStack>
          <Text size={13} numberOfLines={1} style={{ color: muted }}>
            {displayPubkey}
          </Text>
        </VStack>
      </HStack>
    </Pressable>
  );
}

function formatFollowTimestamp(createdAt: number): string {
  return createdAt > 0 ? formatRelative(createdAt * 1000, 'compact') : '';
}

function EmptyFollowers({
  errorMessage,
  foreground,
  muted,
}: {
  errorMessage: string | null;
  foreground: string;
  muted: string;
}) {
  return (
    <VStack align="center" gap={10} style={styles.emptyState}>
      <Text size={18} bold style={{ color: foreground, textAlign: 'center' }}>
        {errorMessage ? 'Follows unavailable' : 'No follows'}
      </Text>
      <Text size={14} style={{ color: muted, textAlign: 'center' }}>
        {errorMessage ?? 'Follow notifications will appear here.'}
      </Text>
    </VStack>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 8,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  titleLine: {
    width: '100%',
  },
  titleText: {
    flex: 1,
    minWidth: 0,
  },
  timestampText: {
    flexShrink: 0,
    paddingTop: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 78,
  },
  emptyState: {
    paddingHorizontal: 28,
  },
  loader: {
    alignSelf: 'center',
  },
  footerSpinner: {
    alignSelf: 'center',
    marginVertical: 18,
  },
});
