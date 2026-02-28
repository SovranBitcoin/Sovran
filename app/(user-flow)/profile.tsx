/**
 * @fileoverview User Profile Info Screen
 *
 * Displays Nostr user profile information with:
 * - Banner image with overlapping avatar
 * - Stats grid (Following, Followers, Reputation, Joined)
 * - Actions section (Message User)
 * - Profile info section (npub, nip05, lud16, website)
 */

import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { Animated, Easing, StyleSheet, TouchableOpacity, Dimensions, Linking } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Stack, router, useLocalSearchParams, Link } from 'expo-router';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { npubToPubkey } from 'components/blocks/Transaction';
import { Card } from 'components/ui/Card';
import { Section } from 'app/settings-pages';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Avatar } from 'components/ui/Avatar';
import { truncateMiddle } from 'helper/strings';
import * as Clipboard from 'expo-clipboard';
import { Skeleton } from 'components/ui/Skeleton';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { NDKEvent, useNDK, useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Contacts, Metadata } from 'nostr-tools/kinds';
import { nip19 } from 'nostr-tools';
import { popup } from '@/helper/popup';
import {
  useNostrProfile,
  getFollowersWithProfiles,
  getFollowerDisplayName,
  getFollowerPicture,
  TopFollower,
} from 'hooks/useNostrProfile';
import { formatDate } from '@/helper/time';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { UserFeed } from 'components/blocks/UserFeed';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { selectIsFollowingPubkey, useNostrSocialStore } from '@/stores/nostrSocialStore';
import { getUsername } from '@/helper/username';
import { generateSeededGradient } from '@/helper/avatarGradient';
import type { VideoPostRecord } from 'components/blocks/nostr/shared';
import type { StoryUser } from 'components/blocks/nostr/StoriesCarousel';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { useThemeColor } from '@/hooks/useThemeColor';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BANNER_HEIGHT = 150;

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

const AVATAR_SIZE = 90;
const AVATAR_OVERFLOW = AVATAR_SIZE / 4; // 1/4 overflows below banner

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
  const [foreground, surfaceTertiary, surfaceSecondary] = useThemeColor(['foreground', 'surface-tertiary', 'surface-secondary'] as const);

  const displayValues = useMemo(
    () => ({
      following: followingCount !== undefined ? followingCount.toString() : '0',
      followers: followerCount !== undefined ? followerCount.toString() : '0',
      reputation: reputationScore !== undefined ? `${Math.round(reputationScore)} / 100` : 'N/A',
      joined: joinedDate || 'Unknown',
    }),
    [followingCount, followerCount, reputationScore, joinedDate]
  );

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

      const animations = fadeAnims.map((anim, index) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 400,
          delay: index * 80,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      );

      Animated.stagger(80, animations).start();
    }
  }, [hasValidData, fadeAnims]);

  const stats = useMemo(
    () => [
      {
        label: 'Following',
        description: 'Users followed',
        value: displayValues.following,
        smallValue: false,
      },
      {
        label: 'Followers',
        description: 'Total count',
        value: displayValues.followers,
        smallValue: false,
      },
      {
        label: 'Reputation',
        description: 'Network score',
        value: displayValues.reputation,
        smallValue: false,
      },
      {
        label: 'Joined',
        description: 'Account created',
        value: displayValues.joined,
        smallValue: true,
      },
    ],
    [displayValues]
  );

  const showSkeleton = isLoading && !hasValidData;

  // Split stats into rows of 2 for proper height matching
  const rows = [];
  for (let i = 0; i < stats.length; i += 2) {
    rows.push(stats.slice(i, i + 2));
  }

  const renderStatCard = (stat: (typeof stats)[0], index: number) => (
    <View key={index} style={styles.statItem}>
      <View
        style={[
          styles.statCard,
          { backgroundColor: surfaceSecondary, borderColor: surfaceTertiary },
        ]}>
        {showSkeleton ? (
          <>
            <Skeleton style={[styles.skeletonLabel, { backgroundColor: surfaceTertiary }]} />
            <Skeleton style={[styles.skeletonValue, { backgroundColor: surfaceTertiary }]} />
            <Skeleton style={[styles.skeletonDesc, { backgroundColor: surfaceTertiary }]} />
          </>
        ) : (
          <Animated.View style={{ opacity: fadeAnims[index] }}>
            <Text
              bold
              overpass
              size={12}
              style={{ color: opacity(foreground, 0.66), marginBottom: 4 }}>
              {stat.label.toUpperCase()}
            </Text>
            <Text
              bold
              overpass
              size={stat.smallValue ? 16 : 20}
              style={{ color: foreground, marginBottom: 2 }}>
              {stat.value}
            </Text>
            <Text
              bold
              overpass
              size={12}
              style={{ color: opacity(foreground, 0.5), opacity: 0.8 }}>
              {stat.description}
            </Text>
          </Animated.View>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.statsGrid}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.statsRow}>
          {row.map((stat, colIndex) => renderStatCard(stat, rowIndex * 2 + colIndex))}
        </View>
      ))}
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
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Calculate responsive avatar size for 3-column grid
  // Available width = screen width - padding (32) - gaps (24 for 2 gaps between 3 items)
  const GRID_PADDING = 32;
  const GRID_GAP = 12;
  const COLUMNS = 3;
  const itemWidth = (SCREEN_WIDTH - GRID_PADDING - GRID_GAP * (COLUMNS - 1)) / COLUMNS;
  const avatarSize = Math.min(itemWidth - 16, 64); // Leave some padding, max 64

  // Filter to only show followers with profile info (max 6 for 3x2 grid)
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

  // Don't render if no followers with profiles
  if (!isLoading && followersWithProfiles.length === 0) {
    return null;
  }

  const handleFollowerPress = (follower: TopFollower) => {
    router.navigate({
      pathname: '/(user-flow)/profile' as any,
      params: { npub: follower.npub },
    });
  };

  const renderItem = (follower: TopFollower) => (
    <TouchableOpacity
      key={follower.pubkey}
      style={[styles.topFollowerGridItem, { width: itemWidth }]}
      onPress={() => handleFollowerPress(follower)}
      activeOpacity={0.7}>
      <Avatar
        picture={getFollowerPicture(follower)}
        seed={follower.pubkey}
        size={avatarSize}
        variant="person"
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
    </TouchableOpacity>
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
        overpass
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
  const [foreground, surfaceTertiary, surfaceSecondary, background] = useThemeColor(['foreground', 'surface-tertiary', 'surface-secondary', 'background'] as const);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Banner image loading state
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [bannerError, setBannerError] = useState(false);

  // Reuse the same layered seeded gradient algorithm as Avatar fallback.
  const bannerGradientTheme = useMemo(
    () => generateSeededGradient(`${pubkey || 'default'}:person`, 'person'),
    [pubkey]
  );

  // Reset banner states when URL changes
  useEffect(() => {
    setBannerLoaded(false);
    setBannerError(false);
  }, [bannerUrl]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  return (
    <View>
      {/* Banner */}
      <View style={[styles.bannerContainer, { backgroundColor: surfaceSecondary }]}>
        {/* Hidden image to trigger load/error callbacks */}
        {bannerUrl && !bannerError && (
          <ExpoImage
            source={{ uri: bannerUrl }}
            style={[styles.bannerImage, !bannerLoaded && { opacity: 0, position: 'absolute' }]}
            contentFit="cover"
            cachePolicy="disk"
            recyclingKey={bannerUrl}
            transition={200}
            onLoad={() => setBannerLoaded(true)}
            onError={() => setBannerError(true)}
          />
        )}

        {/* Always render deterministic fallback gradient first paint. */}
        <View style={styles.bannerPlaceholder}>
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
      </View>

      {/* Avatar - positioned to overlap */}
      <Animated.View
        style={[styles.avatarContainer, { opacity: fadeAnim, transform: [{ scale: fadeAnim }] }]}>
        {hasStories ? (
          <TouchableOpacity activeOpacity={0.8}>
            <View
              style={[
                styles.avatarBorder,
                { borderColor: background, backgroundColor: background },
              ]}>
              <Avatar
                picture={pictureUrl}
                seed={pubkey}
                size={AVATAR_SIZE}
                variant="person"
                name={displayName}
                loading={isLoading}
              />
            </View>
          </TouchableOpacity>
        ) : (
          <View
            style={[
              styles.avatarBorder,
              { borderColor: background, backgroundColor: background },
            ]}>
            <Avatar
              picture={pictureUrl}
              seed={pubkey}
              size={AVATAR_SIZE}
              variant="person"
              name={displayName}
              loading={isLoading}
            />
          </View>
        )}
      </Animated.View>

      {/* Name and NIP-05 */}
      <VStack align="center" style={{ marginTop: 8 }}>
        {isLoading ? (
          <>
            <Skeleton
              style={{
                width: 150,
                height: 24,
                borderRadius: 4,
                backgroundColor: surfaceTertiary,
              }}
            />
            <Spacer size={8} />
            <Skeleton
              style={{
                width: 100,
                height: 16,
                borderRadius: 4,
                backgroundColor: surfaceTertiary,
              }}
            />
          </>
        ) : (
          <>
            <Text bold size={22} style={{ color: foreground }}>
              {displayName}
            </Text>
            {nip05 && (
              <HStack align="center" gap={4}>
                <Icon
                  name="mdi:check-decagram"
                  size={16}
                  color={opacity(foreground, 0.4)}
                />
                <Text size={14} style={{ color: opacity(foreground, 0.4) }}>
                  {nip05}
                </Text>
              </HStack>
            )}
            {showFollowButton ? (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={onToggleFollow}
                disabled={isFollowLoading}
                style={[
                  styles.followButton,
                  {
                    backgroundColor: isFollowing
                      ? opacity(foreground, 0.12)
                      : foreground,
                    borderColor: isFollowing
                      ? opacity(foreground, 0.25)
                      : foreground,
                  },
                  isFollowLoading && styles.followButtonDisabled,
                ]}>
                <Text
                  bold
                  overpass
                  size={13}
                  style={{
                    color: isFollowing ? foreground : background,
                  }}>
                  {isFollowing ? 'Following' : 'Follow'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </VStack>
    </View>
  );
}
const BannerWithAvatar = React.memo(BannerWithAvatarComponent);

// ============================================================================
// Main Component
// ============================================================================
function UserProfileScreen() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const { ndk } = useNDK();
  const { keys: nostrKeys } = useNostrKeysContext();
  const _insets = useSafeAreaInsets();
  const { npub: npubParam, pubkey: pubkeyParam } = useLocalSearchParams<{
    npub?: string;
    pubkey?: string;
  }>();

  // Convert npub to pubkey if needed
  const pubkey = useMemo(() => {
    if (pubkeyParam) return pubkeyParam;
    if (npubParam) return npubToPubkey(npubParam);
    return '';
  }, [npubParam, pubkeyParam]);

  // Convert pubkey to npub for display
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

  // Profile metadata (kind 0) - PRIORITY: Load this first
  const metadataFilters = useMemo(
    () =>
      pubkey
        ? [
            {
              authors: [pubkey],
              kinds: [Metadata],
              limit: 1,
            },
          ]
        : null,
    [pubkey]
  );
  const { events: metadataEvents, eose: metadataEose } = useSubscribe({
    filters: metadataFilters,
  });

  const contactListFilters = useMemo(
    () =>
      nostrKeys?.pubkey
        ? [
            {
              authors: [nostrKeys.pubkey],
              kinds: [Contacts],
              limit: 20,
            },
          ]
        : null,
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

  // Fetch profile stats from Sovran API (followers, following, top followers, rank)
  const { data: profileData, isLoading: isProfileApiLoading } = useNostrProfile(pubkey || null);

  // ===========================
  // DERIVED STATE
  // ===========================
  const userInfo = metadataEvents?.[0] ? JSON.parse(metadataEvents[0].content) : null;
  const displayName = isOwnProfile
    ? getUsername(pubkey || '')
    : userInfo?.display_name || userInfo?.name || truncateMiddle(npub, 8);
  const isMetadataLoading = !metadataEose;

  // Follower count from API
  const followerCount = profileData?.followers;

  // Reputation score from API rank (formatted as percentage)
  const reputationScore = profileData?.score;

  // Joined date from profile created_at
  const joinedDate = formatDate((profileData?.created_at || 0) * 1000);

  const isStatsLoading = isProfileApiLoading;

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
    const storyUser: StoryUser = {
      pubkey,
      profile: userInfo ? { name: displayName, picture: userInfo.picture } : undefined,
      videoPosts: userVideoPosts,
    };
    router.navigate({
      pathname: '/(stories-flow)/stories' as any,
      params: {
        startIndex: '0',
        storyUsersJson: JSON.stringify([storyUser]),
      },
    });
  }, [userVideoPosts, pubkey, userInfo, displayName]);

  // ===========================
  // HANDLERS
  // ===========================
  const handleCopy = useCallback(async (text: string, message: string) => {
    try {
      await Clipboard.setStringAsync(text);
      popup({ message, type: 'success' });
    } catch {
      popup({ message: 'Failed to copy', type: 'error' });
    }
  }, []);

  const handleOpenLink = useCallback(async (url: string) => {
    try {
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      await Linking.openURL(fullUrl);
    } catch {
      popup({ message: 'Failed to open link', type: 'error' });
    }
  }, []);

  const handleToggleFollow = useCallback(async () => {
    if (!pubkey || !nostrKeys?.pubkey || !ndk) {
      popup({ message: 'Unable to update follow right now', type: 'error' });
      return;
    }
    if (nostrKeys.pubkey === pubkey || followInFlight) return;

    const shouldFollow = !isFollowingProfile;
    setFollowOptimistic(pubkey, shouldFollow, true);

    const sourceTags = contactsTags.map((tag) => [...tag]);
    const sourceContent = contactsContent;

    const nextTags = buildUpdatedContactTags(sourceTags, pubkey, shouldFollow);

    const createdAt = Math.floor(Date.now() / 1000);

    try {
      const contactEvent = new NDKEvent(ndk);
      contactEvent.kind = Contacts;
      contactEvent.tags = nextTags;
      contactEvent.content = sourceContent;
      contactEvent.created_at = createdAt;
      await contactEvent.publish();
      setContactsFromRelay({ tags: nextTags, content: sourceContent, createdAt });
      clearFollowOptimistic(pubkey);
    } catch {
      clearFollowOptimistic(pubkey);
      popup({ message: 'Failed to update follow. Please try again.', type: 'error' });
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

  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <Stack.Screen
        options={{
          title: isMetadataLoading ? 'Profile' : displayName,
          headerRight: () => (
            <HStack gap={4}>
              {profileData?.mintUrl && (
                <Link
                  href={{
                    pathname: '/(mint-flow)/info' as any,
                    params: { mintUrl: profileData.mintUrl },
                  }}
                  asChild>
                  <TouchableOpacity style={{ padding: 8 }}>
                    <Icon name="mdi:bank" size={24} color={foreground} />
                  </TouchableOpacity>
                </Link>
              )}
              <Link
                href={{
                  pathname: '/(user-flow)/share' as any,
                  params: {
                    type: 'npub',
                    data: npub,
                    ...(userInfo?.lud16 && { lud16: userInfo.lud16 }),
                  },
                }}
                asChild>
                <TouchableOpacity style={{ padding: 8 }}>
                  <Icon name="mdi:qrcode" size={24} color={foreground} />
                </TouchableOpacity>
              </Link>
            </HStack>
          ),
        }}
      />

      {pubkey ? (
        <UserFeed
          pubkey={pubkey}
          authorName={displayName}
          authorPicture={userInfo?.picture}
          isOwnProfile={isOwnProfile}
          onVideoPostsReady={handleVideoPostsReady}
          ListHeaderComponent={
            <View>
              {/* Banner with Overlapping Avatar */}
              <BannerWithAvatar
                bannerUrl={userInfo?.banner}
                pictureUrl={userInfo?.picture}
                pubkey={pubkey}
                displayName={displayName}
                nip05={userInfo?.nip05}
                isLoading={isMetadataLoading}
                showFollowButton={!isOwnProfile && !!pubkey}
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
                  isLoading={isStatsLoading}
                />
              </View>

              <Spacer size={16} />

              {/* Top Followers */}
              <TopFollowers
                topFollowers={profileData?.topFollowers || []}
                isLoading={isProfileApiLoading}
              />

              {/* About Card */}
              {userInfo?.about && (
                <View style={{ paddingHorizontal: 16 }}>
                  <Card variant="info" message={userInfo.about} />
                  <Spacer size={16} />
                </View>
              )}

              {/* Actions Section */}
              <View style={{ paddingHorizontal: 16 }}>
                <Section title="Actions">
                  <ListGroup variant="secondary">
                    <PressableFeedback
                      animation={false}
                      onPress={() => {
                        router.navigate({
                          pathname: '/(user-flow)/userMessages' as any,
                          params: { pubkey },
                        });
                      }}>
                      <PressableFeedback.Scale>
                        <ListGroup.Item disabled>
                          <ListGroup.ItemPrefix>
                            <Icon
                              name="mdi:message-text"
                              size={20}
                              color={opacity(foreground, 0.4)}
                            />
                          </ListGroup.ItemPrefix>
                          <ListGroup.ItemContent>
                            <ListGroup.ItemTitle>Message User</ListGroup.ItemTitle>
                          </ListGroup.ItemContent>
                          <ListGroup.ItemSuffix />
                        </ListGroup.Item>
                      </PressableFeedback.Scale>
                      <PressableFeedback.Ripple />
                    </PressableFeedback>
                  </ListGroup>
                </Section>
              </View>

              <Spacer size={8} />

              {/* Profile Info Section */}
              <View style={{ paddingHorizontal: 16 }}>
                <Section title="Profile Info">
                  <ListGroup variant="secondary">
                    <PressableFeedback
                      animation={false}
                      onPress={() => handleCopy(npub, 'npub_copied')}>
                      <PressableFeedback.Scale>
                        <ListGroup.Item disabled>
                          <ListGroup.ItemPrefix>
                            <CurrencyIcon
                              colors={[opacity(foreground, 0.4)]}
                              width={20}
                              currency="nostr"
                            />
                          </ListGroup.ItemPrefix>
                          <ListGroup.ItemContent>
                            <ListGroup.ItemTitle>{truncateMiddle(npub, 10)}</ListGroup.ItemTitle>
                          </ListGroup.ItemContent>
                          <ListGroup.ItemSuffix>
                            <Icon
                              name="lets-icons:copy"
                              size={20}
                              color={opacity(foreground, 0.4)}
                            />
                          </ListGroup.ItemSuffix>
                        </ListGroup.Item>
                      </PressableFeedback.Scale>
                      <PressableFeedback.Ripple />
                    </PressableFeedback>

                    {userInfo?.nip05 && (
                      <PressableFeedback
                        animation={false}
                        onPress={() => handleCopy(userInfo.nip05, 'nip05_copied')}>
                        <PressableFeedback.Scale>
                          <ListGroup.Item disabled>
                            <ListGroup.ItemPrefix>
                              <Icon
                                name="mdi:check-decagram"
                                size={20}
                                color={opacity(foreground, 0.4)}
                              />
                            </ListGroup.ItemPrefix>
                            <ListGroup.ItemContent>
                              <ListGroup.ItemTitle>{userInfo.nip05}</ListGroup.ItemTitle>
                            </ListGroup.ItemContent>
                            <ListGroup.ItemSuffix>
                              <Icon
                                name="lets-icons:copy"
                                size={20}
                                color={opacity(foreground, 0.4)}
                              />
                            </ListGroup.ItemSuffix>
                          </ListGroup.Item>
                        </PressableFeedback.Scale>
                        <PressableFeedback.Ripple />
                      </PressableFeedback>
                    )}

                    {userInfo?.lud16 && (
                      <PressableFeedback
                        animation={false}
                        onPress={() => handleCopy(userInfo.lud16, 'lud16_copied')}>
                        <PressableFeedback.Scale>
                          <ListGroup.Item disabled>
                            <ListGroup.ItemPrefix>
                              <Icon
                                name="mdi:lightning-bolt"
                                size={20}
                                color={opacity(foreground, 0.4)}
                              />
                            </ListGroup.ItemPrefix>
                            <ListGroup.ItemContent>
                              <ListGroup.ItemTitle>{userInfo.lud16}</ListGroup.ItemTitle>
                            </ListGroup.ItemContent>
                            <ListGroup.ItemSuffix>
                              <Icon
                                name="lets-icons:copy"
                                size={20}
                                color={opacity(foreground, 0.4)}
                              />
                            </ListGroup.ItemSuffix>
                          </ListGroup.Item>
                        </PressableFeedback.Scale>
                        <PressableFeedback.Ripple />
                      </PressableFeedback>
                    )}

                    {userInfo?.website && (
                      <PressableFeedback
                        animation={false}
                        onPress={() => handleOpenLink(userInfo.website)}>
                        <PressableFeedback.Scale>
                          <ListGroup.Item disabled>
                            <ListGroup.ItemPrefix>
                              <Icon
                                name="mdi:web"
                                size={20}
                                color={opacity(foreground, 0.4)}
                              />
                            </ListGroup.ItemPrefix>
                            <ListGroup.ItemContent>
                              <ListGroup.ItemTitle>{userInfo.website}</ListGroup.ItemTitle>
                            </ListGroup.ItemContent>
                            <ListGroup.ItemSuffix>
                              <Icon
                                name="mdi:open-in-new"
                                size={20}
                                color={opacity(foreground, 0.4)}
                              />
                            </ListGroup.ItemSuffix>
                          </ListGroup.Item>
                        </PressableFeedback.Scale>
                        <PressableFeedback.Ripple />
                      </PressableFeedback>
                    )}
                  </ListGroup>
                </Section>
              </View>

              <Spacer size={8} />
            </View>
          }
        />
      ) : null}

      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: 'Send Message',
              variant: 'primary',
              onPress: async () => {
                router.navigate({
                  pathname: '/(user-flow)/userMessages' as any,
                  params: { pubkey },
                });
              },
            },
          ]}
        />
      </BottomButtons>
    </View>
  );
}

const styles = StyleSheet.create({
  bannerContainer: {
    width: SCREEN_WIDTH,
    height: BANNER_HEIGHT,
    overflow: 'hidden',
  },
  bannerImage: {
    width: '100%',
    height: '100%',
  },
  bannerPlaceholder: {
    width: '100%',
    height: '100%',
  },
  avatarContainer: {
    alignItems: 'center',
    marginTop: -(AVATAR_SIZE - AVATAR_OVERFLOW),
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

export default withSheetProvider(UserProfileScreen);
