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

import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, Linking } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Image as ExpoImage } from 'expo-image';
import { Stack, Link } from 'expo-router';
import { z } from 'zod';
import { Hex64 } from '@sovranbitcoin/schemas';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { npubToPubkey } from '@/shared/lib/nostr/client';
import { Card } from '@/shared/ui/composed/Card';
import { Section } from '@/shared/ui/composed/Section';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { truncateMiddle } from '@/shared/lib/strings';
import * as Clipboard from 'expo-clipboard';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { SendMessageMenu } from '@/features/user/components/SendMessageMenu';
import { NDKEvent, useNDK, useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Contacts } from 'nostr-tools/kinds';
import { nip19 } from 'nostr-tools';
import {
  copyPopup,
  copyFailedPopup,
  openLinkFailedPopup,
  engagementUpdateFailedPopup,
  type CopyTarget,
} from '@/shared/lib/popup';
import {
  useNostrProfile,
  getFollowersWithProfiles,
  getFollowerDisplayName,
  getFollowerPicture,
  TopFollower,
  UserFeed,
} from '@/features/feed';
import { formatDate } from '@/shared/lib/time';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import {
  selectIsFollowingPubkey,
  useNostrSocialStore,
} from '@/shared/stores/profile/nostrSocialStore';
import { resolveIdentityName } from '@/shared/lib/identity';
import { generateSeededGradient } from '@/shared/lib/avatarGradient';
import { useDominantColor, getContrastColors } from '@/shared/lib/colorExtraction';
import type { VideoPostRecord, StoryUser } from '@/features/feed';
import { ListGroup, PressableFeedback, Skeleton as HeroSkeleton } from 'heroui-native';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log, nostrLog, useLifecycleLogger } from '@/shared/lib/logger';

const BANNER_HEIGHT = 150;
const AVATAR_SIZE = 90;
const AVATAR_OVERLAP = AVATAR_SIZE / 4;

const NPUB = /^npub1[02-9ac-hj-np-z]{58,}$/;
const HTTPS_URL = /^https:\/\/[^\s]+$/;

const UserProfileParamsSchema = z
  .object({
    npub: z.string().regex(NPUB, 'invalid npub').optional(),
    pubkey: Hex64.optional(),
    mintUrl: z.string().regex(HTTPS_URL, 'mintUrl must be https').max(2048).optional(),
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

// ============================================================================
// Profile Stats Grid
// ============================================================================

function ProfileStatsGridComponent({
  followingCount,
  followerCount,
  reputationScore,
  joinedDate,
  isLoading,
}: {
  followingCount?: number;
  followerCount?: number;
  reputationScore?: number;
  joinedDate?: string;
  isLoading: boolean;
}) {
  const [foreground, surfaceTertiary, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-tertiary',
    'surface-secondary',
  ] as const);

  const fadeAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  const hasValidData =
    followingCount !== undefined ||
    followerCount !== undefined ||
    reputationScore !== undefined ||
    joinedDate !== undefined;

  const hasAnimatedRef = useRef(false);
  useEffect(() => {
    if (hasValidData && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;
      Animated.stagger(
        80,
        fadeAnims.map((anim, index) =>
          Animated.timing(anim, {
            toValue: 1,
            duration: 400,
            delay: index * 80,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          })
        )
      ).start();
    }
  }, [hasValidData, fadeAnims]);

  const stats = [
    {
      label: 'Following',
      description: 'Users followed',
      value: followingCount?.toString() ?? '0',
      smallValue: false,
    },
    {
      label: 'Followers',
      description: 'Total count',
      value: followerCount?.toString() ?? '0',
      smallValue: false,
    },
    {
      label: 'Reputation',
      description: 'Network score',
      value: reputationScore !== undefined ? `${Math.round(reputationScore)} / 100` : 'N/A',
      smallValue: false,
    },
    {
      label: 'Joined',
      description: 'Account created',
      value: joinedDate || 'Unknown',
      smallValue: true,
    },
  ];

  const showSkeleton = isLoading && !hasValidData;

  const renderStatCard = (stat: (typeof stats)[0], _index: number) => (
    <View key={stat.label} style={styles.statItem}>
      <View
        style={[
          styles.statCard,
          { backgroundColor: surfaceSecondary, borderColor: surfaceTertiary },
        ]}>
        <Text
          loading={showSkeleton}
          placeholder="FOLLOWING"
          bold
          size={12}
          style={{ color: opacity(foreground, 0.66), marginBottom: 4 }}>
          {stat.label.toUpperCase()}
        </Text>
        <Text
          loading={showSkeleton}
          placeholder="1,234"
          bold
          size={stat.smallValue ? 16 : 20}
          style={{ color: foreground, marginBottom: 2 }}>
          {stat.value}
        </Text>
        <Text
          loading={showSkeleton}
          placeholder="Network score"
          bold
          size={12}
          style={{ color: opacity(foreground, 0.5), opacity: 0.8 }}>
          {stat.description}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.statsGrid}>
      <View style={styles.statsRow}>
        {stats.slice(0, 2).map((stat, i) => renderStatCard(stat, i))}
      </View>
      <View style={styles.statsRow}>
        {stats.slice(2, 4).map((stat, i) => renderStatCard(stat, i + 2))}
      </View>
    </View>
  );
}
const ProfileStatsGrid = React.memo(ProfileStatsGridComponent);

// ============================================================================
// Top Followers Section
// ============================================================================

function TopFollowersComponent({
  topFollowers,
  isLoading,
}: {
  topFollowers: TopFollower[];
  isLoading: boolean;
}) {
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);
  const { width: screenWidth } = useWindowDimensions();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const GRID_PADDING = 32;
  const GRID_GAP = 12;
  const COLUMNS = 3;
  const itemWidth = (screenWidth - GRID_PADDING - GRID_GAP * (COLUMNS - 1)) / COLUMNS;
  const avatarSize = Math.min(itemWidth - 16, 64);

  const followersWithProfiles = useMemo(
    () => getFollowersWithProfiles(topFollowers).slice(0, 6),
    [topFollowers]
  );

  useEffect(() => {
    if (followersWithProfiles.length > 0) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [followersWithProfiles.length, fadeAnim]);

  if (!isLoading && followersWithProfiles.length === 0) return null;

  const handleFollowerPress = (follower: TopFollower) => {
    // push (not navigate) so each profile pushes a new stack entry; tapping
    // through follower → follower-of-follower then back returns step by step.
    router.push({
      pathname: '/(user-flow)/profile',
      params: { npub: follower.npub },
    });
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
          color: opacity(foreground, 0.66),
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
      <Skeleton
        style={[
          styles.topFollowerAvatar,
          { width: avatarSize, height: avatarSize, backgroundColor: surfaceTertiary },
        ]}
      />
      <Skeleton
        style={{
          width: itemWidth - 24,
          height: 12,
          borderRadius: 4,
          marginTop: 6,
          backgroundColor: surfaceTertiary,
        }}
      />
    </View>
  );

  return (
    <View style={{ paddingHorizontal: 16 }}>
      <Text
        bold
        size={12}
        style={{ color: opacity(foreground, 0.4), marginBottom: 12, marginLeft: 4 }}>
        TOP FOLLOWERS
      </Text>
      {isLoading ? (
        <View style={styles.topFollowersGrid}>{[0, 1, 2, 3, 4, 5].map(renderSkeleton)}</View>
      ) : (
        <Animated.View style={{ opacity: fadeAnim }}>
          <View style={styles.topFollowersGrid}>{followersWithProfiles.map(renderItem)}</View>
        </Animated.View>
      )}
      <Spacer size={16} />
    </View>
  );
}
const TopFollowers = React.memo(TopFollowersComponent);

// ============================================================================
// Banner with Overlapping Avatar
// ============================================================================

function BannerWithAvatarComponent({
  bannerUrl,
  pictureUrl,
  pubkey,
  displayName,
  nip05,
  isLoading,
  showFollowButton,
  isFollowing,
  isFollowLoading,
  onToggleFollow,
  hasStories,
  onAvatarPress,
}: {
  bannerUrl?: string;
  pictureUrl?: string;
  pubkey: string;
  displayName: string;
  nip05?: string;
  isLoading: boolean;
  showFollowButton: boolean;
  isFollowing: boolean;
  isFollowLoading: boolean;
  onToggleFollow: () => void;
  hasStories?: boolean;
  onAvatarPress?: () => void;
}) {
  const [foreground, surfaceSecondary, background] = useThemeColor([
    'foreground',
    'surface-secondary',
    'background',
  ] as const);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [bannerStatus, setBannerStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');

  const fallbackIndex = useMemo(
    () => (pubkey ? parseInt(pubkey.slice(0, 8), 16) % 8 : 0),
    [pubkey]
  );
  const bannerError = bannerStatus === 'failed';
  const hasBannerImage = Boolean(bannerUrl && !bannerError);
  // Mirror Avatar's state model for the banner:
  //   - 'loading'  → metadata still resolving, OR we have a bannerUrl that hasn't finished loading
  //   - 'image'    → bannerUrl resolved and loaded
  //   - 'fallback' → metadata resolved with no banner, OR banner load failed
  const bannerState: 'loading' | 'image' | 'fallback' = isLoading
    ? 'loading'
    : hasBannerImage
      ? bannerStatus === 'loaded'
        ? 'image'
        : 'loading'
      : 'fallback';
  const pfpColors = useDominantColor(pictureUrl, fallbackIndex);
  const bannerColors = useDominantColor(
    !pictureUrl && hasBannerImage ? bannerUrl : undefined,
    fallbackIndex
  );

  const bannerGradientTheme = useMemo(
    () => generateSeededGradient(`${pubkey || 'default'}`),
    [pubkey]
  );

  const gradientSource = useMemo(() => {
    if (pictureUrl && pfpColors.hasExtractedColors) return 'pfp';
    if (hasBannerImage && bannerColors.hasExtractedColors) return 'banner';
    return 'seeded';
  }, [pictureUrl, hasBannerImage, pfpColors.hasExtractedColors, bannerColors.hasExtractedColors]);

  const imageGradientColors = useMemo(() => {
    if (gradientSource === 'pfp') {
      const { contrastColor } = getContrastColors(pfpColors.baseColor, 0.3);
      return [pfpColors.baseColor, contrastColor] as const;
    }
    if (gradientSource === 'banner') {
      const { contrastColor } = getContrastColors(bannerColors.baseColor, 0.3);
      return [bannerColors.baseColor, contrastColor] as const;
    }
    return null;
  }, [gradientSource, pfpColors.baseColor, bannerColors.baseColor]);

  useEffect(() => {
    setBannerStatus('loading');
  }, [bannerUrl]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const avatarContent = (
    <View style={[styles.avatarBorder, { borderColor: background, backgroundColor: background }]}>
      <Avatar
        state={isLoading ? 'loading' : pictureUrl ? 'image' : 'fallback'}
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
    <View>
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
              style={[StyleSheet.absoluteFill, { backgroundColor: opacity(foreground, 0.5) }]}
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
                    { backgroundColor: opacity(imageGradientColors[0], 0.05) },
                  ]}
                />
                <LinearGradient
                  colors={[opacity(imageGradientColors[0], 0.28), 'transparent']}
                  locations={[0, 0.8]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <LinearGradient
                  colors={[
                    opacity(imageGradientColors[1], 0.2),
                    'transparent',
                    opacity(imageGradientColors[0], 0.18),
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
        style={[styles.avatarContainer, { opacity: fadeAnim, transform: [{ scale: fadeAnim }] }]}>
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
                <Icon name="mdi:check-decagram" size={16} color={opacity(foreground, 0.4)} />
              )}
              <Text
                loading={isLoading}
                placeholder="username@relay.example"
                size={14}
                style={{ color: opacity(foreground, 0.4) }}>
                {nip05 || '\u00A0'}
              </Text>
            </HStack>
          </View>
        )}
        {showFollowButton &&
          (isLoading ? (
            <HeroSkeleton
              className="h-[34px] min-w-[108px] rounded-full"
              style={{ marginTop: 10 }}
            />
          ) : (
            <Pressable
              activeOpacity={0.8}
              onPress={onToggleFollow}
              disabled={isFollowLoading}
              style={[
                styles.followButton,
                {
                  backgroundColor: isFollowing ? opacity(foreground, 0.12) : foreground,
                  borderColor: isFollowing ? opacity(foreground, 0.25) : foreground,
                },
                isFollowLoading && styles.followButtonDisabled,
              ]}>
              <Text
                bold
                size={13}
                style={{
                  color: isFollowing ? foreground : background,
                }}>
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            </Pressable>
          ))}
      </VStack>
    </View>
  );
}
const BannerWithAvatar = React.memo(BannerWithAvatarComponent);

// ============================================================================
// Main Component
// ============================================================================

export function UserProfileScreen() {
  useLifecycleLogger('UserProfileScreen', nostrLog);

  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const { ndk } = useNDK();
  const { keys: nostrKeys } = useNostrKeysContext();
  const params = useRouteParams(UserProfileParamsSchema, {
    where: 'user-flow.profile',
  });
  const npubParam = params?.npub;
  const pubkeyParam = params?.pubkey;
  const mintUrlParam = params?.mintUrl;

  const pubkey = useMemo(() => {
    if (pubkeyParam) return pubkeyParam;
    if (npubParam) return npubToPubkey(npubParam);
    return '';
  }, [npubParam, pubkeyParam]);

  const npub = useMemo(() => {
    if (npubParam) return npubParam;
    if (pubkey) {
      try {
        return nip19.npubEncode(pubkey);
      } catch {
        return '';
      }
    }
    return '';
  }, [npubParam, pubkey]);

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
  const { metadata: cachedProfile, isLoading: isMetadataLoading } = useNostrProfileMetadata(pubkey);

  const contactListFilters = useMemo(
    () =>
      nostrKeys?.pubkey ? [{ authors: [nostrKeys.pubkey], kinds: [Contacts], limit: 20 }] : null,
    [nostrKeys?.pubkey]
  );
  const { events: contactListEvents } = useSubscribe({ filters: contactListFilters });

  const contactsTags = useNostrSocialStore((state) => state.contactsTags);
  const contactsContent = useNostrSocialStore((state) => state.contactsContent);
  const setContactsFromRelay = useNostrSocialStore((state) => state.setContactsFromRelay);
  const setFollowOptimistic = useNostrSocialStore((state) => state.setFollowOptimistic);
  const clearFollowOptimistic = useNostrSocialStore((state) => state.clearFollowOptimistic);
  const clearSettledFollowOptimistic = useNostrSocialStore(
    (state) => state.clearSettledFollowOptimistic
  );
  const followOptimisticEntry = useNostrSocialStore((state) =>
    pubkey ? state.optimisticFollowsByPubkey[pubkey] : undefined
  );
  const ownFollowingCount = useNostrSocialStore((state) => {
    let count = Object.keys(state.followingPubkeys).length;

    for (const [followedPubkey, optimistic] of Object.entries(state.optimisticFollowsByPubkey)) {
      const baseIsFollowing = !!state.followingPubkeys[followedPubkey];
      if (optimistic.value === baseIsFollowing) continue;
      count += optimistic.value ? 1 : -1;
    }

    return Math.max(0, count);
  });

  const { data: profileData, isLoading: isProfileApiLoading } = useNostrProfile(pubkey || null);

  // ===========================
  // DERIVED STATE
  // ===========================

  // Same hierarchy whether it's our own or a foreign profile — drawer-style
  // deterministic word pair after metadata. truncateMiddle(npub, …) is no
  // longer used as a name; the npub still appears as a copy-row in the
  // profile body.
  const displayName = resolveIdentityName({ pubkey, nostrProfile: cachedProfile });

  const followerCount = profileData?.followers;
  const reputationScore = profileData?.score;
  const joinedDate = formatDate((profileData?.created_at || 0) * 1000);

  const latestContactListEvent = useMemo(() => {
    if (!nostrKeys?.pubkey) return null;
    const candidates = (contactListEvents || []).filter(
      (event) => event.kind === Contacts && event.pubkey === nostrKeys.pubkey
    );
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => {
      const byCreatedAt = (b.created_at || 0) - (a.created_at || 0);
      if (byCreatedAt !== 0) return byCreatedAt;
      return (b.id || '').localeCompare(a.id || '');
    })[0];
  }, [contactListEvents, nostrKeys?.pubkey]);

  useEffect(() => {
    if (!latestContactListEvent) return;
    const tags = Array.isArray(latestContactListEvent.tags)
      ? (latestContactListEvent.tags as string[][])
      : [];
    const content =
      typeof latestContactListEvent.content === 'string' ? latestContactListEvent.content : '';
    setContactsFromRelay({
      tags,
      content,
      createdAt: latestContactListEvent.created_at || 0,
    });
    clearSettledFollowOptimistic();
  }, [latestContactListEvent, setContactsFromRelay, clearSettledFollowOptimistic]);

  const followingCount = isOwnProfile ? ownFollowingCount : profileData?.follows;
  const isFollowingProfile = useNostrSocialStore(
    useMemo(() => selectIsFollowingPubkey(pubkey || ''), [pubkey])
  );
  const followInFlight = !!followOptimisticEntry?.pending;

  // ===========================
  // VIDEO STORIES STATE
  // ===========================

  const [userVideoPosts, setUserVideoPosts] = useState<VideoPostRecord[]>([]);
  const hasStories = userVideoPosts.length > 0;

  const handleVideoPostsReady = useCallback((videoPosts: VideoPostRecord[]) => {
    setUserVideoPosts(videoPosts);
  }, []);

  const handleAvatarStoryPress = useCallback(() => {
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
  }, [userVideoPosts, pubkey, cachedProfile, displayName]);

  // ===========================
  // HANDLERS
  // ===========================

  const handleCopy = useCallback(async (text: string, target: CopyTarget) => {
    try {
      nostrLog.info('user.profile.copy', { target });
      await Clipboard.setStringAsync(text);
      copyPopup(target);
    } catch (e) {
      nostrLog.error('user.profile.copy.failed', {
        target,
        error: e instanceof Error ? e : new Error(String(e)),
      });
      copyFailedPopup();
    }
  }, []);

  const handleOpenLink = useCallback(async (url: string) => {
    try {
      nostrLog.info('user.profile.open_link', { url });
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      await Linking.openURL(fullUrl);
    } catch (e) {
      nostrLog.error('user.profile.open_link.failed', {
        url,
        error: e instanceof Error ? e : new Error(String(e)),
      });
      openLinkFailedPopup();
    }
  }, []);

  const handleToggleFollowInner = useCallback(async () => {
    if (!pubkey || !nostrKeys?.pubkey || !ndk) {
      nostrLog.warn('user.profile.follow.precondition_failed', {
        hasPubkey: !!pubkey,
        hasNostrKeys: !!nostrKeys?.pubkey,
        hasNdk: !!ndk,
      });
      engagementUpdateFailedPopup('follow');
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
      await contactEvent.publish();
      nostrLog.info('user.profile.follow.published', { pubkey, shouldFollow });
      setContactsFromRelay({ tags: nextTags, content: contactsContent, createdAt });
      clearFollowOptimistic(pubkey);
    } catch (e) {
      nostrLog.error('user.profile.follow.failed', {
        pubkey,
        error: e instanceof Error ? e : new Error(String(e)),
      });
      clearFollowOptimistic(pubkey);
      engagementUpdateFailedPopup('follow');
    }
  }, [
    pubkey,
    nostrKeys?.pubkey,
    ndk,
    followInFlight,
    isFollowingProfile,
    contactsTags,
    contactsContent,
    setFollowOptimistic,
    setContactsFromRelay,
    clearFollowOptimistic,
  ]);

  // `followInFlight` is store-derived state and lands a render too late;
  // a rapid double-tap on Follow runs `setFollowOptimistic` twice and races
  // a second kind-3 publish with the first's `clearFollowOptimistic`.
  const handleToggleFollow = useSingleFlight(handleToggleFollowInner);

  // ===========================
  // PROFILE INFO ITEMS (data-driven)
  // ===========================

  const iconColor = opacity(foreground, 0.4);

  const profileInfoItems = useMemo(() => {
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
        onPress: () => handleCopy(npub, 'npub'),
      },
    ];

    if (cachedProfile?.nip05) {
      const nip05 = cachedProfile.nip05;
      items.push({
        key: 'nip05',
        prefix: <Icon name="mdi:check-decagram" size={20} color={iconColor} />,
        title: nip05,
        suffixIcon: 'lets-icons:copy',
        onPress: () => handleCopy(nip05, 'nip05'),
      });
    }

    if (cachedProfile?.lud16) {
      const lud16 = cachedProfile.lud16;
      items.push({
        key: 'lud16',
        prefix: <Icon name="mdi:lightning-bolt" size={20} color={iconColor} />,
        title: lud16,
        suffixIcon: 'lets-icons:copy',
        onPress: () => handleCopy(lud16, 'lud16'),
      });
    }

    if (cachedProfile?.website) {
      const website = cachedProfile.website;
      items.push({
        key: 'website',
        prefix: <Icon name="mdi:web" size={20} color={iconColor} />,
        title: website,
        suffixIcon: 'mdi:open-in-new',
        onPress: () => handleOpenLink(website),
      });
    }

    return items;
  }, [npub, cachedProfile, handleCopy, handleOpenLink, iconColor]);

  return (
    <Log name="UserProfileScreen" style={{ flex: 1, backgroundColor: background }}>
      <Stack.Screen
        options={{
          title: isMetadataLoading ? 'Profile' : displayName,
          headerRight: () => (
            <HStack gap={4}>
              {(profileData?.mintUrl || mintUrlParam) && (
                <Link
                  href={{
                    pathname: '/(mint-flow)/info',
                    params: {
                      mintInfoEntry: JSON.stringify({
                        mintUrl: profileData?.mintUrl || mintUrlParam,
                      }),
                    },
                  }}
                  asChild>
                  <Pressable style={{ padding: 8 }}>
                    <Icon name="mdi:bank" size={24} color={foreground} />
                  </Pressable>
                </Link>
              )}
              <Link
                href={{
                  pathname: '/(user-flow)/share',
                  params: {
                    type: 'npub',
                    data: npub,
                    ...(cachedProfile?.lud16 && { lud16: cachedProfile.lud16 }),
                  },
                }}
                asChild>
                <Pressable style={{ padding: 8 }}>
                  <Icon name="mdi:qrcode" size={24} color={foreground} />
                </Pressable>
              </Link>
            </HStack>
          ),
        }}
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
                // Wait until our own keys are known before deciding whether to
                // show the follow button. Otherwise on own-profile open we would
                // briefly render the skeleton (isOwnProfile=false until keys load),
                // then unmount it once `isOwnProfile` flips true — a content shift
                // every time you open your own profile.
                showFollowButton={!!nostrKeys?.pubkey && !isOwnProfile && !!pubkey}
                isFollowing={isFollowingProfile}
                isFollowLoading={followInFlight}
                onToggleFollow={handleToggleFollow}
                hasStories={hasStories}
                onAvatarPress={handleAvatarStoryPress}
              />

              <Spacer size={16} />

              {/* Stats Grid */}
              <View style={{ paddingHorizontal: 16 }}>
                <ProfileStatsGrid
                  followingCount={followingCount}
                  followerCount={followerCount}
                  reputationScore={reputationScore}
                  joinedDate={joinedDate}
                  isLoading={isProfileApiLoading}
                />
              </View>

              <Spacer size={16} />

              {/* Top Followers */}
              <TopFollowers
                topFollowers={profileData?.topFollowers || []}
                isLoading={isProfileApiLoading}
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

      <BottomButtons>
        <SendMessageMenu pubkey={pubkey} displayName={displayName} />
      </BottomButtons>
    </Log>
  );
}

const styles = StyleSheet.create({
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
    alignItems: 'stretch',
  },
  statItem: {
    flex: 1,
    padding: 6,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'flex-start',
  },
  skeletonLabel: {
    width: 80,
    height: 14,
    borderRadius: 4,
    marginBottom: 8,
  },
  skeletonValue: {
    height: 28,
    borderRadius: 4,
    marginBottom: 4,
  },
  skeletonDesc: {
    width: 120,
    height: 14,
    borderRadius: 4,
  },
  topFollowersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  topFollowerGridItem: {
    alignItems: 'center',
    marginBottom: 8,
  },
  topFollowerAvatar: {
    borderRadius: 32,
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
  followButtonDisabled: {
    opacity: 0.6,
  },
});
