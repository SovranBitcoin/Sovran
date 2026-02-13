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
import {
  ScrollView,
  Animated,
  Easing,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Linking,
} from 'react-native';
import { Stack, router, useLocalSearchParams, Link } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { npubToPubkey } from 'components/blocks/Transaction';
import { Card } from 'components/ui/Card';
import { RowButton, Section } from 'app/settings-pages';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Avatar } from 'components/ui/Avatar';
import { truncateMiddle } from 'helper/strings';
import * as Clipboard from 'expo-clipboard';
import { Skeleton } from 'components/ui/Skeleton';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Metadata } from 'nostr-tools/kinds';
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
import { UserFeed } from 'components/blocks/UserFeed';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BANNER_HEIGHT = 150;

// ============================================================================
// Gradient Generation from Seed (same algorithm as Avatar)
// ============================================================================
function Mash() {
  let n = 0xefc8249d;
  const mash = function (data: string) {
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000;
    }
    return (n >>> 0) * 2.3283064365386963e-10;
  };
  return mash;
}

function Alea(this: any, seed: string) {
  const me: any = this;
  const mash = Mash();
  me.c = 1;
  me.s0 = mash(' ');
  me.s1 = mash(' ');
  me.s2 = mash(' ');
  me.s0 -= mash(seed);
  if (me.s0 < 0) me.s0 += 1;
  me.s1 -= mash(seed);
  if (me.s1 < 0) me.s1 += 1;
  me.s2 -= mash(seed);
  if (me.s2 < 0) me.s2 += 1;
  me.next = function () {
    const t = 2091639 * me.s0 + me.c * 2.3283064365386963e-10;
    me.s0 = me.s1;
    me.s1 = me.s2;
    return (me.s2 = t - (me.c = t | 0));
  };
}

function generateBannerGradient(seed: string): [string, string] {
  const xg = new (Alea as any)(seed);
  const random = () => xg.next();

  // Generate two HSL colors for gradient
  const h1 = Math.floor(random() * 360);
  const s1 = 40 + Math.floor(random() * 30); // 40-70% saturation
  const l1 = 25 + Math.floor(random() * 20); // 25-45% lightness (darker for banner)

  const h2 = (h1 + 30 + Math.floor(random() * 60)) % 360; // Offset hue
  const s2 = 40 + Math.floor(random() * 30);
  const l2 = 20 + Math.floor(random() * 20); // Slightly darker

  return [`hsl(${h1}, ${s1}%, ${l1}%)`, `hsl(${h2}, ${s2}%, ${l2}%)`];
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
  const { getPrimaryColor } = useTheme();

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
          { backgroundColor: getPrimaryColor('800'), borderColor: getPrimaryColor('700') },
        ]}>
        {showSkeleton ? (
          <>
            <Skeleton style={[styles.skeletonLabel, { backgroundColor: getPrimaryColor('700') }]} />
            <Skeleton style={[styles.skeletonValue, { backgroundColor: getPrimaryColor('700') }]} />
            <Skeleton style={[styles.skeletonDesc, { backgroundColor: getPrimaryColor('700') }]} />
          </>
        ) : (
          <Animated.View style={{ opacity: fadeAnims[index] }}>
            <Text
              bold
              overpass
              size={12}
              style={{ color: getPrimaryColor('200'), marginBottom: 4 }}>
              {stat.label.toUpperCase()}
            </Text>
            <Text
              bold
              overpass
              size={stat.smallValue ? 16 : 20}
              style={{ color: getPrimaryColor('0'), marginBottom: 2 }}>
              {stat.value}
            </Text>
            <Text bold overpass size={12} style={{ color: getPrimaryColor('300'), opacity: 0.8 }}>
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
  const { getPrimaryColor } = useTheme();
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
    router.push({
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
          color: getPrimaryColor('200'),
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
          { width: avatarSize, height: avatarSize, backgroundColor: getPrimaryColor('700') },
        ]}
      />
      <Skeleton
        style={{
          width: itemWidth - 24,
          height: 12,
          borderRadius: 4,
          marginTop: 6,
          backgroundColor: getPrimaryColor('700'),
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
        style={{ color: getPrimaryColor('400'), marginBottom: 12, marginLeft: 4 }}>
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
}: {
  bannerUrl?: string;
  pictureUrl?: string;
  pubkey: string;
  displayName: string;
  nip05?: string;
  isLoading: boolean;
}) {
  const { getPrimaryColor } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Banner image loading state
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [bannerError, setBannerError] = useState(false);

  // Generate gradient colors from pubkey for fallback banner
  const gradientColors = useMemo(() => generateBannerGradient(pubkey || 'default'), [pubkey]);

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

  // Determine what to show:
  // - If still loading API data, show skeleton
  // - If banner URL exists and not errored, try to load image (show skeleton while loading)
  // - If no banner URL or image errored, show gradient
  const showSkeleton = isLoading || (bannerUrl && !bannerLoaded && !bannerError);
  const showGradient = !isLoading && (!bannerUrl || bannerError);

  return (
    <View>
      {/* Banner */}
      <View style={[styles.bannerContainer, { backgroundColor: getPrimaryColor('800') }]}>
        {/* Hidden image to trigger load/error callbacks */}
        {bannerUrl && !bannerError && (
          <Image
            source={{ uri: bannerUrl }}
            style={[styles.bannerImage, !bannerLoaded && { opacity: 0, position: 'absolute' }]}
            resizeMode="cover"
            onLoad={() => setBannerLoaded(true)}
            onError={() => setBannerError(true)}
          />
        )}

        {/* Skeleton while loading */}
        {showSkeleton && (
          <Skeleton
            style={[styles.bannerPlaceholder, { backgroundColor: getPrimaryColor('700') }]}
          />
        )}

        {/* Gradient fallback */}
        {showGradient && (
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.bannerPlaceholder}
          />
        )}
      </View>

      {/* Avatar - positioned to overlap */}
      <Animated.View
        style={[styles.avatarContainer, { opacity: fadeAnim, transform: [{ scale: fadeAnim }] }]}>
        <View
          style={[
            styles.avatarBorder,
            { borderColor: getPrimaryColor('950'), backgroundColor: getPrimaryColor('950') },
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
                backgroundColor: getPrimaryColor('700'),
              }}
            />
            <Spacer size={8} />
            <Skeleton
              style={{
                width: 100,
                height: 16,
                borderRadius: 4,
                backgroundColor: getPrimaryColor('700'),
              }}
            />
          </>
        ) : (
          <>
            <Text bold size={22} style={{ color: getPrimaryColor('0') }}>
              {displayName}
            </Text>
            {nip05 && (
              <HStack align="center" gap={4}>
                <Icon name="mdi:check-decagram" size={16} color={getPrimaryColor('400')} />
                <Text size={14} style={{ color: getPrimaryColor('400') }}>
                  {nip05}
                </Text>
              </HStack>
            )}
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
  const { getPrimaryColor } = useTheme();
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

  // Fetch profile stats from Sovran API (followers, following, top followers, rank)
  const { data: profileData, isLoading: isProfileApiLoading } = useNostrProfile(pubkey || null);

  // ===========================
  // DERIVED STATE
  // ===========================
  const userInfo = metadataEvents?.[0] ? JSON.parse(metadataEvents[0].content) : null;
  const displayName = userInfo?.display_name || userInfo?.name || truncateMiddle(npub, 8);
  const isMetadataLoading = !metadataEose;

  // Following count from API
  const followingCount = profileData?.follows;

  // Follower count from API
  const followerCount = profileData?.followers;

  // Reputation score from API rank (formatted as percentage)
  const reputationScore = profileData?.score;

  // Joined date from profile created_at
  const joinedDate = formatDate((profileData?.created_at || 0) * 1000);

  const isStatsLoading = isProfileApiLoading;

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

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
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
                    <Icon name="mdi:bank" size={24} color={getPrimaryColor('0')} />
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
                  <Icon name="mdi:qrcode" size={24} color={getPrimaryColor('0')} />
                </TouchableOpacity>
              </Link>
            </HStack>
          ),
        }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}>
        {/* Banner with Overlapping Avatar */}
        <BannerWithAvatar
          bannerUrl={userInfo?.banner}
          pictureUrl={userInfo?.picture}
          pubkey={pubkey}
          displayName={displayName}
          nip05={userInfo?.nip05}
          isLoading={isMetadataLoading}
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
            <RowButton
              isFirst
              label={
                <HStack align="center" gap={8}>
                  <Icon name="mdi:message-text" size={20} color={getPrimaryColor('400')} />
                  <Text style={{ color: getPrimaryColor('50') }} bold>
                    Message User
                  </Text>
                </HStack>
              }
              onPress={() => {
                router.push({
                  pathname: '/(user-flow)/userMessages' as any,
                  params: { pubkey },
                });
              }}
            />
          </Section>
        </View>

        <Spacer size={8} />

        {/* Profile Info Section */}
        <View style={{ paddingHorizontal: 16 }}>
          <Section title="Profile Info">
            <RowButton
              isFirst
              onPress={() => handleCopy(npub, 'npub_copied')}
              rightIcon={<Icon name="lets-icons:copy" size={20} color={getPrimaryColor('400')} />}
              label={
                <HStack align="center" gap={8}>
                  <CurrencyIcon colors={[getPrimaryColor('400')]} width={20} currency="nostr" />
                  <Text style={{ color: getPrimaryColor('50') }} bold>
                    {truncateMiddle(npub, 10)}
                  </Text>
                </HStack>
              }
            />
            {userInfo?.nip05 && (
              <RowButton
                onPress={() => handleCopy(userInfo.nip05, 'nip05_copied')}
                rightIcon={<Icon name="lets-icons:copy" size={20} color={getPrimaryColor('400')} />}
                label={
                  <HStack align="center" gap={8}>
                    <Icon name="mdi:check-decagram" size={20} color={getPrimaryColor('400')} />
                    <Text style={{ color: getPrimaryColor('50') }} bold>
                      {userInfo.nip05}
                    </Text>
                  </HStack>
                }
              />
            )}
            {userInfo?.lud16 && (
              <RowButton
                onPress={() => handleCopy(userInfo.lud16, 'lud16_copied')}
                rightIcon={<Icon name="lets-icons:copy" size={20} color={getPrimaryColor('400')} />}
                label={
                  <HStack align="center" gap={8}>
                    <Icon name="mdi:lightning-bolt" size={20} color={getPrimaryColor('400')} />
                    <Text style={{ color: getPrimaryColor('50') }} bold>
                      {userInfo.lud16}
                    </Text>
                  </HStack>
                }
              />
            )}
            {userInfo?.website && (
              <RowButton
                isLast
                onPress={() => handleOpenLink(userInfo.website)}
                rightIcon={<Icon name="mdi:open-in-new" size={20} color={getPrimaryColor('400')} />}
                label={
                  <HStack align="center" gap={8}>
                    <Icon name="mdi:web" size={20} color={getPrimaryColor('400')} />
                    <Text style={{ color: getPrimaryColor('50') }} bold>
                      {userInfo.website}
                    </Text>
                  </HStack>
                }
              />
            )}
          </Section>
        </View>

        <Spacer size={8} />

        {/* User Feed */}
        {pubkey ? (
          <UserFeed pubkey={pubkey} authorName={displayName} authorPicture={userInfo?.picture} />
        ) : null}
      </ScrollView>

      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: 'Send Message',
              variant: 'primary',
              onPress: async () => {
                router.push({
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
});

export default withSheetProvider(UserProfileScreen);
