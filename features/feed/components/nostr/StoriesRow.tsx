/**
 * Horizontal stories row showing avatars of followed users who have video posts.
 *
 * Each avatar is wrapped in an Instagram-style gradient ring.
 * Tapping opens the full-screen stories carousel.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Circle as SvgCircle } from 'react-native-svg';
import { Metadata } from 'nostr-tools/kinds';
import { router } from 'expo-router';

import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { Text } from '@/shared/ui/primitives/Text';
import opacity from 'hex-color-opacity';

import {
  type ProfileInfo,
  type VideoPostRecord,
  type RawPrimalEvent,
  type FeedEvent,
  createPrimalRelayClient,
  PRIMAL_CACHE_RELAY_URL,
  getVideoUrlsFromContent,
  normalizeFeedEvent,
  parseProfileFromRaw,
} from './shared';
import type { StoryUser } from './StoriesCarousel';
import { prefetchImages } from '@/shared/lib/imageCache';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

// ============================================================================
// Gradient Ring
// ============================================================================

const DEFAULT_RING_SIZE = 72;
const AVATAR_SIZE = 64;
const STROKE_WIDTH = 3;
const SKELETON_SLOTS = 5;
const STORY_NAME_LINE_HEIGHT = 14;

/**
 * Instagram-style gradient ring around an avatar.
 * Accepts an optional `size` so it can be reused at different scales (e.g. profile page).
 */
export function GradientRing({
  children,
  size = DEFAULT_RING_SIZE,
}: {
  children: React.ReactNode;
  size?: number;
}) {
  const radius = (size - STROKE_WIDTH) / 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="storyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#F58529" />
            <Stop offset="33%" stopColor="#DD2A7B" />
            <Stop offset="66%" stopColor="#8134AF" />
            <Stop offset="100%" stopColor="#515BD4" />
          </LinearGradient>
        </Defs>
        <SvgCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#storyGrad)"
          strokeWidth={STROKE_WIDTH}
          fill="none"
        />
      </Svg>
      <View style={{ borderRadius: size / 2, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

// ============================================================================
// Stories row skeleton (same layout as content to avoid content shift)
// ============================================================================

function StoriesRowSkeleton() {
  const surfaceTertiary = useThemeColor('surface-tertiary');
  const skeletonBg = surfaceTertiary;
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        {Array.from({ length: SKELETON_SLOTS }).map((_, i) => (
          <View key={i} style={styles.storyItem}>
            <Skeleton
              style={{
                width: DEFAULT_RING_SIZE,
                height: DEFAULT_RING_SIZE,
                borderRadius: DEFAULT_RING_SIZE / 2,
                backgroundColor: skeletonBg,
              }}
            />
            <Skeleton
              style={[
                styles.storyName,
                {
                  width: 48,
                  height: STORY_NAME_LINE_HEIGHT,
                  backgroundColor: skeletonBg,
                },
              ]}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Data fetching
// ============================================================================

async function fetchStoryUsers(
  userPubkey: string,
  signal: { cancelled: boolean }
): Promise<StoryUser[]> {
  const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);
  const rp = Date.now().toString(36);

  try {
    const spec = JSON.stringify({
      id: 'feed',
      kind: 'notes',
      notes: 'follows',
      pubkey: userPubkey,
    });
    const rawEvents: RawPrimalEvent[] = await client.request(`${rp}_stories`, {
      cache: ['mega_feed_directive', { spec, limit: 50, user_pubkey: userPubkey }],
    });

    if (signal.cancelled) return [];

    const profiles = new Map<string, ProfileInfo>();
    const events: FeedEvent[] = [];

    for (const raw of rawEvents) {
      if (raw.kind === Metadata) {
        const result = parseProfileFromRaw(raw);
        if (result) profiles.set(result[0], result[1]);
        continue;
      }
      const ev = normalizeFeedEvent(raw);
      if (ev && ev.kind === 1) events.push(ev);
    }

    const userVideoMap = new Map<string, VideoPostRecord[]>();
    for (const ev of events) {
      const videoUrls = getVideoUrlsFromContent(ev.content);
      if (videoUrls.length === 0) continue;
      const existing = userVideoMap.get(ev.pubkey) || [];
      existing.push({
        eventId: ev.id,
        videoUrl: videoUrls[0]!,
        content: ev.content,
        pubkey: ev.pubkey,
        created_at: ev.created_at,
      });
      userVideoMap.set(ev.pubkey, existing);
    }

    const users: StoryUser[] = [];
    for (const [pubkey, videoPosts] of userVideoMap) {
      users.push({ pubkey, profile: profiles.get(pubkey), videoPosts });
    }

    const missingPubkeys = users.filter((u) => !u.profile).map((u) => u.pubkey);
    if (missingPubkeys.length > 0) {
      try {
        const profileRawEvents: RawPrimalEvent[] = await client.request(`${rp}_sp`, {
          cache: ['user_infos', { pubkeys: missingPubkeys }],
        });
        for (const raw of profileRawEvents) {
          if (raw.kind !== Metadata) continue;
          const result = parseProfileFromRaw(raw);
          if (result) profiles.set(result[0], result[1]);
        }
        for (const u of users) {
          if (!u.profile) u.profile = profiles.get(u.pubkey);
        }
      } catch {}
    }

    return users;
  } finally {
    client.close();
  }
}

// ============================================================================
// StoriesRow
// ============================================================================

interface StoriesRowProps {
  userPubkey?: string;
}

export function StoriesRow({ userPubkey }: StoriesRowProps) {
  const foreground = useThemeColor('foreground');
  const [storyUsers, setStoryUsers] = useState<StoryUser[]>([]);
  const [loading, setLoading] = useState(true);

  const nameColor = { color: opacity(foreground, 0.7) };

  useEffect(() => {
    prefetchImages(storyUsers.map((user) => user.profile?.picture));
  }, [storyUsers]);

  useEffect(() => {
    if (!userPubkey) {
      setLoading(false);
      return;
    }

    const signal = { cancelled: false };
    fetchStoryUsers(userPubkey, signal)
      .then((users) => {
        if (!signal.cancelled) {
          setStoryUsers(users);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!signal.cancelled) setLoading(false);
      });

    return () => {
      signal.cancelled = true;
    };
  }, [userPubkey]);

  const handleStoryPress = useCallback(
    (index: number) => {
      router.navigate({
        pathname: '/(stories-flow)/stories' as any,
        params: {
          startIndex: String(index),
          storyUsersJson: JSON.stringify(storyUsers),
        },
      });
    },
    [storyUsers]
  );

  if (loading || storyUsers.length === 0) {
    return <StoriesRowSkeleton />;
  }

  return (
    <Log name="StoriesRow">
      <View style={styles.container}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          {storyUsers.map((user, index) => {
            const name = user.profile?.name || user.pubkey.slice(0, 8) + '…';
            return (
              <Pressable
                key={user.pubkey}
                style={styles.storyItem}
                onPress={() => handleStoryPress(index)}>
                <GradientRing>
                  <Avatar
                    state={user.profile?.picture ? 'image' : 'fallback'}
                    picture={user.profile?.picture}
                    seed={user.pubkey}
                    name={user.profile?.name}
                    size={AVATAR_SIZE}
                  />
                </GradientRing>
                <Text size={11} numberOfLines={1} style={[styles.storyName, nameColor]}>
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Log>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 12,
    gap: 12,
  },
  storyItem: {
    alignItems: 'center',
    width: DEFAULT_RING_SIZE + 4,
  },
  storyName: {
    marginTop: 4,
    textAlign: 'center',
  },
});
