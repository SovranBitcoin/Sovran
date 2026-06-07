import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import opacity from 'hex-color-opacity';

import Icon from '@/assets/icons';
import type {
  FeedNotification,
  FeedNotificationTab,
  FeedNotificationsResult,
} from '@/features/feed/data/feedClient';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import { getFeedClient } from '@/features/feed/data/useFeedClient';
import {
  notificationsPageCache,
  notificationsPageKey,
} from '@/features/feed/data/notificationsCache';
import {
  notificationReasonLabel,
  notificationReplyScopeLabel,
} from '@/features/feed/lib/notificationCopy';
import { seedNotificationFollowers } from '@/features/feed/lib/notificationFollowersSeedCache';
import { mergeNotificationsResult } from '@/features/feed/lib/notificationResults';
import {
  buildNotificationListItems,
  type NotificationListItem,
} from '@/features/feed/lib/notificationGroups';
import { seedThread } from '@/features/feed/lib/threadSeedCache';
import { useNotificationPolicyStore } from '@/features/feed/stores/notificationPolicyStore';
import { FeedTabButton } from '@/features/feed/components/FeedTabButton';
import { formatDate, formatRelative } from '@/shared/lib/date';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { feedLog, Log, useLifecycleLogger } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useTabBarBottomPadding } from '@/shared/hooks/useTabBarBottomPadding';
import { actionMenuPopup } from '@/shared/lib/popup';
import { Screen } from '@/shared/ui/composed/Screen';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

// `APP` is a client-only tab (app announcements like the welcome card); it never
// hits the server. ALL/MENTIONS are the server-backed tabs.
type NotificationTab = FeedNotificationTab | 'APP';

const NOTIFICATION_TABS: { id: NotificationTab; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'MENTIONS', label: 'Mentions' },
  { id: 'APP', label: 'App' },
];

const NOTIFICATIONS_PAGE_SIZE = 50;
const MAX_GROUP_AVATARS = 3;

type LoadMode = 'initial' | 'refresh';

export function NotificationsScreen() {
  useLifecycleLogger('NotificationsScreen', feedLog);

  const { keys: nostrKeys } = useNostrKeysContext();
  const viewerPubkey = nostrKeys?.pubkey;
  const policy = useNotificationPolicyStore((state) => state.policy);
  const replyScope = useNotificationPolicyStore((state) => state.replyScope);
  const setReplyScope = useNotificationPolicyStore((state) => state.setReplyScope);
  const [activeTab, setActiveTab] = useState<NotificationTab>('ALL');
  const [result, setResult] = useState<FeedNotificationsResult | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const paginationUntilRef = useRef(0);
  const tabBarPadding = useTabBarBottomPadding();
  const [foreground, surface, separator, muted, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
    'muted',
    'surface-tertiary',
  ] as const);

  const fetchNotificationsPage = useCallback(
    async ({
      signal,
      until,
      refresh,
    }: {
      signal: AbortSignal;
      until?: number;
      refresh?: boolean;
    }) => {
      // The App tab is client-only (synthetic announcements) — never fetch.
      if (!viewerPubkey || activeTab === 'APP') return null;
      const client = getFeedClient();
      try {
        return await client.getNotifications({
          viewerPubkey,
          tab: activeTab,
          policy,
          replyScope,
          limit: NOTIFICATIONS_PAGE_SIZE,
          until,
          refresh,
          signal,
        });
      } finally {
        client.dispose?.();
      }
    },
    [activeTab, policy, replyScope, viewerPubkey]
  );

  const applyFirstPage = useCallback((page: FeedNotificationsResult | null) => {
    paginationUntilRef.current = page?.paginationUntil ?? 0;
    hasMoreRef.current =
      !!page && page.paginationUntil > 0 && page.notifications.length >= NOTIFICATIONS_PAGE_SIZE;
    feedLog.info('feed.notifications.ui.applied', {
      notifications: page?.notifications.length ?? 0,
      hasPage: !!page,
      paginationUntil: page?.paginationUntil ?? 0,
    });
    setResult(page);
  }, []);

  const loadFirstPage = useCallback(
    (signal: AbortSignal, mode: LoadMode) => {
      const sequence = ++loadSequenceRef.current;
      // No viewer, or the client-only App tab → nothing to fetch; the synthetic
      // items (welcome card) render without a server round-trip.
      if (!viewerPubkey || activeTab === 'APP') {
        applyFirstPage(null);
        setErrorMessage(null);
        setIsInitialLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
        return;
      }

      const cacheKey = notificationsPageKey({ viewerPubkey, tab: activeTab, policy, replyScope });

      // Warm navigation (key touched earlier this session): paint the cached
      // page instantly and revalidate. Cold start (first focus this session):
      // show loading, never a stale first paint.
      let paintedFromCache = false;
      if (mode === 'initial') {
        const cached = notificationsPageCache.isColdStart(cacheKey)
          ? undefined
          : notificationsPageCache.getEntry(cacheKey);
        if (cached) {
          applyFirstPage(cached.data);
          setIsInitialLoading(false);
          paintedFromCache = true;
        } else {
          setResult(null);
          setIsInitialLoading(true);
        }
      } else {
        setIsRefreshing(true);
      }
      setErrorMessage(null);

      // Only an explicit pull-to-refresh forces nagg to revalidate. An initial
      // focus reads the shared response cache (which auto-revalidates a stale
      // entry in the background), so opening the screen no longer pays the full
      // recompute cost on every mount.
      void fetchNotificationsPage({ signal, refresh: mode === 'refresh' })
        .then((page) => {
          if (signal.aborted || sequence !== loadSequenceRef.current) return;
          applyFirstPage(page);
          if (page) notificationsPageCache.setEntry(cacheKey, page, { viewerKey: viewerPubkey });
          notificationsPageCache.markTouched(cacheKey);
        })
        .catch((error) => {
          if (signal.aborted || sequence !== loadSequenceRef.current) return;
          const message = error instanceof Error ? error.message : String(error);
          feedLog.warn('feed.notifications.load_failed', { message });
          setErrorMessage(message);
          // Keep the warm-painted page on a transient failure.
          if (mode === 'initial' && !paintedFromCache) applyFirstPage(null);
        })
        .finally(() => {
          if (signal.aborted || sequence !== loadSequenceRef.current) return;
          if (mode === 'initial') setIsInitialLoading(false);
          else setIsRefreshing(false);
        });
    },
    [applyFirstPage, fetchNotificationsPage, viewerPubkey, activeTab, policy, replyScope]
  );

  useFocusEffect(
    useCallback(() => {
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

  const loadMoreNotifications = useCallback(async () => {
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
    const cursor = paginationUntilRef.current;
    const controller = new AbortController();
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const page = await fetchNotificationsPage({
        signal: controller.signal,
        until: cursor,
        refresh: false,
      });
      if (!page || controller.signal.aborted || sequence !== loadSequenceRef.current) return;

      if (page.notifications.length === 0 || page.paginationUntil <= 0) {
        hasMoreRef.current = false;
        return;
      }

      paginationUntilRef.current = page.paginationUntil;
      hasMoreRef.current = page.notifications.length >= NOTIFICATIONS_PAGE_SIZE;
      setResult((previous) => mergeNotificationsResult(previous, page));
    } catch (error) {
      if (controller.signal.aborted || sequence !== loadSequenceRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      feedLog.warn('feed.notifications.load_more_failed', { message });
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [fetchNotificationsPage, isInitialLoading, isRefreshing, viewerPubkey]);

  const selectTab = useCallback(
    (tab: NotificationTab) => {
      if (tab === activeTab) return;
      paginationUntilRef.current = 0;
      hasMoreRef.current = false;
      setResult(null);
      setErrorMessage(null);
      setIsLoadingMore(false);
      setIsInitialLoading(true);
      setActiveTab(tab);
    },
    [activeTab]
  );

  // Direct/Thread reply-scope picker for the Mentions tab. Mirrors the Following
  // feed tab: the Mentions pill shows a chevron and opens this popup when active.
  const openReplyScopeMenu = useCallback(() => {
    actionMenuPopup({
      title: 'Mentions',
      buttons: (['DIRECT', 'THREAD'] as const).map((scope) => ({
        text: notificationReplyScopeLabel(scope),
        variant: replyScope === scope ? 'primary' : undefined,
        onPress: (close) => {
          close();
          setReplyScope(scope);
        },
      })),
    });
  }, [replyScope, setReplyScope]);

  // Tapping Mentions when it's already active opens the scope popup (like
  // Following); otherwise it just switches tabs.
  const handleNotificationTabPress = useCallback(
    (tab: NotificationTab) => {
      if (tab === 'MENTIONS' && activeTab === 'MENTIONS') {
        openReplyScopeMenu();
        return;
      }
      selectTab(tab);
    },
    [activeTab, openReplyScopeMenu, selectTab]
  );

  const threadContext = useMemo(
    () => ({
      profiles: result?.profilesMap ?? new Map(),
      metrics: result?.metricsMap ?? new Map(),
      quotedEvents: result?.quotedEventsMap ?? new Map(),
    }),
    [result]
  );

  const openNotification = useCallback(
    (notification: FeedNotification) => {
      if (notification.reason === 'follow') {
        router.push({
          pathname: '/(user-flow)/profile',
          params: { pubkey: notification.event.pubkey },
        });
        return;
      }
      const openEvent = notificationOpenEvent(notification);
      const allEvents = new Map([[notification.event.id, notification.event]]);
      if (notification.targetEvent)
        allEvents.set(notification.targetEvent.id, notification.targetEvent);
      seedThread(openEvent.id, {
        allEvents,
        profiles: threadContext.profiles,
        metrics: threadContext.metrics,
        quotedEvents: threadContext.quotedEvents,
      });
      router.push({
        pathname: '/(user-flow)/thread',
        params: { eventId: openEvent.id },
      });
    },
    [threadContext]
  );

  const openFollowGroup = useCallback(
    (notifications: FeedNotification[]) => {
      const seedId = seedNotificationFollowers({ notifications, result });
      router.push({
        pathname: '/(drawer)/(tabs)/notifications/followers',
        params: { seedId },
      });
    },
    [result]
  );

  const seedCreatedAt = useWalletLifecycleStore((s) => s.seedCreatedAt);
  const termsDate = useSettingsStore((s) => s.termsAccepted?.date ?? null);

  const notifications = result?.notifications ?? [];
  const notificationItems = useMemo<NotificationListItem[]>(() => {
    // The App tab is purely app announcements — the welcome card lives here, not
    // mixed into the real notifications on All.
    if (activeTab === 'APP') {
      return [{ type: 'welcome', id: 'welcome-sovran', installDate: seedCreatedAt, termsDate }];
    }
    return buildNotificationListItems(notifications);
  }, [notifications, activeTab, seedCreatedAt, termsDate]);

  // Render boundary for notifications: result rows → rendered list items, and
  // whether the screen is empty. Cross-check with feed.notifications.fetch.done
  // (data layer) to localize an empty notifications screen.
  useEffect(() => {
    feedLog.info('feed.notifications.ui.render', {
      tab: activeTab,
      notifications: notifications.length,
      items: notificationItems.length,
      empty: notificationItems.length === 0,
    });
  }, [notifications.length, notificationItems.length, activeTab]);

  return (
    <Screen name="NotificationsScreen" scroll="custom" bgColor={surface}>
      <Log name="NotificationsContent" style={styles.root}>
        <View
          style={[
            styles.filtersRow,
            {
              backgroundColor: surface,
              borderBottomColor: separator,
            },
          ]}>
          <View style={styles.filtersContent}>
            {NOTIFICATION_TABS.map((tab) => (
              <FeedTabButton
                key={tab.id}
                label={tab.label}
                active={activeTab === tab.id}
                showChevron={tab.id === 'MENTIONS' && activeTab === 'MENTIONS'}
                onPress={() => handleNotificationTabPress(tab.id)}
              />
            ))}
          </View>
        </View>
        <FlatList
          data={notificationItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: tabBarPadding },
            notificationItems.length === 0 && styles.emptyListContent,
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
              <Spinner size={22} color={opacity(foreground, 0.65)} style={styles.loader} />
            ) : (
              <EmptyNotifications
                viewerReady={!!viewerPubkey}
                errorMessage={errorMessage}
                foreground={foreground}
                muted={muted}
              />
            )
          }
          ListFooterComponent={
            // Only when there's content — never stacked on the empty-state spinner.
            isLoadingMore && notificationItems.length > 0 ? (
              <Spinner size={18} color={opacity(foreground, 0.65)} style={styles.footerSpinner} />
            ) : null
          }
          onEndReached={loadMoreNotifications}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => (
            <NotificationListRow
              item={item}
              result={result}
              foreground={foreground}
              surface={surface}
              muted={muted}
              pressedBackground={opacity(surfaceTertiary, 0.45)}
              onPressNotification={openNotification}
              onPressFollowGroup={openFollowGroup}
            />
          )}
        />
      </Log>
    </Screen>
  );
}

function NotificationListRow({
  item,
  result,
  foreground,
  surface,
  muted,
  pressedBackground,
  onPressNotification,
  onPressFollowGroup,
}: {
  item: NotificationListItem;
  result: FeedNotificationsResult | null;
  foreground: string;
  surface: string;
  muted: string;
  pressedBackground: string;
  onPressNotification: (notification: FeedNotification) => void;
  onPressFollowGroup: (notifications: FeedNotification[]) => void;
}) {
  if (item.type === 'welcome') {
    return (
      <WelcomeNotificationRow
        installDate={item.installDate}
        termsDate={item.termsDate}
        foreground={foreground}
        muted={muted}
      />
    );
  }
  if (item.type === 'group') {
    return (
      <NotificationGroupRow
        item={item}
        result={result}
        foreground={foreground}
        surface={surface}
        muted={muted}
        pressedBackground={pressedBackground}
        onPress={() =>
          item.reason === 'follow'
            ? onPressFollowGroup(item.notifications)
            : onPressNotification(item.notifications[0]!)
        }
      />
    );
  }
  return (
    <NotificationRow
      notification={item.notification}
      result={result}
      foreground={foreground}
      muted={muted}
      pressedBackground={pressedBackground}
      onPress={() => onPressNotification(item.notification)}
    />
  );
}

function WelcomeNotificationRow({
  installDate,
  termsDate,
  foreground,
  muted,
}: {
  installDate: number | null;
  termsDate: string | null;
  foreground: string;
  muted: string;
}) {
  const accent = useThemeColor('accent');
  const dateBits: string[] = [];
  if (typeof installDate === 'number' && installDate > 0) {
    dateBits.push(`Joined ${formatDate(installDate, 'short-date')}`);
  }
  if (termsDate) {
    const parsed = Date.parse(termsDate);
    if (!Number.isNaN(parsed)) {
      dateBits.push(`Terms agreed ${formatDate(parsed, 'short-date')}`);
    }
  }
  return (
    <View style={styles.row}>
      <VStack gap={8}>
        <HStack align="flex-start" gap={12}>
          <View style={[styles.welcomeGlyph, { backgroundColor: opacity(accent, 0.13) }]}>
            <Icon name="iconamoon:heart-fill" size={22} color={accent} />
          </View>
          <VStack gap={4} flex={1}>
            <NotificationTitleLine
              title="Thanks for downloading Sovran"
              timestamp=""
              foreground={foreground}
              muted={muted}
            />
            {dateBits.length > 0 ? (
              <Text size={14} style={{ color: muted }}>
                {dateBits.join('  ·  ')}
              </Text>
            ) : null}
          </VStack>
        </HStack>
      </VStack>
    </View>
  );
}

function NotificationRow({
  notification,
  result,
  foreground,
  muted,
  pressedBackground,
  onPress,
}: {
  notification: FeedNotification;
  result: FeedNotificationsResult | null;
  foreground: string;
  muted: string;
  pressedBackground: string;
  onPress: () => void;
}) {
  const profile = result?.profilesMap.get(notification.event.pubkey);
  const name = profile?.name || `${notification.event.pubkey.slice(0, 8)}...`;
  const title = notificationTitle(name, notification.reason, !!notification.targetEvent);
  const tone = notificationTone(notification.reason);
  const timestamp = notificationEventTimestamp(notification);

  return (
    <Pressable
      accessibilityRole="button"
      haptics
      activeOpacity={1}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: pressedBackground }]}>
      <VStack gap={8}>
        <HStack align="flex-start" gap={12}>
          <NotificationReasonIcon reason={notification.reason} color={tone} />
          <View>
            <Avatar
              state={profile?.picture ? 'image' : 'fallback'}
              picture={profile?.picture}
              name={name}
              seed={notification.event.pubkey}
              size={42}
            />
          </View>
          <VStack gap={4} flex={1}>
            <NotificationTitleLine
              title={title}
              timestamp={timestamp}
              foreground={foreground}
              muted={muted}
            />
          </VStack>
        </HStack>
        <NotificationBody
          notification={notification}
          result={result}
          foreground={foreground}
          muted={muted}
        />
      </VStack>
    </Pressable>
  );
}

function NotificationGroupRow({
  item,
  result,
  foreground,
  surface,
  muted,
  pressedBackground,
  onPress,
}: {
  item: Extract<NotificationListItem, { type: 'group' }>;
  result: FeedNotificationsResult | null;
  foreground: string;
  surface: string;
  muted: string;
  pressedBackground: string;
  onPress: () => void;
}) {
  const tone = notificationTone(item.reason);
  const names = item.notifications.map((notification) => notificationName(notification, result));
  const title = groupedNotificationTitle(names, item.total, item.reason, item.totalCapped);
  const previewEvent =
    item.reason === 'repost' || item.reason === 'reaction' || item.reason === 'zap'
      ? item.notifications[0]?.targetEvent
      : undefined;
  const timestamp = notificationGroupTimestamp(item.notifications);

  return (
    <Pressable
      accessibilityRole="button"
      haptics
      activeOpacity={1}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: pressedBackground }]}>
      <VStack gap={8}>
        <HStack align="flex-start" gap={12}>
          <NotificationReasonIcon reason={item.reason} color={tone} />
          <AvatarCluster notifications={item.notifications} result={result} borderColor={surface} />
          <VStack gap={4} flex={1}>
            <NotificationTitleLine
              title={title}
              timestamp={timestamp}
              foreground={foreground}
              muted={muted}
            />
          </VStack>
        </HStack>
        {previewEvent ? (
          <View style={styles.bodyContent}>
            <NotificationReferencedPost
              event={previewEvent}
              result={result}
              foreground={foreground}
              muted={muted}
            />
          </View>
        ) : null}
      </VStack>
    </Pressable>
  );
}

function AvatarCluster({
  notifications,
  result,
  borderColor,
}: {
  notifications: FeedNotification[];
  result: FeedNotificationsResult | null;
  borderColor: string;
}) {
  const preview = notifications.slice(0, MAX_GROUP_AVATARS);
  return (
    <View style={[styles.avatarCluster, { width: 46 + Math.max(0, preview.length - 1) * 16 }]}>
      {preview.map((notification, index) => {
        const profile = result?.profilesMap.get(notification.event.pubkey);
        const name = profile?.name || `${notification.event.pubkey.slice(0, 8)}...`;
        return (
          <View
            key={notification.event.id}
            style={[
              styles.clusterAvatar,
              {
                backgroundColor: borderColor,
                borderColor,
                left: index * 16,
              },
            ]}>
            <Avatar
              state={profile?.picture ? 'image' : 'fallback'}
              picture={profile?.picture}
              name={name}
              seed={notification.event.pubkey}
              size={42}
            />
          </View>
        );
      })}
    </View>
  );
}

function NotificationReasonIcon({ reason, color }: { reason: string; color: string }) {
  return (
    <View style={[styles.reasonIcon, { backgroundColor: opacity(color, 0.13) }]}>
      <Icon name={notificationIcon(reason)} size={17} color={color} />
    </View>
  );
}

function NotificationTitleLine({
  title,
  timestamp,
  foreground,
  muted,
}: {
  title: string;
  timestamp: string;
  foreground: string;
  muted: string;
}) {
  return (
    <HStack align="flex-start" justify="space-between" gap={8} style={styles.titleLine}>
      <Text numberOfLines={2} size={16} style={[styles.titleText, { color: foreground }]}>
        {title}
      </Text>
      {timestamp ? (
        <Text numberOfLines={1} size={13} style={[styles.timestampText, { color: muted }]}>
          {timestamp}
        </Text>
      ) : null}
    </HStack>
  );
}

function NotificationBody({
  notification,
  result,
  foreground,
  muted,
}: {
  notification: FeedNotification;
  result: FeedNotificationsResult | null;
  foreground: string;
  muted: string;
}) {
  const previewEvent = notificationPreviewEvent(notification);
  const targetEvent =
    previewEvent?.id === notification.targetEvent?.id ? undefined : notification.targetEvent;

  if (!previewEvent) return null;

  if (
    notification.reason === 'reply' ||
    notification.reason === 'quote' ||
    notification.reason === 'mention'
  ) {
    return (
      <VStack gap={8} style={styles.bodyContent}>
        <NotificationEventText event={previewEvent} foreground={foreground} muted={muted} />
        {targetEvent ? (
          <NotificationReferencedPost
            event={targetEvent}
            result={result}
            foreground={foreground}
            muted={muted}
            showAuthorAvatar
          />
        ) : null}
      </VStack>
    );
  }

  return (
    <View style={styles.bodyContent}>
      <NotificationReferencedPost
        event={previewEvent}
        result={result}
        foreground={foreground}
        muted={muted}
        contained={
          notification.reason === 'reaction' ||
          notification.reason === 'zap' ||
          notification.reason === 'repost'
        }
      />
    </View>
  );
}

function NotificationEventText({
  event,
  foreground,
  muted,
}: {
  event: FeedEvent;
  foreground: string;
  muted: string;
}) {
  const content = event.content.trim();
  return (
    <Text numberOfLines={4} size={15} style={{ color: content ? foreground : muted }}>
      {content || 'Post unavailable'}
    </Text>
  );
}

function NotificationReferencedPost({
  event,
  result,
  foreground,
  muted,
  showAuthorAvatar = false,
  contained = false,
}: {
  event: FeedEvent;
  result: FeedNotificationsResult | null;
  foreground: string;
  muted: string;
  showAuthorAvatar?: boolean;
  contained?: boolean;
}) {
  const profile = result?.profilesMap.get(event.pubkey);
  const name = profile?.name || `${event.pubkey.slice(0, 8)}...`;
  const content = event.content.trim();
  const isContained = showAuthorAvatar || contained;
  const targetPostBackground = isContained ? opacity(foreground, 0.055) : 'transparent';

  return (
    <VStack
      gap={3}
      style={[
        styles.referencedPost,
        isContained && styles.referencedPostContained,
        isContained && {
          backgroundColor: targetPostBackground,
          borderColor: opacity(foreground, 0.08),
        },
      ]}>
      <HStack align="center" gap={6}>
        {showAuthorAvatar ? (
          <Avatar
            state={profile?.picture ? 'image' : 'fallback'}
            picture={profile?.picture}
            name={name}
            seed={event.pubkey}
            size={18}
          />
        ) : null}
        <Text bold numberOfLines={1} size={13} style={{ color: opacity(foreground, 0.72) }}>
          {name}
        </Text>
      </HStack>
      <Text numberOfLines={3} size={14} style={{ color: content ? foreground : muted }}>
        {content || 'Post unavailable'}
      </Text>
    </VStack>
  );
}

function notificationName(
  notification: FeedNotification,
  result: FeedNotificationsResult | null
): string {
  return (
    result?.profilesMap.get(notification.event.pubkey)?.name ||
    `${notification.event.pubkey.slice(0, 8)}...`
  );
}

function notificationEventTimestamp(notification: FeedNotification): string {
  return formatNotificationTimestamp(notification.event.created_at);
}

function notificationGroupTimestamp(notifications: readonly FeedNotification[]): string {
  const latest = notifications.reduce(
    (max, notification) => Math.max(max, notification.event.created_at),
    0
  );
  return formatNotificationTimestamp(latest);
}

function formatNotificationTimestamp(createdAt: number): string {
  return createdAt > 0 ? formatRelative(createdAt * 1000, 'compact') : '';
}

function notificationOpenEvent(notification: FeedNotification): FeedEvent {
  if (
    notification.targetEvent &&
    (notification.reason === 'reaction' ||
      notification.reason === 'repost' ||
      notification.reason === 'zap')
  ) {
    return notification.targetEvent;
  }
  return notification.event;
}

function notificationPreviewEvent(notification: FeedNotification): FeedEvent | undefined {
  if (
    notification.reason === 'reply' ||
    notification.reason === 'quote' ||
    notification.reason === 'mention'
  ) {
    return notification.event;
  }
  if (notification.targetEvent) return notification.targetEvent;
  return undefined;
}

function notificationTitle(name: string, reason: string, hasTargetEvent = false): string {
  switch (reason) {
    case 'follow':
      return `${name} followed you`;
    case 'reaction':
      return `${name} liked your post`;
    case 'repost':
      return `${name} reposted your post`;
    case 'zap':
      return hasTargetEvent ? `${name} zapped your post` : `${name} zapped you`;
    case 'reply':
      return hasTargetEvent ? `${name} replied to your post` : `${name} replied to you`;
    case 'quote':
      return `${name} quoted your post`;
    case 'mention':
      return `${name} mentioned you`;
    default:
      return `${name} ${notificationReasonLabel(reason)}`;
  }
}

const GROUP_ACTIONS: Record<'follow' | 'repost' | 'reaction' | 'zap', string> = {
  follow: 'followed you',
  repost: 'reposted your post',
  reaction: 'liked your post',
  zap: 'zapped your post',
};

function groupedNotificationTitle(
  names: readonly string[],
  count: number,
  reason: 'follow' | 'repost' | 'reaction' | 'zap',
  totalCapped = false
): string {
  const action = GROUP_ACTIONS[reason];
  if (count <= 0) return action;
  if (count === 1) return `${names[0]} ${action}`;
  if (count === 2) return `${names[0]} and ${names[1]} ${action}`;
  const others = count - 2;
  const moreLabel = totalCapped ? `${others}+ others` : `${others} others`;
  return `${names[0]}, ${names[1]} and ${moreLabel} ${action}`;
}

function notificationIcon(reason: string): string {
  switch (reason) {
    case 'follow':
      return 'la:user-plus';
    case 'reaction':
      return 'garden:heart-fill-16';
    case 'repost':
      return 'garden:arrow-retweet-fill-16';
    case 'zap':
      return 'mdi:lightning-bolt';
    case 'reply':
      return 'mdi:message-reply';
    case 'quote':
      return 'mdi:message-text';
    case 'mention':
      return 'mdi:at';
    default:
      return 'mdi:bell';
  }
}

function notificationTone(reason: string): string {
  switch (reason) {
    case 'follow':
    case 'reply':
    case 'mention':
    case 'quote':
      return '#1D9BF0';
    case 'reaction':
      return '#F91880';
    case 'repost':
      return '#00BA7C';
    case 'zap':
      return '#F59E0B';
    default:
      return '#71767B';
  }
}

function EmptyNotifications({
  viewerReady,
  errorMessage,
  foreground,
  muted,
}: {
  viewerReady: boolean;
  errorMessage: string | null;
  foreground: string;
  muted: string;
}) {
  const icon = errorMessage ? 'mdi:alert-circle-outline' : 'mdi:bell-outline';
  const title = errorMessage
    ? 'Notifications unavailable'
    : viewerReady
      ? 'No notifications'
      : 'No profile';
  const subtitle = errorMessage ? errorMessage : viewerReady ? '' : 'Nostr profile required';

  return (
    <VStack align="center" gap={12} style={styles.emptyState}>
      <Icon name={icon} size={34} color={opacity(foreground, 0.45)} />
      <Text size={18} bold style={{ color: foreground, textAlign: 'center' }}>
        {title}
      </Text>
      {subtitle ? (
        <Text size={14} style={{ color: muted, textAlign: 'center' }}>
          {subtitle}
        </Text>
      ) : null}
    </VStack>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  filtersRow: {
    height: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filtersContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    height: 56,
    paddingHorizontal: 20,
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
  bodyContent: {
    paddingLeft: 40,
  },
  reasonIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    marginTop: 7,
    width: 28,
  },
  welcomeGlyph: {
    alignItems: 'center',
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  avatarCluster: {
    height: 46,
  },
  clusterAvatar: {
    borderRadius: 23,
    borderWidth: 2,
    height: 46,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'absolute',
    top: -2,
    width: 46,
  },
  referencedPost: {
    borderRadius: 10,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingRight: 4,
    paddingVertical: 0,
  },
  referencedPostContained: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 72,
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
