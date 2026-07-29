/**
 * @fileoverview Zapped-post card on the transaction detail screen.
 *
 * The zap message rides as a pill (animated emoji + our message) absolutely
 * positioned across the post card's top edge, so it reads as stuck onto the
 * post. The pill lives OUTSIDE the GradientCard — the card clips its content
 * (`overflow: hidden`), so a pill nested inside could never overhang it.
 *
 * The card itself is plain typography (author + preview), no box inside a
 * box. A zap with no comment shows the emoji alone, tapback-style. Tap
 * anywhere → the post's thread.
 *
 * Pill fill is `surface-tertiary`: `surface` is palette 900 against a 950
 * canvas — one step of separation, which renders as invisible.
 *
 * The thread opens inside the SAME flow group (`(transactions-flow)/thread`)
 * so it pushes in FRONT of the modal — pushing the root `(user-flow)` stack
 * from here opened the thread BEHIND the transactions modal.
 */

import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import opacity from 'hex-color-opacity';

import { getZap } from 'wallet';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useCachedNostrProfile } from '@/shared/lib/nostr/useEntityCache';
import { resolveIdentityName } from '@/shared/lib/identity';
import { Log } from '@/shared/lib/logger';
import { zIndex } from '@/shared/styles/tokens';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { AnimatedEmoji } from '@/shared/ui/primitives/AnimatedEmoji';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';

interface ZappedPostSectionProps {
  entry: { metadata?: Record<string, string> | undefined } | null | undefined;
}

export function ZappedPostSection({ entry }: ZappedPostSectionProps) {
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);
  const zap = entry ? getZap(entry) : null;
  // Fetch-free warm-cache read so a bare annotation still shows a live avatar.
  const { metadata: cachedProfile } = useCachedNostrProfile(zap?.authorPubkey ?? '');

  const eventId = zap?.eventId;
  const openThread = useCallback(() => {
    if (!eventId) return;
    router.push({ pathname: '/(transactions-flow)/thread', params: { eventId } });
  }, [eventId]);

  if (!zap?.eventId) return null;

  const authorName =
    zap.authorName ??
    (zap.authorPubkey
      ? resolveIdentityName({ pubkey: zap.authorPubkey, nostrProfile: cachedProfile })
      : 'Unknown');
  const avatarPicture = zap.authorAvatarUrl ?? cachedProfile?.picture;
  const emoji = zap.emoji ?? '⚡';
  // The animated emoji leads the pill — show the message without its copy.
  const message = zap.comment ? zap.comment.replace(emoji, '').trim() : '';

  return (
    <Log name="ZappedPostSection">
      <Pressable
        onPress={openThread}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Zapped post by ${authorName}. Opens the post.`}
        testID="zapped-post-section"
        style={styles.wrap}>
        <GradientCard contentStyle={styles.cardContent}>
          <View style={styles.inner}>
            <HStack align="center" gap={8} style={styles.authorRow}>
              <Avatar
                state={avatarPicture ? 'image' : 'fallback'}
                picture={avatarPicture}
                seed={zap.authorPubkey}
                name={authorName}
                size={24}
              />
              <Text
                bold
                size={13}
                numberOfLines={1}
                style={[styles.flex, { color: opacity(foreground, 0.66) }]}>
                {authorName}
              </Text>
            </HStack>
            {zap.contentPreview ? (
              <Text size={13} numberOfLines={3} style={{ color: opacity(foreground, 0.55) }}>
                {zap.contentPreview}
              </Text>
            ) : null}
          </View>
        </GradientCard>
        {/* Declared after the card so it paints on top of it. */}
        <HStack gap={8} align="center" style={[styles.pill, { backgroundColor: surfaceTertiary }]}>
          <AnimatedEmoji emoji={emoji} size={18} />
          {message ? (
            <Text medium size={13} numberOfLines={1} style={{ color: foreground }}>
              {message}
            </Text>
          ) : null}
        </HStack>
      </Pressable>
    </Log>
  );
}

const PILL_HEIGHT = 32;

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    // Room for the half of the pill that overhangs the card's top edge.
    paddingTop: PILL_HEIGHT / 2,
  },
  cardContent: {
    overflow: 'hidden',
  },
  inner: {
    paddingHorizontal: 20,
    // Clears the half of the pill that overlaps INTO the card.
    paddingTop: PILL_HEIGHT / 2 + 12,
    paddingBottom: 16,
  },
  authorRow: {
    marginBottom: 6,
  },
  pill: {
    position: 'absolute',
    top: 0,
    // No left/right: `alignSelf` centres the content-width pill on the card.
    alignSelf: 'center',
    maxWidth: '85%',
    height: PILL_HEIGHT,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderCurve: 'continuous',
    zIndex: zIndex.raised,
  },
  flex: {
    flex: 1,
  },
});
