import { notificationPreviewText } from '@/features/feed/lib/notificationPreviewText';
import { avatarStateFor } from '@/shared/lib/imageLoadState';
import { buildAppNotificationRows } from '@/features/feed/lib/appNotificationRows';
import { legalRevisions } from '@/shared/lib/legal/legalDocuments';
import { collectReferencedIds } from '@/features/feed/components/nostr/feedParse';
import { DEMO_NOTIFICATIONS } from '@/shared/stores/runtime/mockPresentationData';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { useFeedIgnoreStore } from '@/features/feed/stores/ignoreStore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet } from 'react-native';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { withAlpha } from '@/shared/lib/color';

import Icon from '@/assets/icons';
import type {
  FeedNotification,
  FeedNotificationTab,
  FeedNotificationsResult,
} from '@/features/feed/data/feedClient';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import {
  notificationReasonLabel,
  notificationReplyScopeLabel,
} from '@/features/feed/lib/notificationCopy';
import { formatDate, formatRelativeUnixSeconds } from '@/shared/lib/date';
import {
  notificationListStyles,
  NotificationRowPressable,
} from '@/features/feed/components/notificationRowChrome';
import { List } from '@/shared/ui/composed/List';
import { seedNotificationFollowers } from '@/features/feed/lib/notificationFollowersSeedCache';
import {
  buildNotificationListItems,
  type NotificationListItem,
} from '@/features/feed/lib/notificationGroups';
import { seedThread } from '@/features/feed/lib/threadSeedCache';
import { TierBadge } from '@/shared/ui/composed/TierBadge';
import { useNotificationPolicyStore } from '@/features/feed/stores/notificationPolicyStore';
import { FeedTabButton } from '@/features/feed/components/FeedTabButton';
import { useNotificationsPage } from '@/features/feed/hooks/useNotificationsPage';
import { Button } from '@/shared/ui/primitives/Button';
import { MintChangesList } from '@/features/mint/components/mintChanges/MintChangesList';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import {
  useVisualFlatListLogger,
  VISUAL_LIST_VIEWABILITY_CONFIG,
} from '@/shared/lib/contentShiftLog';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { feedLog, Log, useLifecycleLogger } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import { useOwnContentStore } from '@/shared/stores/profile/ownContentStore';
import { actionMenuPopup } from '@/shared/lib/popup';
import { Screen } from '@/shared/ui/composed/Screen';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Badge } from '@/shared/ui/primitives/Badge';
import { iconSize } from '@/shared/styles/tokens';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

// `APP` (app announcements like the welcome card) and `MINTS` (what this
// wallet's mints changed about their NUT-06 info, served by nagg's mint
// changelog) are client-sourced tabs; neither hits the feed client.
// ALL/MENTIONS are the server-backed tabs.
type NotificationTab = FeedNotificationTab | 'APP' | 'MINTS';

const NOTIFICATION_TABS: { id: NotificationTab; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'MENTIONS', label: 'Mentions' },
  { id: 'MINTS', label: 'Mints' },
  { id: 'APP', label: 'App' },
];

/** Tabs that never call the feed client — they render from local sources. */
function isClientTab(tab: NotificationTab): tab is 'APP' | 'MINTS' {
  return tab === 'APP' || tab === 'MINTS';
}

const MAX_GROUP_AVATARS = 3;
const EMPTY_NOTIFICATIONS: readonly FeedNotification[] = [];

/** Stable first-paint rows; fixed ids keep FlashList keys stable across the swap. */
const SKELETON_ITEMS: NotificationListItem[] = Array.from({ length: 6 }, (_, i) => ({
  type: 'skeleton' as const,
  id: `skeleton-${i}`,
}));

function notificationItemType(item: NotificationListItem): string {
  if (item.type === 'single') return item.notification.reason;
  if (item.type === 'group') return `group:${item.reason}`;
  return item.type;
}

/** Per-type row counts (e.g. {reaction: 3, "group:follow": 1}) for render logs. */
function notificationItemBreakdown(items: readonly NotificationListItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const type = notificationItemType(item);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

export function NotificationsScreen() {
  const mockMode = useSettingsStore((state) => state.mockMode);
  return <NotificationsContent key={mockMode ? 'demo' : 'live'} demo={mockMode} />;
}

function NotificationsContent({ demo }: { demo: boolean }) {
  useLifecycleLogger('NotificationsScreen', feedLog);

  const { keys: nostrKeys } = useNostrKeysContext();
  const viewerPubkey = nostrKeys?.pubkey;
  const policy = useNotificationPolicyStore((state) => state.policy);
  const replyScope = useNotificationPolicyStore((state) => state.replyScope);
  const setReplyScope = useNotificationPolicyStore((state) => state.setReplyScope);
  const [activeTab, setActiveTab] = useState<NotificationTab>('ALL');
  const [foreground, surface, separator, muted, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
    'muted',
    'surface-tertiary',
  ] as const);
  const notificationsVisualScope = useMemo(
    () => `feed.notifications.${activeTab.toLowerCase()}.list`,
    [activeTab]
  );

  // Own recent event ids power the relay floor's #e/#q backstop and flip its
  // reply/engagement classification fail-open → fail-closed.
  const ownContentById = useOwnContentStore((s) => s.byId);
  const ownEventIds = useMemo(
    () =>
      Object.values(ownContentById)
        .sort((a, b) => b.event.created_at - a.event.created_at)
        .slice(0, 200)
        .map((entry) => entry.event.id),
    [ownContentById]
  );

  // The page-0 owner: cache-first (a cached tab paints synchronously on tab
  // switch, a fresh one costs no round-trip), the unified three-source session
  // behind it, pagination layered on top. Client-only tabs (synthetic
  // announcements, mint changelog) and demo mode never read.
  const serverTab = isClientTab(activeTab) ? 'ALL' : activeTab;
  const page = useNotificationsPage({
    viewerPubkey,
    tab: serverTab,
    policy,
    replyScope,
    ownEventIds,
    enabled: !demo && !isClientTab(activeTab),
  });
  const result: FeedNotificationsResult | null = demo
    ? activeTab === 'ALL'
      ? DEMO_NOTIFICATIONS
      : null
    : isClientTab(activeTab)
      ? null
      : page.result;
  const { isInitialLoading, isRefreshing, isLoadingMore, errorMessage } = page;
  const handleRefresh = page.refresh;
  const loadMoreNotifications = page.loadMore;

  const selectTab = useCallback(
    (tab: NotificationTab) => {
      if (tab === activeTab) return;
      feedLog.info('feed.notifications.ui.tab_selected', {
        from: activeTab,
        to: tab,
        policy,
        replyScope,
      });
      // No reset here: the new tab's key selects its own cached page (or a
      // skeleton) synchronously — never a blank list plus a spinner.
      setActiveTab(tab);
    },
    [activeTab, policy, replyScope]
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
      const openEventId = notificationOpenEventId(notification);
      const allEvents = new Map([[notification.event.id, notification.event]]);
      if (notification.targetEvent)
        allEvents.set(notification.targetEvent.id, notification.targetEvent);
      seedThread(openEventId, {
        allEvents,
        profiles: threadContext.profiles,
        metrics: threadContext.metrics,
        quotedEvents: threadContext.quotedEvents,
      });
      router.push({
        pathname: '/(user-flow)/thread',
        params: { eventId: openEventId },
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
  const termsAccepted = useSettingsStore((s) => s.termsAccepted);
  const legalAcceptance = useSettingsStore((s) => s.legalAcceptance);

  const ignoredPeople = useFeedIgnoreStore((s) => s.ignoredPubkeys);
  const ignoredEvents = useFeedIgnoreStore((s) => s.ignoredEventIds);
  const rawNotifications = useMemo(
    () =>
      (result?.notifications ?? EMPTY_NOTIFICATIONS).filter(
        (n) => !ignoredPeople.includes(n.event.pubkey) && !ignoredEvents.includes(n.event.id)
      ),
    [result, ignoredPeople, ignoredEvents]
  );

  // A like/repost/zap is always engagement on one of OUR posts, so its target's
  // content is in the own-content cache (notes we authored, keyed by id). nagg
  // bundles the full `targetEvent`; the relay/cache tiers only carry
  // `targetEventId`, leaving no preview. Resolve the missing target from local
  // own-content so the post preview renders regardless of serving tier — its
  // author is us, so no profile refetch is needed (see viewerPubkey below).
  // (ownContentById is subscribed above, next to the session refs, where the
  // same store also feeds the relay ownEventIds backstop.)
  const notifications = useMemo(() => {
    let changed = false;
    const hydrated = rawNotifications.map((n) => {
      if (n.targetEvent) return n;
      if (n.reason !== 'reaction' && n.reason !== 'repost' && n.reason !== 'zap') return n;
      const targetId = n.targetEventId;
      if (!targetId) return n;
      const entry = ownContentById[targetId];
      if (!entry) return n;
      changed = true;
      return { ...n, targetEvent: entry.event };
    });
    return changed ? hydrated : rawNotifications;
  }, [rawNotifications, ownContentById]);

  // The serving tier's `profilesMap` is empty on the relay/cache path (only nagg
  // bundles notification author profiles), leaving rows with a truncated-pubkey
  // name + fallback avatar. Warm + read the shared metadata cache (filled by the
  // facade getProfiles: Primal user_infos → relay kind-0) for every actor and
  // merge it in as a fallback, so names/avatars resolve regardless of tier.
  const actorPubkeys = useMemo(() => {
    if (demo) return [];
    const set = new Set<string>();
    // Our own profile authors every like/repost/zap target preview — warm it too
    // so the contained post shows our name + avatar, not a truncated pubkey.
    if (viewerPubkey) set.add(viewerPubkey);
    for (const n of notifications) {
      if (n.event?.pubkey) set.add(n.event.pubkey);
      for (const actor of n.sampleActors ?? []) if (actor.pubkey) set.add(actor.pubkey);
    }
    const previewEvents = notifications.flatMap((n) =>
      n.targetEvent ? [n.event, n.targetEvent] : [n.event]
    );
    for (const pubkey of collectReferencedIds(previewEvents).pubkeys) set.add(pubkey);
    return [...set];
  }, [notifications, viewerPubkey, demo]);
  const { metadata: cachedProfiles } = useNostrProfileMetadataMany(actorPubkeys);

  const resultForRows = useMemo<FeedNotificationsResult | null>(() => {
    if (!result || cachedProfiles.size === 0) return result;
    const profilesMap = new Map(result.profilesMap);
    for (const [pk, meta] of cachedProfiles) {
      const existing = profilesMap.get(pk);
      // Fill a missing actor, or upgrade a name-only tier entry that lacks a picture.
      if (existing && existing.picture) continue;
      const name = meta.displayName || meta.name || existing?.name;
      const picture = meta.picture ?? existing?.picture;
      if (!name && !picture) continue;
      profilesMap.set(pk, { name: name ?? '', ...(picture ? { picture } : {}) });
    }
    return { ...result, profilesMap };
  }, [result, cachedProfiles]);

  const notificationItems = useMemo<NotificationListItem[]>(() => {
    // The App tab is purely app announcements — the welcome card lives here, not
    // mixed into the real notifications on All.
    if (activeTab === 'APP') {
      return buildAppNotificationRows({
        seedCreatedAt,
        termsAccepted,
        legalAcceptance,
        currentRevisions: legalRevisions,
        nowMs: Date.now(),
      });
    }
    const items = buildNotificationListItems(notifications);
    // First paint with nothing cached: skeleton rows through the same row
    // chrome, never a spinner over an empty list.
    if (items.length === 0 && isInitialLoading) return SKELETON_ITEMS;
    return items;
  }, [notifications, activeTab, seedCreatedAt, termsAccepted, legalAcceptance, isInitialLoading]);
  const visualPhase = isInitialLoading ? 'initial-loading' : isRefreshing ? 'refreshing' : 'ready';
  const { onListLayout, onListContentSizeChange, onListScroll, onListViewableItemsChanged } =
    useVisualFlatListLogger<NotificationListItem>({
      scope: notificationsVisualScope,
      surface: 'notifications',
      component: 'NotificationsFlatList',
      phase: visualPhase,
      extra: () => ({
        tab: activeTab,
        replyScope,
        items: notificationItems.length,
        rows: notificationItems.length,
        loadingMore: isLoadingMore,
      }),
      remeasureExtra: () => ({
        tab: activeTab,
        items: notificationItems.length,
        loadingMore: isLoadingMore,
      }),
      getItemKey: (item) => `notification:${item.id}`,
      getItemContext: (item) => ({
        itemType: notificationItemType(item),
        rowLabel: item.type,
      }),
    });

  // Render boundary for notifications: result rows → rendered list items under
  // the active filter options, plus a per-type breakdown of what's on screen.
  // Cross-check with feed.notifications.fetch.done (data layer, carries the
  // serving tier) and feed.notifications.ui.applied (page source) to localize
  // an inconsistent or empty notifications screen.
  useEffect(() => {
    feedLog.info('feed.notifications.ui.render', {
      tab: activeTab,
      policy,
      replyScope,
      phase: visualPhase,
      notifications: notifications.length,
      items: notificationItems.length,
      itemTypes: notificationItemBreakdown(notificationItems),
      empty: notificationItems.length === 0,
      error: !!errorMessage,
    });
  }, [
    notifications.length,
    notificationItems,
    activeTab,
    policy,
    replyScope,
    visualPhase,
    errorMessage,
  ]);

  return (
    <Screen name="NotificationsScreen" scroll="custom" bgColor={surface}>
      <E2EAccessibilityProbe testID="screen-notifications" accessibilityLabel="Notifications" />
      <Log name="NotificationsContent" style={notificationListStyles.root}>
        <VisualLayoutProbe
          scope={notificationsVisualScope}
          surface="notifications"
          component="NotificationsTabs"
          itemKey="tabs"
          itemType="tabs"
          extra={{ tab: activeTab, replyScope }}>
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
                  testID={`notifications-tab-${tab.id.toLowerCase()}`}
                  label={tab.label}
                  active={activeTab === tab.id}
                  showChevron={tab.id === 'MENTIONS' && activeTab === 'MENTIONS'}
                  onPress={() => handleNotificationTabPress(tab.id)}
                />
              ))}
            </View>
          </View>
        </VisualLayoutProbe>
        {activeTab === 'MINTS' ? (
          // Mint changes have their own source, refresh and row shapes — the
          // notifications list below stays untouched.
          <MintChangesList />
        ) : (
          <List
            screen
            data={notificationItems}
            keyExtractor={(item) => item.id}
            // Heterogeneous rows (welcome/group/single) — without this
            // FlashList v2 recycles one variant's component into another's
            // slot (recycling corruption). Module helper also feeds render
            // logs, so pools split per notification reason.
            getItemType={notificationItemType}
            contentContainerStyle={[
              notificationListStyles.listContent,
              notificationItems.length === 0 && notificationListStyles.emptyListContent,
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
              <VisualLayoutProbe
                scope={notificationsVisualScope}
                surface="notifications"
                component="NotificationsEmptyState"
                itemKey={errorMessage ? 'empty:error' : 'empty:no-results'}
                itemType={errorMessage ? 'error' : 'empty'}
                extra={{ tab: activeTab, viewerReady: !!viewerPubkey }}>
                <EmptyNotifications
                  viewerReady={!!viewerPubkey}
                  errorMessage={errorMessage}
                  onRetry={handleRefresh}
                  foreground={foreground}
                  muted={muted}
                />
              </VisualLayoutProbe>
            }
            ListFooterComponent={
              // Only when there's content — never stacked on the empty-state spinner.
              isLoadingMore && notificationItems.length > 0 ? (
                <VisualLayoutProbe
                  scope={notificationsVisualScope}
                  surface="notifications"
                  component="NotificationsPaginationSpinner"
                  itemKey="footer:pagination-spinner"
                  itemType="spinner"
                  extra={{ tab: activeTab, items: notificationItems.length }}>
                  <Spinner
                    size={18}
                    color={withAlpha(foreground, 0.65)}
                    style={notificationListStyles.footerSpinner}
                  />
                </VisualLayoutProbe>
              ) : null
            }
            // Load-more reveals pooled rows into their true chronological slots
            // (possibly above the viewport); FlashList v2's default
            // maintainVisibleContentPosition keeps the visible window anchored.
            onLayout={onListLayout}
            onContentSizeChange={onListContentSizeChange}
            onEndReached={loadMoreNotifications}
            onEndReachedThreshold={0.4}
            onScroll={onListScroll}
            scrollEventThrottle={250}
            viewabilityConfig={VISUAL_LIST_VIEWABILITY_CONFIG}
            onViewableItemsChanged={onListViewableItemsChanged}
            renderItem={({ item, index }) => (
              <VisualLayoutProbe
                scope={notificationsVisualScope}
                surface="notifications"
                component="NotificationListRow"
                itemKey={`notification:${item.id}`}
                itemType={item.type}
                index={index}
                extra={{ tab: activeTab, phase: visualPhase }}>
                <NotificationListRow
                  item={item}
                  result={resultForRows}
                  foreground={foreground}
                  surface={surface}
                  muted={muted}
                  pressedBackground={withAlpha(surfaceTertiary, 0.45)}
                  onPressNotification={demo ? () => undefined : openNotification}
                  onPressFollowGroup={demo ? () => undefined : openFollowGroup}
                />
              </VisualLayoutProbe>
            )}
          />
        )}
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
  if (item.type === 'skeleton') {
    return <NotificationSkeletonRow pressedBackground={pressedBackground} muted={muted} />;
  }
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
  if (item.type === 'legal') {
    return <LegalAcceptanceNotificationRow item={item} pressedBackground={pressedBackground} />;
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
    <View testID="notification-app-welcome" style={notificationListStyles.row}>
      <VStack gap={8}>
        <HStack align="flex-start" gap={12}>
          <View style={[styles.welcomeGlyph, { backgroundColor: withAlpha(accent, 0.13) }]}>
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

function LegalAcceptanceNotificationRow({
  item,
  pressedBackground,
}: {
  item: Extract<NotificationListItem, { type: 'legal' }>;
  pressedBackground: string;
}) {
  const [accent, muted] = useThemeColor(['accent', 'muted'] as const);
  const date =
    item.acceptedAtMs === null ? 'Date unknown' : formatDate(item.acceptedAtMs, 'short-date');
  const subtitle = item.revisionKnown
    ? `${date} · Terms ${item.termsRevisionShort} · Privacy ${item.privacyRevisionShort}`
    : `${date} · Revision unknown`;
  const status = item.isCurrent ? 'Up to date' : 'Updated — review';

  return (
    <NotificationRowPressable
      testID="notification-app-legal"
      accessibilityLabel={`Terms and Privacy accepted. ${subtitle}. ${status}. View terms.`}
      pressedBackground={pressedBackground}
      onPress={() => router.push('/(settings-flow)/terms')}>
      <View className="flex-row items-start gap-3">
        <View className="bg-accent/10 size-10 shrink-0 items-center justify-center rounded-full">
          <Icon name="mdi:check-circle-outline" size={iconSize.lg} color={accent} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text size={16}>Terms and Privacy accepted</Text>
          <Text size={14} color={muted}>
            {subtitle}
          </Text>
        </View>
        <Badge className="max-w-32 shrink" color={item.isCurrent ? muted : accent}>
          {status}
        </Badge>
      </View>
    </NotificationRowPressable>
  );
}

/**
 * The single-row shell with every leaf in its loading state: same icon slot,
 * avatar geometry, title/timestamp line and body reservation as a real row,
 * so the skeleton→content swap shifts nothing.
 */
function NotificationSkeletonRow({
  pressedBackground,
  muted,
}: {
  pressedBackground: string;
  muted: string;
}) {
  return (
    <NotificationRowPressable pressedBackground={pressedBackground} onPress={noopPress}>
      <VStack gap={8}>
        <HStack align="flex-start" gap={12}>
          <NotificationReasonIcon reason="reaction" color={muted} />
          <View>
            <Avatar state="loading" name="" seed="skeleton" size={42} />
          </View>
          <VStack gap={4} flex={1}>
            <HStack align="flex-start" justify="space-between" gap={8}>
              <Text size={16} loading placeholder="Someone reacted to your post" />
              <Text size={13} loading placeholder="2h" />
            </HStack>
          </VStack>
        </HStack>
        <Text size={15} loading placeholder="A short preview of the referenced note goes here" />
      </VStack>
    </NotificationRowPressable>
  );
}
const noopPress = () => undefined;

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
    <NotificationRowPressable pressedBackground={pressedBackground} onPress={onPress}>
      <VStack gap={8}>
        <HStack align="flex-start" gap={12}>
          <NotificationReasonIcon reason={notification.reason} color={tone} />
          <View>
            <Avatar
              state={avatarStateFor(profile?.picture, profile !== undefined)}
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
              badge={<TierBadge eventId={notification.event.id} />}
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
    </NotificationRowPressable>
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
    <NotificationRowPressable pressedBackground={pressedBackground} onPress={onPress}>
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
              badge={
                item.notifications[0] ? (
                  <TierBadge eventId={item.notifications[0].event.id} />
                ) : undefined
              }
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
              contained
            />
          </View>
        ) : null}
      </VStack>
    </NotificationRowPressable>
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
              state={avatarStateFor(profile?.picture, profile !== undefined)}
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
    <View style={[styles.reasonIcon, { backgroundColor: withAlpha(color, 0.13) }]}>
      <Icon name={notificationIcon(reason)} size={17} color={color} />
    </View>
  );
}

function NotificationTitleLine({
  title,
  timestamp,
  foreground,
  muted,
  badge,
}: {
  title: string;
  timestamp: string;
  foreground: string;
  muted: string;
  /** Dev-only data-source chip (n/c/r), rendered after the timestamp. */
  badge?: React.ReactNode;
}) {
  return (
    <HStack
      align="flex-start"
      justify="space-between"
      gap={8}
      style={notificationListStyles.titleLine}>
      <Text
        numberOfLines={2}
        size={16}
        style={[notificationListStyles.titleText, { color: foreground }]}>
        {title}
      </Text>
      <HStack align="center" gap={4}>
        {timestamp ? (
          <Text
            numberOfLines={1}
            size={13}
            style={[notificationListStyles.timestampText, { color: muted }]}>
            {timestamp}
          </Text>
        ) : null}
        {badge}
      </HStack>
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
  // The optional chains are resolved before the ternary: React Compiler cannot
  // lower an optional member access used as a ternary's test.
  const previewEventId = previewEvent?.id;
  const targetEventId = notification.targetEvent?.id;
  const targetEvent = previewEventId === targetEventId ? undefined : notification.targetEvent;

  if (!previewEvent) return null;

  if (
    notification.reason === 'reply' ||
    notification.reason === 'quote' ||
    notification.reason === 'mention'
  ) {
    return (
      <VStack gap={8} style={styles.bodyContent}>
        <NotificationEventText
          event={previewEvent}
          result={result}
          foreground={foreground}
          muted={muted}
        />
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
  result,
  foreground,
  muted,
}: {
  event: FeedEvent;
  result: FeedNotificationsResult | null;
  foreground: string;
  muted: string;
}) {
  const content = notificationPreviewText(event.content, result?.profilesMap);
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
  const content = notificationPreviewText(event.content, result?.profilesMap);
  const isContained = showAuthorAvatar || contained;
  const targetPostBackground = isContained ? withAlpha(foreground, 0.055) : 'transparent';

  return (
    <VStack
      gap={3}
      style={[
        styles.referencedPost,
        isContained && styles.referencedPostContained,
        isContained && {
          backgroundColor: targetPostBackground,
          borderColor: withAlpha(foreground, 0.08),
        },
      ]}>
      <HStack align="center" gap={6}>
        {showAuthorAvatar ? (
          <Avatar
            state={avatarStateFor(profile?.picture, profile !== undefined)}
            picture={profile?.picture}
            name={name}
            seed={event.pubkey}
            size={18}
          />
        ) : null}
        <Text bold numberOfLines={1} size={13} style={{ color: withAlpha(foreground, 0.72) }}>
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
  return formatRelativeUnixSeconds(notification.event.created_at);
}

function notificationGroupTimestamp(notifications: readonly FeedNotification[]): string {
  const latest = notifications.reduce(
    (max, notification) => Math.max(max, notification.event.created_at),
    0
  );
  return formatRelativeUnixSeconds(latest);
}

// For a like/repost/zap, tapping the row should open the POST that was engaged
// with — not the reaction/repost/zap event. nagg bundles the full `targetEvent`,
// but the relay/cache tiers only carry `targetEventId` (the post isn't fetched),
// so resolve by id and let the thread screen load it. Falls back to the
// notification's own event for replies/mentions (where the event IS the post).
function notificationOpenEventId(notification: FeedNotification): string {
  if (
    notification.reason === 'reaction' ||
    notification.reason === 'repost' ||
    notification.reason === 'zap'
  ) {
    return notification.targetEventId ?? notification.targetEvent?.id ?? notification.event.id;
  }
  return notification.event.id;
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
  onRetry,
  foreground,
  muted,
}: {
  viewerReady: boolean;
  errorMessage: string | null;
  onRetry?: () => void;
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
    <VStack
      align="center"
      gap={12}
      style={notificationListStyles.emptyState}
      testID={`notifications-empty:${errorMessage ? 'error' : viewerReady ? 'none' : 'no-profile'}`}
      accessible
      accessibilityLabel={title}>
      <Icon name={icon} size={34} color={withAlpha(foreground, 0.45)} />
      <Text size={18} bold style={{ color: foreground, textAlign: 'center' }}>
        {title}
      </Text>
      {subtitle ? (
        <Text size={14} style={{ color: muted, textAlign: 'center' }}>
          {subtitle}
        </Text>
      ) : null}
      {errorMessage && onRetry ? (
        <Button
          text="Try again"
          variant="secondary"
          onPress={onRetry}
          testID="notifications-retry"
        />
      ) : null}
    </VStack>
  );
}

const styles = StyleSheet.create({
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
    // Reason icon (28) + gaps — shallower inset than the follows screen's.
    marginLeft: 72,
  },
});
