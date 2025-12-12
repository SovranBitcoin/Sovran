/**
 * @fileoverview User Profile Info Screen
 *
 * Displays Nostr user profile information with:
 * - Banner image with overlapping avatar
 * - Stats grid (Following, Followers, Notes, Joined)
 * - Actions section (Message User)
 * - Profile info section (npub, nip05, lud16, website)
 */

import React, { useEffect, useRef, useMemo, useCallback } from 'react';
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
import { Metadata, Contacts, ShortTextNote } from 'nostr-tools/kinds';
import { nip19 } from 'nostr-tools';
import { popup } from '@/helper/popup';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BANNER_HEIGHT = 150;
const AVATAR_SIZE = 90;
const AVATAR_OVERFLOW = AVATAR_SIZE / 4; // 1/4 overflows below banner

// ============================================================================
// Profile Stats Grid
// ============================================================================
function ProfileStatsGridComponent({
  followingCount,
  followerCount,
  notesCount,
  joinedDate,
  isLoading,
}: {
  followingCount?: number;
  followerCount?: number;
  notesCount?: number;
  joinedDate?: string;
  isLoading: boolean;
}) {
  const { getPrimaryColor } = useTheme();

  const displayValues = useMemo(
    () => ({
      following: followingCount !== undefined ? followingCount.toString() : '0',
      followers: followerCount !== undefined ? followerCount.toString() : '0',
      notes: notesCount !== undefined ? notesCount.toString() : '0',
      joined: joinedDate || 'Unknown',
    }),
    [followingCount, followerCount, notesCount, joinedDate]
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
    notesCount !== undefined ||
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
        accent: true,
      },
      {
        label: 'Followers',
        description: 'Approximate count',
        value: displayValues.followers,
        accent: true,
      },
      {
        label: 'Notes',
        description: 'Posts published',
        value: displayValues.notes,
        accent: false,
      },
      {
        label: 'Joined',
        description: 'Account created',
        value: displayValues.joined,
        accent: false,
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
            <Skeleton
              style={[
                styles.skeletonValue,
                { backgroundColor: getPrimaryColor('700'), width: stat.accent ? 100 : 60 },
              ]}
            />
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
              size={stat.accent ? 24 : 16}
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
      <View style={[styles.bannerContainer, { backgroundColor: getPrimaryColor('800') }]}>
        {bannerUrl ? (
          <Image source={{ uri: bannerUrl }} style={styles.bannerImage} resizeMode="cover" />
        ) : (
          <View style={[styles.bannerPlaceholder, { backgroundColor: getPrimaryColor('700') }]} />
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
// Helper Functions
// ============================================================================
const formatJoinedDate = (timestamp?: number): string => {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

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
  // NOSTR SUBSCRIPTIONS
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

  // Only start social stats subscriptions after metadata is loaded
  const metadataLoaded = metadataEose;

  // Contact list for following count (kind 3)
  const contactFilters = useMemo(
    () =>
      pubkey && metadataLoaded
        ? [
            {
              authors: [pubkey],
              kinds: [Contacts],
              limit: 1,
            },
          ]
        : null,
    [pubkey, metadataLoaded]
  );
  const { events: contactEvents, eose: contactsEose } = useSubscribe({
    filters: contactFilters,
  });

  // Follower count approximation (kind 3 events where user is tagged)
  const followerFilters = useMemo(
    () =>
      pubkey && metadataLoaded
        ? [
            {
              kinds: [Contacts],
              '#p': [pubkey],
              limit: 500,
            },
          ]
        : null,
    [pubkey, metadataLoaded]
  );
  const { events: followerEvents, eose: followersEose } = useSubscribe({
    filters: followerFilters,
  });

  // Notes count (kind 1)
  const notesFilters = useMemo(
    () =>
      pubkey && metadataLoaded
        ? [
            {
              authors: [pubkey],
              kinds: [ShortTextNote],
              limit: 500,
            },
          ]
        : null,
    [pubkey, metadataLoaded]
  );
  const { events: notesEvents, eose: notesEose } = useSubscribe({
    filters: notesFilters,
  });

  // ===========================
  // DERIVED STATE
  // ===========================
  const userInfo = metadataEvents?.[0] ? JSON.parse(metadataEvents[0].content) : null;
  const displayName = userInfo?.display_name || userInfo?.name || truncateMiddle(npub, 8);
  const isMetadataLoading = !metadataEose;

  // Following count from contact list
  const followingCount = useMemo(() => {
    if (!contactEvents?.[0]) return undefined;
    return contactEvents[0].tags.filter((t: string[]) => t[0] === 'p').length;
  }, [contactEvents]);

  // Follower count (approximation from sampled events)
  const followerCount = useMemo(() => {
    if (!followerEvents) return undefined;
    return followerEvents.length;
  }, [followerEvents]);

  // Notes count
  const notesCount = useMemo(() => {
    if (!notesEvents) return undefined;
    return notesEvents.length;
  }, [notesEvents]);

  // Joined date from profile created_at
  const joinedDate = useMemo(() => {
    const timestamp = metadataEvents?.[0]?.created_at;
    return formatJoinedDate(timestamp);
  }, [metadataEvents]);

  const isStatsLoading = !contactsEose && !followersEose && !notesEose;

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
            notesCount={notesCount}
            joinedDate={joinedDate}
            isLoading={isStatsLoading}
          />
        </View>

        <Spacer size={16} />

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
      </ScrollView>

      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: 'Close',
              variant: 'secondary',
              onPress: async () => {
                router.back();
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
    justifyContent: 'center',
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
});

export default withSheetProvider(UserProfileScreen);
