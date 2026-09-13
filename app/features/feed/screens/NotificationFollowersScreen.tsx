import { avatarStateFor } from '@/shared/lib/imageLoadState';
import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { withAlpha } from '@/shared/lib/color';

import { tryNpubEncode } from '@/features/feed/components/nostr/feedParse';
import type { FeedNotification, FeedNotificationsResult } from '@/features/feed/data/feedClient';
import { takeNotificationFollowersSeed } from '@/features/feed/lib/notificationFollowersSeedCache';
import { useNotificationFollowersPage } from '@/features/feed/hooks/useNotificationsPage';
import { Button } from '@/shared/ui/primitives/Button';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import {
  useVisualFlatListLogger,
  VISUAL_LIST_VIEWABILITY_CONFIG,
} from '@/shared/lib/contentShiftLog';
import { emptyNotificationsResult } from '@/features/feed/lib/notificationResults';
import { useNotificationPolicyStore } from '@/features/feed/stores/notificationPolicyStore';
import {
  notificationListStyles,
  NotificationRowPressable,
} from '@/features/feed/components/notificationRowChrome';
import { formatRelativeUnixSeconds } from '@/shared/lib/date';
import { List } from '@/shared/ui/composed/List';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { feedLog, Log, useLifecycleLogger } from '@/shared/lib/logger';
import { truncateMiddle } from '@/shared/lib/strings';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { Screen } from '@/shared/ui/composed/Screen';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const NOTIFICATION_FOLLOWERS_VISUAL_SCOPE = 'feed.notification_followers.list';

const EMPTY_RESULT = emptyNotificationsResult();

export function NotificationFollowersScreen() {
  useLifecycleLogger('NotificationFollowersScreen', feedLog);

  const params = useLocalSearchParams<{ seedId?: string }>();
  const seedId = typeof params.seedId === 'string' ? params.seedId : undefined;
  // `takeNotificationFollowersSeed` is a DESTRUCTIVE one-shot read, taken once
  // per mount by a lazy initializer rather than a ref written in render (which
  // React Compiler skips the screen for).
  //
  // ⚠️ Neither shape survives React StrictMode's initial double render: the
  // discarded render consumes the seed and the committed one reads empty. That
  // was equally true of the ref this replaced. StrictMode is off today
  // (`index.js` hands straight to Expo Router); turning it on means making the
  // take idempotent per `seedId` first, not reverting this.
  const [seed] = useState(() => {
    const taken = takeNotificationFollowersSeed(seedId);
    return taken.notifications.length > 0 ? taken : undefined;
  });

  const { keys: nostrKeys } = useNostrKeysContext();
  const viewerPubkey = nostrKeys?.pubkey;
  const policy = useNotificationPolicyStore((state) => state.policy);
  const replyScope = useNotificationPolicyStore((state) => state.replyScope);
  const [foreground, surface, separator, muted, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
    'muted',
    'surface-tertiary',
  ] as const);

  // The page-0 owner: a hand-over seed from the notifications screen is this
  // session's freshest page (no round-trip on first focus); otherwise the
  // cached Follows page paints and revalidates when stale.
  const page = useNotificationFollowersPage({ viewerPubkey, policy, replyScope, seed });
  const result = page.result ?? EMPTY_RESULT;
  const { isInitialLoading, isRefreshing, isLoadingMore, errorMessage } = page;
  const handleRefresh = page.refresh;
  const loadMoreFollowers = page.loadMore;

  const openProfile = useCallback((notification: FeedNotification) => {
    router.push({
      pathname: '/(user-flow)/profile',
      params: { pubkey: notification.event.pubkey },
    });
  }, []);

  const followers = result.notifications;
  const visualPhase = isInitialLoading ? 'initial-loading' : isRefreshing ? 'refreshing' : 'ready';
  const { onListLayout, onListContentSizeChange, onListScroll, onListViewableItemsChanged } =
    useVisualFlatListLogger<FeedNotification>({
      scope: NOTIFICATION_FOLLOWERS_VISUAL_SCOPE,
      surface: 'notifications',
      component: 'NotificationFollowersFlatList',
      phase: visualPhase,
      extra: () => ({
        followers: followers.length,
        rows: followers.length,
        loadingMore: isLoadingMore,
      }),
      remeasureExtra: () => ({
        followers: followers.length,
        loadingMore: isLoadingMore,
      }),
      getItemKey: (notification) => `follower:${notification.event.id}`,
      getItemContext: (notification) => ({
        itemType: notification.reason,
        rowLabel: notification.reason,
      }),
    });

  return (
    <Screen name="NotificationFollowersScreen" scroll="custom" bgColor={surface}>
      <Log name="NotificationFollowersContent" style={notificationListStyles.root}>
        <List
          screen
          data={followers}
          keyExtractor={(notification) => notification.event.id}
          contentContainerStyle={[
            notificationListStyles.listContent,
            followers.length === 0 && notificationListStyles.emptyListContent,
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
                <Spinner
                  size={22}
                  color={withAlpha(foreground, 0.65)}
                  style={notificationListStyles.loader}
                />
              </VisualLayoutProbe>
            ) : (
              <VisualLayoutProbe
                scope={NOTIFICATION_FOLLOWERS_VISUAL_SCOPE}
                surface="notifications"
                component="NotificationFollowersEmptyState"
                itemKey={errorMessage ? 'empty:error' : 'empty:no-results'}
                itemType={errorMessage ? 'error' : 'empty'}
                extra={{ viewerReady: !!viewerPubkey }}>
                <EmptyFollowers
                  errorMessage={errorMessage}
                  onRetry={handleRefresh}
                  foreground={foreground}
                  muted={muted}
                />
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
                <Spinner
                  size={18}
                  color={withAlpha(foreground, 0.65)}
                  style={notificationListStyles.footerSpinner}
                />
              </VisualLayoutProbe>
            ) : null
          }
          onLayout={onListLayout}
          onContentSizeChange={onListContentSizeChange}
          onEndReached={loadMoreFollowers}
          onEndReachedThreshold={0.4}
          onScroll={onListScroll}
          scrollEventThrottle={250}
          viewabilityConfig={VISUAL_LIST_VIEWABILITY_CONFIG}
          onViewableItemsChanged={onListViewableItemsChanged}
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
                pressedBackground={withAlpha(surfaceTertiary, 0.45)}
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
  const timestamp = formatRelativeUnixSeconds(notification.event.created_at);

  return (
    <NotificationRowPressable pressedBackground={pressedBackground} onPress={onPress}>
      <HStack align="center" gap={12}>
        <Avatar
          state={avatarStateFor(profile?.picture, profile !== undefined)}
          picture={profile?.picture}
          name={name}
          seed={notification.event.pubkey}
          size={46}
        />
        <VStack gap={3} flex={1}>
          <HStack
            align="flex-start"
            justify="space-between"
            gap={8}
            style={notificationListStyles.titleLine}>
            <Text
              numberOfLines={2}
              size={16}
              style={[notificationListStyles.titleText, { color: foreground }]}>
              {name} followed you
            </Text>
            {timestamp ? (
              <Text
                numberOfLines={1}
                size={13}
                style={[notificationListStyles.timestampText, { color: muted }]}>
                {timestamp}
              </Text>
            ) : null}
          </HStack>
          <Text size={13} numberOfLines={1} style={{ color: muted }}>
            {displayPubkey}
          </Text>
        </VStack>
      </HStack>
    </NotificationRowPressable>
  );
}

function EmptyFollowers({
  errorMessage,
  onRetry,
  foreground,
  muted,
}: {
  errorMessage: string | null;
  onRetry?: () => void;
  foreground: string;
  muted: string;
}) {
  return (
    <VStack align="center" gap={10} style={notificationListStyles.emptyState}>
      <Text size={18} bold style={{ color: foreground, textAlign: 'center' }}>
        {errorMessage ? 'Follows unavailable' : 'No follows'}
      </Text>
      <Text size={14} style={{ color: muted, textAlign: 'center' }}>
        {errorMessage ?? 'Follow notifications will appear here.'}
      </Text>
      {errorMessage && onRetry ? (
        <Button text="Try again" variant="secondary" onPress={onRetry} testID="followers-retry" />
      ) : null}
    </VStack>
  );
}

const styles = StyleSheet.create({
  separator: {
    height: StyleSheet.hairlineWidth,
    // Avatar (46) + row padding — deeper inset than the notifications tab's.
    marginLeft: 78,
  },
});
