/**
 * @fileoverview User Profile Screen
 *
 * Displays Nostr user profile information with:
 * - Banner image with overlapping avatar
 * - Stats grid (Following, Followers, Reputation, Joined)
 * - Top followers grid
 * - Profile info section (npub, nip05, lud16, website)
 * - User feed (notes)
 */

import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Image as ExpoImage } from 'expo-image';
import { Stack } from 'expo-router';
import { z } from 'zod';
import { Hex64, HttpsUrl, Npub } from '@/shared/lib/nav/routeSchemas';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { TierBadge } from '@/shared/ui/composed/TierBadge';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useFadeRevealProbe } from '@/shared/lib/debug/fadeRevealProbe';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { npubToPubkey } from '@/shared/lib/nostr/client';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { Card } from '@/shared/ui/composed/Card';
import { Section } from '@/shared/ui/composed/Section';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { truncateMiddle } from '@/shared/lib/strings';
import { openExternalUrl } from '@/shared/lib/url';
import * as Clipboard from 'expo-clipboard';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { SkeletonLoadingShimmer } from '@/shared/ui/composed/SkeletonExitShimmer';
import { LightningAddress } from '@sovranbitcoin/schemas';
import { getNpcAddress } from '@/shared/lib/cashu/npc';
import { E2EActionMenuProbe } from '@/shared/lib/popup/E2EActionMenuProbe';
import { usePaymentFlowMachine } from 'wallet/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { SendMessageMenu } from '@/features/user/components/SendMessageMenu';
import { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { Contacts } from 'nostr-tools/kinds';
import * as nip19 from 'nostr-tools/nip19';
import { copyPopup, type CopyTarget, staticPopup, paramPopup } from '@/shared/lib/popup';
import {
  useNostrProfile,
  getFollowersWithProfiles,
  getFollowerDisplayName,
  getFollowerPicture,
  type TopFollower,
} from '@/shared/hooks/useNostrProfile';
import { UserFeed } from '@/features/feed';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import { formatDate } from '@/shared/lib/date';
import { LinearGradient } from 'expo-linear-gradient';
import { getContrastColors, withAlpha } from '@/shared/lib/color';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { buildProfileHref, useActiveProfileFlowGroup } from '@/shared/lib/nav/profileRoutes';
import { buildMintInfoHref, getProfileMintInfoUrl } from '@/shared/lib/nav/mintInfoRoutes';
import {
  selectIsFollowingPubkey,
  useNostrSocialStore,
} from '@/shared/stores/profile/nostrSocialStore';
import { useRecentPeopleStore } from '@/shared/stores/profile/recentPeopleStore';
import { resolveIdentityName } from '@/shared/lib/identity';
import { generateSeededGradient } from '@/shared/lib/avatarGradient';
import { useDominantColor } from '@/shared/lib/colorExtraction';
import type { VideoPostRecord, StoryUser } from '@/features/feed';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useVisualStateLogger } from '@/shared/lib/contentShiftLog';
import {
  Log,
  nostrLog,
  paymentLog,
  useLifecycleLogger,
  mintUrlLogFields,
} from '@/shared/lib/logger';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';

const BANNER_HEIGHT = 150;
const AVATAR_SIZE = 90;
const AVATAR_OVERLAP = AVATAR_SIZE / 4;

const UserProfileParamsSchema = z
  .object({
    npub: Npub.optional(),
    pubkey: Hex64.optional(),
    mintUrl: HttpsUrl.optional(),
  })
  .refine((v) => !!(v.npub || v.pubkey), {
    message: 'either npub or pubkey is required',
    path: ['pubkey'],
  });

function buildUpdatedContactTags(
  existingTags: string[][],
  targetPubkey: string,
  shouldFollow: boolean
): string[][] {
  const nextTags = existingTags.filter((tag) => !(tag[0] === 'p' && tag[1] === targetPubkey));
  if (shouldFollow) {
    nextTags.push(['p', targetPubkey]);
  }
  // Keep one p-tag per pubkey while preserving order for NIP-02 contact lists.
  const seenP = new Set<string>();
  const deduped: string[][] = [];
  for (const tag of nextTags) {
    if (tag[0] !== 'p') {
      deduped.push(tag);
      continue;
    }
    const pk = tag[1];
    if (!pk || seenP.has(pk)) continue;
    seenP.add(pk);
    deduped.push(tag);
  }
  return deduped;
}

function safeNpubEncode(pubkey: string): string {
  if (!pubkey) return '';
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return '';
  }
}

// ============================================================================
// Profile Stats Grid
// ============================================================================

/** Shared height for stat pills + their skeletons so the two never differ. */
const STAT_CARD_HEIGHT = 96;

/**
 * Skeleton placeholder fill — the same low-contrast alpha the thread skeletons
 * and `Text loading` use, so motion reads from the shimmer sweep rather than a
 * per-element pulse. See `shared/ui/composed/SkeletonExitShimmer`.
 */
const SKELETON_FILL_ALPHA = 0.07;

function ProfileStatsGrid({
  followingCount,
  followerCount,
  reputationScore,
  joinedDate,
  isLoading,
  visualScope,
}: {
  followingCount?: number;
  followerCount?: number;
  reputationScore?: number;
  joinedDate?: string;
  isLoading: boolean;
  visualScope: string;
}) {
  const [foreground, surfaceTertiary, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-tertiary',
    'surface-secondary',
  ] as const);

  const hasValidData =
    followingCount !== undefined ||
    followerCount !== undefined ||
    reputationScore !== undefined ||
    joinedDate !== undefined;

  const stats = [
    {
      label: 'Following',
      description: 'Users followed',
      value: followingCount?.toString() ?? '0',
      smallValue: false,
      valueLoading: isLoading && followingCount === undefined,
    },
    {
      label: 'Followers',
      description: 'Total count',
      value: followerCount?.toString() ?? '0',
      smallValue: false,
      valueLoading: isLoading && followerCount === undefined,
    },
    {
      label: 'Reputation',
      description: 'Network score',
      value: reputationScore !== undefined ? `${Math.round(reputationScore)} / 100` : 'N/A',
      smallValue: false,
      valueLoading: isLoading && reputationScore === undefined,
    },
    {
      label: 'Joined',
      description: 'Account created',
      value: joinedDate || 'Unknown',
      smallValue: true,
      valueLoading: isLoading && joinedDate === undefined,
    },
  ];

  const showSkeleton = isLoading && !hasValidData;
  // Collapse to a two-pill layout only once loading has settled — during a
  // partial load `reputationScore` is still undefined, and flipping layout then
  // would snap the grid the moment the score arrived.
  const reputationUnavailable = !isLoading && reputationScore === undefined;

  const renderStatCard = (stat: (typeof stats)[0]) => (
    <View key={stat.label} style={styles.statItem}>
      {showSkeleton ? (
        // One placeholder for the whole pill (not three stacked text
        // skeletons). Thread-style: a static low-contrast box — the motion
        // comes from the SkeletonLoadingShimmer sweeping the whole grid.
        <View
          style={[
            styles.statCardSkeleton,
            { backgroundColor: withAlpha(foreground, SKELETON_FILL_ALPHA) },
          ]}
        />
      ) : (
        <View
          style={[
            styles.statCard,
            { backgroundColor: surfaceSecondary, borderColor: surfaceTertiary },
          ]}>
          <Text bold size={12} style={{ color: withAlpha(foreground, 0.66), marginBottom: 4 }}>
            {stat.label.toUpperCase()}
          </Text>
          <Text
            loading={stat.valueLoading}
            placeholder="1,234"
            bold
            size={stat.smallValue ? 16 : 20}
            style={{ color: foreground, marginBottom: 2 }}>
            {stat.value}
          </Text>
          <Text bold size={12} style={{ color: withAlpha(foreground, 0.5), opacity: 0.8 }}>
            {stat.description}
          </Text>
        </View>
      )}
    </View>
  );

  // Settled with nothing reliable to show — relay-only mode can't fetch
  // follower/following counts (a reverse index relays don't have), reputation,
  // or joined date. Render no grid rather than misleading "0 / 0 / N/A".
  if (!isLoading && !hasValidData) return null;

  // While loading: 2×2 placeholders under one shimmer sweep (thread-style),
  // rather than four independently-pulsing boxes.
  if (showSkeleton) {
    return (
      <VisualLayoutProbe
        scope={visualScope}
        surface="profile"
        component="ProfileStatsGrid"
        itemKey="stats-skeleton"
        itemType="skeleton"
        style={styles.statsGrid}
        extra={{ isLoading }}>
        <View style={styles.statsRow}>{stats.slice(0, 2).map(renderStatCard)}</View>
        <View style={styles.statsRow}>{stats.slice(2, 4).map(renderStatCard)}</View>
        <SkeletonLoadingShimmer active />
      </VisualLayoutProbe>
    );
  }

  // Reputation unavailable → Following/Followers stay as pills, Joined drops to
  // a small caption beneath them so we show two pills + text instead of "N/A".
  if (reputationUnavailable) {
    return (
      <VisualLayoutProbe
        scope={visualScope}
        surface="profile"
        component="ProfileStatsGrid"
        itemKey="stats-loaded-compact"
        itemType="loaded"
        style={styles.statsGrid}
        extra={{ reputationUnavailable }}>
        <View style={styles.statsRow}>
          {renderStatCard(stats[0])}
          {renderStatCard(stats[1])}
        </View>
        <Text
          size={13}
          style={{
            color: withAlpha(foreground, 0.5),
            textAlign: 'center',
            marginTop: 12,
            paddingHorizontal: 6,
          }}>
          Joined {joinedDate || 'Unknown'}
        </Text>
      </VisualLayoutProbe>
    );
  }

  return (
    <VisualLayoutProbe
      scope={visualScope}
      surface="profile"
      component="ProfileStatsGrid"
      itemKey="stats-loaded"
      itemType="loaded"
      style={styles.statsGrid}
      extra={{ reputationUnavailable }}>
      <View style={styles.statsRow}>{stats.slice(0, 2).map(renderStatCard)}</View>
      <View style={styles.statsRow}>{stats.slice(2, 4).map(renderStatCard)}</View>
    </VisualLayoutProbe>
  );
}

// ============================================================================
// Top Followers Section
// ============================================================================

function TopFollowers({
  topFollowers,
  isLoading,
  visualScope,
}: {
  topFollowers: TopFollower[];
  isLoading: boolean;
  visualScope: string;
}) {
  const foreground = useThemeColor('foreground');
  const profileFlowGroup = useActiveProfileFlowGroup();
  const { width: screenWidth } = useWindowDimensions();
  const fadeAnim = useSharedValue(0);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.value }));
  // Once revealed, opacity is handed back to React as a static style: a Fabric
  // re-render commit can rebuild this view's props from the JS-side style and
  // silently drop the UI-thread-applied opacity (elements vanish while the
  // shared value still reads 1). A plain style can't be clobbered.
  const [fadeSettled, setFadeSettled] = useState(false);
  const settleFade = () => setFadeSettled(true);

  const GRID_PADDING = 32;
  const GRID_GAP = 12;
  const COLUMNS = 3;
  const itemWidth = (screenWidth - GRID_PADDING - GRID_GAP * (COLUMNS - 1)) / COLUMNS;
  const avatarSize = Math.min(itemWidth - 16, 64);

  const followersWithProfiles = getFollowersWithProfiles(topFollowers).slice(0, 6);

  useEffect(() => {
    if (followersWithProfiles.length > 0) {
      fadeAnim.value = withTiming(
        1,
        { duration: 400, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(settleFade)();
        }
      );
      // Failsafe: settle even if the completion callback is lost mid-churn.
      const timer = setTimeout(settleFade, 1000);
      return () => clearTimeout(timer);
    }
  }, [followersWithProfiles.length, fadeAnim, settleFade]);
  // [DEBUG-inv] catches the reveal animation never flushing (invisible follower grid)
  useFadeRevealProbe('profile.topFollowers', fadeAnim, {
    enabled: followersWithProfiles.length > 0,
    deadlineMs: 1400,
  });

  if (!isLoading && followersWithProfiles.length === 0) return null;

  const handleFollowerPress = (follower: TopFollower) => {
    // push (not navigate) so each profile pushes a new stack entry; tapping
    // through follower → follower-of-follower then back returns step by step.
    router.push(buildProfileHref('profile', { npub: follower.npub }, profileFlowGroup) as never);
  };

  const renderItem = (follower: TopFollower) => (
    <Pressable
      key={follower.pubkey}
      style={[styles.topFollowerGridItem, { width: itemWidth }]}
      onPress={() => handleFollowerPress(follower)}
      activeOpacity={0.7}>
      <Avatar
        state={getFollowerPicture(follower) ? 'image' : 'fallback'}
        picture={getFollowerPicture(follower)}
        seed={follower.pubkey}
        size={avatarSize}
        name={getFollowerDisplayName(follower)}
      />
      <Text
        size={11}
        bold
        numberOfLines={1}
        style={{
          color: withAlpha(foreground, 0.66),
          marginTop: 6,
          textAlign: 'center',
          width: itemWidth - 8,
        }}>
        {getFollowerDisplayName(follower)}
      </Text>
    </Pressable>
  );

  const renderSkeleton = (index: number) => (
    <View key={index} style={[styles.topFollowerGridItem, { width: itemWidth }]}>
      <Avatar state="loading" size={avatarSize} />
      <View
        style={{
          width: itemWidth - 24,
          height: 12,
          borderRadius: 4,
          marginTop: 6,
          backgroundColor: withAlpha(foreground, SKELETON_FILL_ALPHA),
        }}
      />
    </View>
  );

  return (
    <VisualLayoutProbe
      scope={visualScope}
      surface="profile"
      component="TopFollowers"
      itemKey={isLoading ? 'top-followers-skeleton' : 'top-followers-loaded'}
      itemType={isLoading ? 'skeleton' : 'loaded'}
      style={styles.topFollowersSection}
      extra={{ isLoading, followers: followersWithProfiles.length }}>
      <Text
        bold
        size={12}
        style={{ color: withAlpha(foreground, 0.4), marginBottom: 12, marginLeft: 4 }}>
        TOP FOLLOWERS
      </Text>
      {isLoading ? (
        <View style={styles.topFollowersGrid}>
          {[0, 1, 2, 3, 4, 5].map(renderSkeleton)}
          <SkeletonLoadingShimmer active />
        </View>
      ) : (
        <Animated.View style={fadeSettled ? styles.settledReveal : fadeStyle}>
          <View style={styles.topFollowersGrid}>{followersWithProfiles.map(renderItem)}</View>
        </Animated.View>
      )}
      <Spacer size={16} />
    </VisualLayoutProbe>
  );
}

// ============================================================================
// Banner with Overlapping Avatar
// ============================================================================

function BannerWithAvatar({
  bannerUrl,
  pictureUrl,
  pubkey,
  displayName,
  nip05,
  isLoading,
  isResolving,
  showFollowButton,
  isFollowing,
  isFollowLoading,
  onToggleFollow,
  onSendMoney,
  hasStories,
  onAvatarPress,
  visualScope,
}: {
  bannerUrl?: string;
  pictureUrl?: string;
  pubkey: string;
  displayName: string;
  nip05?: string;
  isLoading: boolean;
  /** Kind-0 fetch still needed/in flight (see useNostrProfileMetadata). While
   *  true, avatar/banner without an image stay on the loading placeholder
   *  instead of revealing the generative fallback a fetch may replace. */
  isResolving: boolean;
  showFollowButton: boolean;
  isFollowing: boolean;
  isFollowLoading: boolean;
  onToggleFollow: () => void;
  onSendMoney: () => void;
  hasStories?: boolean;
  onAvatarPress?: () => void;
  visualScope: string;
}) {
  const [foreground, surfaceSecondary, background] = useThemeColor([
    'foreground',
    'surface-secondary',
    'background',
  ] as const);
  const fadeAnim = useSharedValue(0);
  const avatarStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
    transform: [{ scale: fadeAnim.value }],
  }));
  // Once revealed, opacity/scale are handed back to React as a static style —
  // a Fabric re-render commit can drop UI-thread-applied props (the invisible
  // pfp+ring), and this header re-renders constantly. See settledReveal.
  const [avatarSettled, setAvatarSettled] = useState(false);
  const settleAvatar = () => setAvatarSettled(true);
  const [bannerStatus, setBannerStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');

  const fallbackIndex = pubkey ? parseInt(pubkey.slice(0, 8), 16) % 8 : 0;
  const bannerError = bannerStatus === 'failed';
  const hasBannerImage = Boolean(bannerUrl && !bannerError);
  // Mirror Avatar's state model for the banner:
  //   - 'image'    → bannerUrl resolved and loaded
  //   - 'loading'  → bannerUrl still loading, OR the kind-0 that decides
  //                  whether a banner exists is still resolving
  //   - 'fallback' → metadata settled with no banner, OR banner load failed
  // `isResolving` (not just isLoading) gates the fallback so a seeded
  // name-only record revalidating in the background never flashes the seeded
  // gradient before the real banner arrives — always placeholder → final.
  const bannerState: 'loading' | 'image' | 'fallback' = hasBannerImage
    ? bannerStatus === 'loaded'
      ? 'image'
      : 'loading'
    : isLoading || isResolving
      ? 'loading'
      : 'fallback';
  const pfpColors = useDominantColor(pictureUrl, fallbackIndex);
  const bannerColors = useDominantColor(
    !pictureUrl && hasBannerImage ? bannerUrl : undefined,
    fallbackIndex
  );

  const bannerGradientTheme = generateSeededGradient(`${pubkey || 'default'}`);

  const gradientSource =
    pictureUrl && pfpColors.hasExtractedColors
      ? 'pfp'
      : hasBannerImage && bannerColors.hasExtractedColors
        ? 'banner'
        : 'seeded';

  const imageGradientColors = (() => {
    if (gradientSource === 'pfp') {
      const { contrastColor } = getContrastColors(pfpColors.baseColor, 0.3);
      return [pfpColors.baseColor, contrastColor] as const;
    }
    if (gradientSource === 'banner') {
      const { contrastColor } = getContrastColors(bannerColors.baseColor, 0.3);
      return [bannerColors.baseColor, contrastColor] as const;
    }
    return null;
  })();

  useEffect(() => {
    setBannerStatus('loading');
  }, [bannerUrl]);

  useEffect(() => {
    fadeAnim.value = withTiming(
      1,
      { duration: 500, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(settleAvatar)();
      }
    );
    // Failsafe: settle even if the completion callback is lost mid-churn.
    const timer = setTimeout(settleAvatar, 1100);
    return () => clearTimeout(timer);
  }, [fadeAnim, settleAvatar]);
  // [DEBUG-inv] catches the reveal animation never flushing (invisible pfp)
  useFadeRevealProbe('profile.avatar', fadeAnim, { deadlineMs: 1500 });

  const avatarContent = (
    <View style={[styles.avatarBorder, { borderColor: background, backgroundColor: background }]}>
      <Avatar
        state={pictureUrl ? 'image' : isLoading || isResolving ? 'loading' : 'fallback'}
        picture={pictureUrl}
        seed={pubkey}
        size={AVATAR_SIZE}
        name={displayName}
      />
    </View>
  );

  const seededGradientFill = (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={bannerGradientTheme.primaryColors}
        start={bannerGradientTheme.primaryStart}
        end={bannerGradientTheme.primaryEnd}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={bannerGradientTheme.overlayColors}
        start={bannerGradientTheme.overlayStart}
        end={bannerGradientTheme.overlayEnd}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );

  return (
    <VisualLayoutProbe
      scope={visualScope}
      surface="profile"
      component="ProfileBannerHeader"
      itemKey="profile-banner-header"
      itemType={bannerState}
      extra={{
        isLoading,
        bannerState,
        showFollowButton,
        isFollowLoading,
        hasStories: !!hasStories,
      }}>
      {/* Banner */}
      <View style={[styles.bannerContainer, { backgroundColor: surfaceSecondary }]}>
        {bannerState === 'loading' ? (
          <>
            {/* Keep the image mounted (invisibly) while it loads so onLoad fires
                and we can transition loading → image without a gradient flash. */}
            {hasBannerImage ? (
              <ExpoImage
                source={{ uri: bannerUrl }}
                style={[StyleSheet.absoluteFill, { opacity: 0 }]}
                contentFit="cover"
                cachePolicy="disk"
                recyclingKey={bannerUrl}
                onLoad={() => setBannerStatus('loaded')}
                onError={() => setBannerStatus('failed')}
              />
            ) : null}
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(foreground, 0.5) }]}
            />
          </>
        ) : bannerState === 'image' ? (
          <>
            <ExpoImage
              source={{ uri: bannerUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="disk"
              recyclingKey={bannerUrl}
              onError={() => setBannerStatus('failed')}
            />
            {imageGradientColors ? (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: withAlpha(imageGradientColors[0], 0.05) },
                  ]}
                />
                <LinearGradient
                  colors={[withAlpha(imageGradientColors[0], 0.28), 'transparent']}
                  locations={[0, 0.8]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <LinearGradient
                  colors={[
                    withAlpha(imageGradientColors[1], 0.2),
                    'transparent',
                    withAlpha(imageGradientColors[0], 0.18),
                  ]}
                  locations={[0, 0.55, 1]}
                  start={{ x: 1, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <LinearGradient
                  colors={['rgba(255,255,255,0.06)', 'transparent']}
                  locations={[0, 0.7]}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            ) : (
              seededGradientFill
            )}
          </>
        ) : imageGradientColors ? (
          <View style={StyleSheet.absoluteFill}>
            <LinearGradient
              colors={imageGradientColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
        ) : (
          seededGradientFill
        )}
      </View>

      {/* Avatar - positioned to overlap banner */}
      <Animated.View
        style={[styles.avatarContainer, avatarSettled ? styles.settledReveal : avatarStyle]}>
        {hasStories && onAvatarPress ? (
          <Pressable activeOpacity={0.8} onPress={onAvatarPress}>
            {avatarContent}
          </Pressable>
        ) : (
          avatarContent
        )}
      </Animated.View>

      {/* Name and NIP-05 */}
      <VStack align="center" style={{ marginTop: 8 }}>
        {/* Identity block \u2014 name, nip-05 and the follow button share one
            ambient shimmer sweep while loading (the thread skeleton treatment)
            instead of independently pulsing. */}
        <View style={styles.identityBlock}>
          <View style={{ alignSelf: 'center' }}>
            <Text
              loading={isLoading}
              placeholder="Display Name"
              bold
              size={22}
              style={{
                color: foreground,
                includeFontPadding: false,
                lineHeight: Math.round(22 * 1.25),
              }}>
              {displayName}
            </Text>
          </View>
          {(isLoading || nip05) && (
            <View style={{ alignSelf: 'center' }}>
              <HStack align="center" gap={4}>
                {!isLoading && (
                  <Icon name="mdi:check-decagram" size={16} color={withAlpha(foreground, 0.4)} />
                )}
                <Text
                  loading={isLoading}
                  placeholder="username@relay.example"
                  size={14}
                  style={{ color: withAlpha(foreground, 0.4) }}>
                  {nip05 || '\u00A0'}
                </Text>
              </HStack>
            </View>
          )}
          {showFollowButton &&
            (isLoading ? (
              <View
                style={[
                  styles.followButton,
                  {
                    backgroundColor: withAlpha(foreground, SKELETON_FILL_ALPHA),
                    borderColor: 'transparent',
                  },
                ]}
              />
            ) : (
              // Reuses the status-pill CapsuleButton. Unfollowed → `filled`
              // solid-foreground CTA (inverted content) to draw the tap;
              // following → `isActive` tinted pill. Both honored across
              // liquid-glass, blur and flat.
              <CapsuleButton
                label={isFollowing ? 'Following' : 'Follow'}
                icon={isFollowing ? 'mdi:check' : 'la:user-plus'}
                systemIcon={isFollowing ? 'checkmark' : 'person.badge.plus'}
                isActive={isFollowing}
                filled={!isFollowing}
                onPress={isFollowLoading ? () => {} : onToggleFollow}
                fitContent
                height={34}
                iconSize={15}
                textSize={13}
                style={[styles.followCapsule, isFollowLoading && styles.followButtonDisabled]}
                testID="profile-follow-button"
              />
            ))}
          {isLoading && <SkeletonLoadingShimmer active />}
        </View>

        {/* Send Money / Message — the wallet circle-action affordance, grouped
            directly under the Follow button. Gated on showFollowButton so it
            only shows for other people's profiles once our keys resolve. */}
        {showFollowButton && (
          <HStack justify="center" gap={28} style={{ marginTop: 16 }}>
            <CircleActionButton
              icon="mdi:cash-multiple"
              systemIcon="bitcoinsign.circle"
              label="Send Money"
              testID="profile-send-money"
              onPress={onSendMoney}
            />
            <SendMessageMenu pubkey={pubkey} displayName={displayName} circle />
          </HStack>
        )}
      </VStack>
    </VisualLayoutProbe>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function UserProfileScreen() {
  useLifecycleLogger('UserProfileScreen', nostrLog);

  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const profileFlowGroup = useActiveProfileFlowGroup();
  const { ndk } = useNDK();
  const { keys: nostrKeys } = useNostrKeysContext();
  const params = useRouteParams(UserProfileParamsSchema, {
    where: 'user-flow.profile',
  });
  const npubParam = params?.npub;
  const pubkeyParam = params?.pubkey;
  const mintUrlParam = params?.mintUrl;

  const pubkey = pubkeyParam || (npubParam ? npubToPubkey(npubParam) : '');
  const profileHeaderVisualScope = `profile.${pubkey ? pubkey.slice(0, 12) : 'unknown'}.header`;
  const addRecentPerson = useRecentPeopleStore((state) => state.addRecentPerson);

  useEffect(() => {
    if (pubkey) addRecentPerson(pubkey);
  }, [addRecentPerson, pubkey]);

  const npub = npubParam || safeNpubEncode(pubkey);

  const isOwnProfile = !!nostrKeys?.pubkey && nostrKeys.pubkey === pubkey;

  // ===========================
  // NOSTR SUBSCRIPTIONS & API
  // ===========================

  // Counterparty kind-0 metadata served from the shared SWR cache.
  // The same hook drives `UserMessagesScreen`, so navigating
  // Profile → Send Message hits a warm cache and the conversation
  // header renders instantly with the right name + avatar (and the
  // /(user-flow)/userMessages route avoids a duplicate kind-0
  // fetch). First open per session pays one round-trip; the cache
  // entry is shared across surfaces and persists across launches.
  const {
    metadata: cachedProfile,
    isLoading: isMetadataLoading,
    isResolving: isMetadataResolving,
  } = useNostrProfileMetadata(pubkey);

  const contactsTags = useNostrSocialStore((state) => state.contactsTags);
  const contactsContent = useNostrSocialStore((state) => state.contactsContent);
  const setContactsFromRelay = useNostrSocialStore((state) => state.setContactsFromRelay);
  const setFollowOptimistic = useNostrSocialStore((state) => state.setFollowOptimistic);
  const clearFollowOptimistic = useNostrSocialStore((state) => state.clearFollowOptimistic);
  const followOptimisticEntry = useNostrSocialStore((state) =>
    pubkey ? state.optimisticFollowsByPubkey[pubkey] : undefined
  );
  const { data: profileData, isLoading: isProfileApiLoading } = useNostrProfile(pubkey || null);
  const profileMintUrl = getProfileMintInfoUrl(profileData?.mintUrl, mintUrlParam);

  // ===========================
  // DERIVED STATE
  // ===========================

  // Same hierarchy whether it's our own or a foreign profile — drawer-style
  // deterministic word pair after metadata. truncateMiddle(npub, …) is no
  // longer used as a name; the npub still appears as a copy-row in the
  // profile body.
  const displayName = resolveIdentityName({ pubkey, nostrProfile: cachedProfile });

  // Send Money enters through colada's normal Send entrypoint so no-balance
  // and multi-mint selection behavior stays identical to the wallet Send
  // button (same pattern as UserMessagesScreen). Gated on a valid lightning
  // address in the profile metadata.
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });
  const rawLud16 = cachedProfile?.lud16;
  const lud16 = rawLud16 && LightningAddress.safeParse(rawLud16).success ? rawLud16 : undefined;
  // No (valid) lud16 in the profile → fall back to the recipient's npub.cash
  // address: every Nostr pubkey is payable at <npub>@npub.cash, so money can
  // always be sent. The send flow's Select-option menu labels the Lightning
  // variant "to npub.cash" for npc targets, so the destination stays explicit.
  const npcFallback = npub ? getNpcAddress(undefined, npub) : undefined;
  const meltTarget = lud16 ?? npcFallback;
  const handleSendMoney = () => {
    if (!meltTarget) {
      paymentLog.warn('user.profile.send_money.unavailable', {
        recipientPubkeyLength: pubkey.length,
        hasRawLightningAddress: !!rawLud16,
        rawLightningAddressLength: rawLud16?.length ?? 0,
      });
      // Only reachable when the pubkey couldn't even encode to an npub.
      paramPopup('action-unavailable', {
        title: "Can't send money",
        message: `${displayName} hasn't set up a Lightning address.`,
      });
      return;
    }
    clearPaymentContext('user.profile.send_money');
    paymentLog.info('user.profile.send_money.start', {
      recipientPubkeyLength: pubkey.length,
      meltTargetLength: meltTarget.length,
      usedNpcFallback: !lud16,
      hasDisplayName: displayName.length > 0,
      hasAvatarUrl: !!cachedProfile?.picture,
      hasNip05: !!cachedProfile?.nip05,
    });
    void (async () => {
      try {
        await machine.startSendEcash({
          reset: true,
          meltTarget,
          recipientPubkey: pubkey,
          recipientProfile: {
            displayName,
            avatarUrl: cachedProfile?.picture ?? null,
            nip05: cachedProfile?.nip05 ?? null,
          },
        });
        paymentLog.info('user.profile.send_money.started', {
          recipientPubkeyLength: pubkey.length,
          meltTargetLength: meltTarget.length,
        });
      } catch (error) {
        paymentLog.warn('user.profile.send_money.failed_to_start', {
          recipientPubkeyLength: pubkey.length,
          meltTargetLength: meltTarget.length,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    })();
  };

  const followerCount = profileData?.followers;
  const reputationScore = typeof profileData?.score === 'number' ? profileData.score : undefined;
  const joinedDate =
    typeof profileData?.created_at === 'number'
      ? formatDate(profileData.created_at * 1000, 'long-date')
      : undefined;

  // Our kind:3 contacts are synced globally by useOwnEventsSync (which also
  // settles follow optimism); no per-screen contact subscription needed.

  // Displayed aggregation counts come from Vertex (nagg) everywhere for
  // consistency — follower and following alike, own profile included. Using a
  // single source keeps the stats grid's skeleton decision identical for every
  // profile: a cold load shows the unified whole-pill skeleton rather than the
  // own-profile-only path where a local kind-3 fallback made `followingCount`
  // present and collapsed the grid into per-text placeholders. The local
  // `followingPubkeys` set still drives follow/unfollow membership logic; only
  // the displayed total uses Vertex.
  const followingCount = profileData?.follows;
  // Selector returns a primitive, so a per-render selector identity is safe.
  const isFollowingProfile = useNostrSocialStore(selectIsFollowingPubkey(pubkey || ''));
  const followInFlight = !!followOptimisticEntry?.pending;

  // ===========================
  // VIDEO STORIES STATE
  // ===========================

  const [userVideoPosts, setUserVideoPosts] = useState<VideoPostRecord[]>([]);
  const hasStories = userVideoPosts.length > 0;

  const handleVideoPostsReady = (videoPosts: VideoPostRecord[]) => {
    setUserVideoPosts(videoPosts);
  };

  const handleAvatarStoryPress = () => {
    if (userVideoPosts.length === 0) return;
    nostrLog.info('user.profile.story.view', { pubkey, videoCount: userVideoPosts.length });
    const storyUser: StoryUser = {
      pubkey,
      profile: cachedProfile ? { name: displayName, picture: cachedProfile.picture } : undefined,
      videoPosts: userVideoPosts,
    };
    router.navigate({
      pathname: '/(stories-flow)/stories',
      params: {
        startIndex: '0',
        storyUsersJson: JSON.stringify([storyUser]),
      },
    });
  };

  // ===========================
  // HANDLERS
  // ===========================

  const handleCopy = async (text: string, target: CopyTarget) => {
    try {
      nostrLog.info('user.profile.copy', { target });
      await Clipboard.setStringAsync(text);
      copyPopup(target);
    } catch (e) {
      nostrLog.error('user.profile.copy.failed', {
        target,
        error: e instanceof Error ? e : new Error(String(e)),
      });
      staticPopup('copy-failed');
    }
  };

  const handleOpenLink = async (url: string) => {
    nostrLog.info('user.profile.open_link', { url });
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const result = await openExternalUrl(fullUrl);
    if (result.isErr()) {
      nostrLog.error('user.profile.open_link.failed', { url, reason: result.error.type });
      staticPopup('open-link-failed');
    }
  };

  const handleToggleFollowInner = async () => {
    if (!pubkey || !nostrKeys?.pubkey || !ndk) {
      nostrLog.warn('user.profile.follow.precondition_failed', {
        hasPubkey: !!pubkey,
        hasNostrKeys: !!nostrKeys?.pubkey,
        hasNdk: !!ndk,
      });
      paramPopup('engagement-update-failed', 'follow');
      return;
    }
    if (nostrKeys.pubkey === pubkey || followInFlight) return;

    const shouldFollow = !isFollowingProfile;
    nostrLog.info('user.profile.follow.toggle', { pubkey, shouldFollow });
    setFollowOptimistic(pubkey, shouldFollow, true);

    const nextTags = buildUpdatedContactTags(
      contactsTags.map((tag) => [...tag]),
      pubkey,
      shouldFollow
    );
    const createdAt = Math.floor(Date.now() / 1000);

    try {
      const contactEvent = new NDKEvent(ndk);
      contactEvent.kind = Contacts;
      contactEvent.tags = nextTags;
      contactEvent.content = contactsContent;
      contactEvent.created_at = createdAt;
      // Contact list is replaceable + important: land it on as many write relays
      // as possible via the central seam (outbox-aware, with retry).
      const published = await publishEvent({ ndk, event: contactEvent, resolveOn: 'all-settled' });
      if (published.isErr()) throw new Error('contacts publish failed');
      nostrLog.info('user.profile.follow.published', { pubkey, shouldFollow });
      setContactsFromRelay({ tags: nextTags, content: contactsContent, createdAt });
      clearFollowOptimistic(pubkey);
    } catch (e) {
      nostrLog.error('user.profile.follow.failed', {
        pubkey,
        error: e instanceof Error ? e : new Error(String(e)),
      });
      clearFollowOptimistic(pubkey);
      paramPopup('engagement-update-failed', 'follow');
    }
  };

  // `followInFlight` is store-derived state and lands a render too late;
  // a rapid double-tap on Follow runs `setFollowOptimistic` twice and races
  // a second kind-3 publish with the first's `clearFollowOptimistic`.
  const handleToggleFollow = useSingleFlight(handleToggleFollowInner);

  const handleMintInfoPress = () => {
    if (!profileMintUrl) return;
    paymentLog.info('user.profile.mint_info.open', {
      ...mintUrlLogFields(profileMintUrl),
      source: mintUrlParam ? 'route_param' : 'profile_api',
    });
    router.navigate(buildMintInfoHref(profileMintUrl));
  };

  // ===========================
  // PROFILE INFO ITEMS (data-driven)
  // ===========================

  const iconColor = withAlpha(foreground, 0.4);

  const profileInfoItems = (() => {
    const items: {
      key: string;
      prefix: React.ReactNode;
      title: string;
      suffixIcon: string;
      onPress: () => void;
    }[] = [
      {
        key: 'npub',
        prefix: <CurrencyIcon colors={[iconColor]} width={20} currency="nostr" />,
        title: truncateMiddle(npub, 10),
        suffixIcon: 'lets-icons:copy',
        onPress: () => {
          void handleCopy(npub, 'npub');
        },
      },
    ];

    if (cachedProfile?.nip05) {
      const nip05 = cachedProfile.nip05;
      items.push({
        key: 'nip05',
        prefix: <Icon name="mdi:check-decagram" size={20} color={iconColor} />,
        title: nip05,
        suffixIcon: 'lets-icons:copy',
        onPress: () => {
          void handleCopy(nip05, 'nip05');
        },
      });
    }

    if (cachedProfile?.lud16) {
      const lud16 = cachedProfile.lud16;
      items.push({
        key: 'lud16',
        prefix: <Icon name="mdi:lightning-bolt" size={20} color={iconColor} />,
        title: lud16,
        suffixIcon: 'lets-icons:copy',
        onPress: () => {
          void handleCopy(lud16, 'lud16');
        },
      });
    }

    if (cachedProfile?.website) {
      const website = cachedProfile.website;
      items.push({
        key: 'website',
        prefix: <Icon name="mdi:web" size={20} color={iconColor} />,
        title: website,
        suffixIcon: 'mdi:open-in-new',
        onPress: () => {
          void handleOpenLink(website);
        },
      });
    }

    return items;
  })();

  useVisualStateLogger({
    enabled: !!pubkey,
    scope: profileHeaderVisualScope,
    surface: 'profile',
    component: 'UserProfileScreen',
    stateKey: 'profile-state',
    phase: isMetadataLoading
      ? 'metadata-loading'
      : isProfileApiLoading
        ? 'profile-api-loading'
        : followInFlight
          ? 'follow-updating'
          : 'ready',
    state: {
      aboutVisible: Boolean(cachedProfile?.about),
      bannerKnown: Boolean(cachedProfile?.banner),
      displayNameKnown: displayName.length > 0,
      followerCountKnown: followerCount !== undefined,
      followingCountKnown: followingCount !== undefined,
      followInFlight,
      hasMintUrl: Boolean(profileMintUrl),
      hasStories,
      isFollowingProfile,
      isMetadataLoading,
      isOwnProfile,
      isProfileApiLoading,
      lud16Known: Boolean(cachedProfile?.lud16),
      nip05Known: Boolean(cachedProfile?.nip05),
      pictureKnown: Boolean(cachedProfile?.picture),
      profileInfoRows: profileInfoItems.length,
      reputationKnown: reputationScore !== undefined,
      showFollowButton: !!nostrKeys?.pubkey && !isOwnProfile && !!pubkey,
      topFollowers: profileData?.topFollowers?.length ?? 0,
      videos: userVideoPosts.length,
      websiteKnown: Boolean(cachedProfile?.website),
    },
    remeasure: {
      reason: 'profile-state',
      minIntervalMs: 300,
      maxItems: 24,
    },
  });

  return (
    <Log name="UserProfileScreen" style={{ flex: 1, backgroundColor: background }}>
      {/* The Send-Message/Send-Money menus present in a FullWindowOverlay whose
          rows never reach iOS AX — this dev-only marker is the waitable
          evidence e2e uses before a coordinate row selection. */}
      <E2EActionMenuProbe />
      {/* e2e marker: the profile screen has no other stable AX root (stats
          labels collide with the drawer, header actions are AX-collapsed); the
          suffix distinguishes the viewer's OWN profile from someone else's. */}
      <View
        testID={isOwnProfile ? 'user-profile:own' : 'user-profile:other'}
        accessible
        accessibilityRole="text"
        accessibilityLabel="Profile screen probe"
        importantForAccessibility="yes"
        collapsable={false}
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1 }}
      />
      <Stack.Screen
        options={withGlassHeaderItems({
          title: isMetadataLoading ? 'Profile' : displayName,
          // The profile renders its own full-bleed banner at the top — the
          // default Android header scrim painted a theme-background band
          // over it. A null headerBackground is the sanctioned scrim opt-out
          // (renders nothing in both the native-header and sheet-header
          // paths); only NON-null per-screen backgrounds are forbidden on
          // sheet flows.
          ...(Platform.OS === 'android' ? { headerBackground: () => null } : {}),
          headerRight: () => (
            <HStack gap={4}>
              {profileMintUrl && (
                <ScreenHeaderAction
                  icon="mingcute:bank-fill"
                  onPress={handleMintInfoPress}
                  testID="profile-mint-info"
                />
              )}
              <ScreenHeaderAction
                icon="mdi:qrcode"
                testID="profile-share-qr"
                onPress={() =>
                  router.push(
                    buildProfileHref(
                      'share',
                      {
                        type: 'npub',
                        data: npub,
                        ...(cachedProfile?.lud16 && { lud16: cachedProfile.lud16 }),
                      },
                      profileFlowGroup
                    ) as never
                  )
                }
              />
            </HStack>
          ),
        })}
      />

      {pubkey ? (
        <UserFeed
          pubkey={pubkey}
          authorName={displayName}
          authorPicture={cachedProfile?.picture}
          isOwnProfile={isOwnProfile}
          onVideoPostsReady={handleVideoPostsReady}
          ListHeaderComponent={
            <View>
              <BannerWithAvatar
                bannerUrl={cachedProfile?.banner}
                pictureUrl={cachedProfile?.picture}
                pubkey={pubkey}
                displayName={displayName}
                nip05={cachedProfile?.nip05}
                isLoading={isMetadataLoading}
                isResolving={isMetadataResolving}
                // Wait until our own keys are known before deciding whether to
                // show the follow button. Otherwise on own-profile open we would
                // briefly render the skeleton (isOwnProfile=false until keys load),
                // then unmount it once `isOwnProfile` flips true — a content shift
                // every time you open your own profile.
                showFollowButton={!!nostrKeys?.pubkey && !isOwnProfile && !!pubkey}
                isFollowing={isFollowingProfile}
                isFollowLoading={followInFlight}
                onToggleFollow={handleToggleFollow}
                onSendMoney={handleSendMoney}
                hasStories={hasStories}
                onAvatarPress={handleAvatarStoryPress}
                visualScope={profileHeaderVisualScope}
              />

              <Spacer size={16} />

              {/* Stats Grid (dev tier badge: which source served this profile) */}
              <View style={{ paddingHorizontal: 16 }}>
                {pubkey ? (
                  <View style={{ position: 'absolute', right: 20, top: -12, zIndex: 1 }}>
                    <TierBadge eventId={pubkey} />
                  </View>
                ) : null}
                <ProfileStatsGrid
                  followingCount={followingCount}
                  followerCount={followerCount}
                  reputationScore={reputationScore}
                  joinedDate={joinedDate}
                  isLoading={isProfileApiLoading}
                  visualScope={profileHeaderVisualScope}
                />
              </View>

              <Spacer size={16} />

              {/* Top Followers */}
              <TopFollowers
                topFollowers={profileData?.topFollowers || []}
                isLoading={isProfileApiLoading}
                visualScope={profileHeaderVisualScope}
              />

              {cachedProfile?.about && (
                <View style={{ paddingHorizontal: 16 }}>
                  <Card variant="info" message={cachedProfile.about} />
                  <Spacer size={16} />
                </View>
              )}

              {/* Profile Info Section */}
              <View style={{ paddingHorizontal: 16 }}>
                <Section title="Profile Info">
                  <ListGroup variant="secondary">
                    {profileInfoItems.map((item) => (
                      <PressableFeedback key={item.key} animation={false} onPress={item.onPress}>
                        <PressableFeedback.Scale>
                          <ListGroup.Item disabled>
                            <ListGroup.ItemPrefix>{item.prefix}</ListGroup.ItemPrefix>
                            <ListGroup.ItemContent>
                              <ListGroup.ItemTitle>{item.title}</ListGroup.ItemTitle>
                            </ListGroup.ItemContent>
                            <ListGroup.ItemSuffix>
                              <Icon name={item.suffixIcon} size={20} color={iconColor} />
                            </ListGroup.ItemSuffix>
                          </ListGroup.Item>
                        </PressableFeedback.Scale>
                        <PressableFeedback.Ripple />
                      </PressableFeedback>
                    ))}
                  </ListGroup>
                </Section>
              </View>

              <Spacer size={8} />
            </View>
          }
        />
      ) : null}
    </Log>
  );
}

const styles = StyleSheet.create({
  // Post-reveal static style: opacity owned by React, immune to Fabric commits
  // dropping UI-thread-applied animated props (the invisible-element bug).
  settledReveal: {
    opacity: 1,
  },
  bannerContainer: {
    width: '100%',
    height: BANNER_HEIGHT,
    overflow: 'hidden',
  },
  avatarContainer: {
    alignItems: 'center',
    marginTop: -(AVATAR_SIZE - AVATAR_OVERLAP),
  },
  avatarBorder: {
    borderRadius: AVATAR_SIZE / 2 + 4,
    borderWidth: 4,
    padding: 0,
  },
  statsGrid: {
    marginHorizontal: -6,
  },
  statsRow: {
    flexDirection: 'row',
  },
  statItem: {
    flex: 1,
    padding: 6,
  },
  statCard: {
    flex: 1,
    minHeight: STAT_CARD_HEIGHT,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'flex-start',
  },
  // One pulsing block matching the loaded pill's footprint, so swapping the
  // skeleton for the real card doesn't shift the grid.
  statCardSkeleton: {
    flex: 1,
    height: STAT_CARD_HEIGHT,
    borderRadius: 12,
  },
  topFollowersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  topFollowersSection: {
    paddingHorizontal: 16,
  },
  topFollowerGridItem: {
    alignItems: 'center',
    marginBottom: 8,
  },
  identityBlock: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  followButton: {
    marginTop: 10,
    minWidth: 108,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  followCapsule: {
    marginTop: 10,
    minWidth: 108,
  },
  followButtonDisabled: {
    opacity: 0.6,
  },
});
