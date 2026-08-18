import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import Icon from '@/assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import opacity from 'hex-color-opacity';
import Reanimated, {
  type SharedValue,
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import type { FeedEvent, NoteMetrics, ProfileInfo } from './feedTypes';
import { DeletedTombstone } from './DeletedTombstone';
import {
  selectIsDeleteRequested,
  useNostrSocialStore,
} from '@/shared/stores/profile/nostrSocialStore';
import { TierBadge } from '@/shared/ui/composed/TierBadge';
import { formatDate, formatRelative } from '@/shared/lib/date';
import { tryNpubEncode } from './feedParse';
import { useQuotePost } from '@/features/feed/lib/useQuotePost';
import { NoteContent, NOTE_CONTENT_FONT_SIZE, NOTE_CONTENT_LINE_HEIGHT } from './NoteContent';
import { useProfile } from '@/shared/lib/nostr/useEntityCache';
import { MetricsFooter, POST_ACTION_ICON_SIZES } from './MetricsFooter';
import {
  SkeletonExitReveal,
  SkeletonLoadingShimmer,
} from '@/shared/ui/composed/SkeletonExitShimmer';
import { sharedStyles } from './feedStyles';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';
import { seedThread, type ThreadSeed } from '@/features/feed/lib/threadSeedCache';
import { alpha, radius, spacing } from '@/shared/styles/tokens';
import {
  REPLY_SKELETON_VARIANTS,
  TARGET_SKELETON_VARIANT,
} from '@/features/feed/lib/threadReplySkeletons';
import { THREAD_CONNECTOR_LINE_STYLE } from './threadConnectorStyle';

type PostCardVariant = 'feed' | 'repost-original' | 'thread-target' | 'thread-reply';

const AVATAR_SIZE = 36;

const METRIC_SKELETON_ITEMS = [0, 1, 2, 3] as const;

/**
 * The gutter post's header row (name · time, plus the "⋯ more" button), shared by
 * the real `PostCard` and `PostCardSkeleton` so their chrome can NEVER drift — a
 * skeleton that hand-duplicated this row had silently dropped the more-button and
 * rendered ~6px short, growing the row when real content replaced it. Rendering both
 * states from one component guarantees identical height/structure.
 */
function PostCardGutterHeader({
  loading = false,
  foreground,
  hasMore,
  isThread = false,
  displayName,
  nameFallback,
  shortTime,
  placeholderAuthor,
  placeholderTimestamp,
  tierBadge,
  onProfilePress,
  onMorePress,
  onNestedPressIn,
  onNestedPressOut,
}: {
  loading?: boolean;
  foreground: string;
  hasMore: boolean;
  isThread?: boolean;
  displayName?: string;
  nameFallback?: string;
  shortTime?: string;
  placeholderAuthor?: string;
  placeholderTimestamp?: string;
  // Dev-only source-tier chip rendered after the timestamp; never set in production.
  tierBadge?: React.ReactNode;
  onProfilePress?: () => void;
  onMorePress?: () => void;
  onNestedPressIn?: () => void;
  onNestedPressOut?: () => void;
}) {
  const textPrimary = { color: opacity(foreground, 0.9) };
  const textMuted = { color: opacity(foreground, 0.4) };
  const textDimmed = { color: opacity(foreground, 0.3) };
  return (
    <HStack align="center" gap={6} style={sharedStyles.mb4}>
      <HStack align="center" gap={6} style={pcStyles.headerTextRow}>
        {loading ? (
          <Text loading numberOfLines={1} placeholder={placeholderAuthor} bold size={14} />
        ) : (
          <Pressable
            onPressIn={onNestedPressIn}
            onPressOut={onNestedPressOut}
            onPress={onProfilePress}>
            <Text
              bold
              size={14}
              style={textPrimary}
              numberOfLines={isThread ? 1 : undefined}
              fallback={nameFallback}>
              {displayName}
            </Text>
          </Pressable>
        )}
        {loading ? (
          <Text
            loading
            numberOfLines={1}
            placeholder={placeholderTimestamp}
            size={13}
            style={textMuted}
          />
        ) : shortTime ? (
          <>
            <Text bold size={13} style={[textDimmed, pcStyles.dotSeparator]}>
              {'•'}
            </Text>
            <Text size={13} style={textMuted}>
              {shortTime}
            </Text>
          </>
        ) : null}
        {tierBadge}
      </HStack>
      {hasMore ? (
        loading ? (
          // Empty box at the real more-button's exact dimensions — reserves the same
          // height so the skeleton row matches the real row.
          <View style={pcStyles.moreButton} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More post actions"
            onPressIn={onNestedPressIn}
            onPressOut={onNestedPressOut}
            onPress={onMorePress}
            haptics
            style={pcStyles.moreButton}>
            <Icon name="tabler:dots" size={18} color={opacity(foreground, 0.5)} />
          </Pressable>
        )
      ) : null}
    </HStack>
  );
}

interface PostCardProps {
  event: FeedEvent;
  metrics: NoteMetrics;
  quotedEvents: Map<string, FeedEvent>;
  profiles: Map<string, ProfileInfo>;
  getMetrics: (eventId: string) => NoteMetrics;
  variant: PostCardVariant;

  showLineAbove?: boolean;
  showLineBelow?: boolean;
  showFooterBorder?: boolean;
  fullBleedFooterBorder?: boolean;

  index?: number;
  skipAnimation?: boolean;
  /** Feed list index (when in feed); used so swipe-up can scroll to next video post. */
  feedIndex?: number;
  /** Called when overlay is opened from this post so feed can track source index. */
  onOverlayOpenedFromIndex?: (index: number) => void;

  onVideoTap?: (url: string) => void;
  /** Thread target only: tapping an inline link embeds it in-thread instead of
   *  opening the OS browser. */
  onLinkPress?: (url: string) => void;
  /** Thread target only: fades the in-sheet footer out as the embed sheet
   *  collapses (it crossfades with the floating action bar). */
  footerOpacity?: SharedValue<number>;
  onCommentPress?: () => void;
  onRepostPress?: () => void;
  onLikePress?: () => void;
  onZapPress?: () => void;
  onMorePress?: () => void;
  reposted?: boolean;
  liked?: boolean;
  replied?: boolean;
  zapped?: boolean;
  repostPending?: boolean;
  likePending?: boolean;
  zapPending?: boolean;
  repostPendingDirection?: 'activating' | 'deactivating';
  likePendingDirection?: 'activating' | 'deactivating';
  onNestedProfilePressIn?: () => void;
  onNestedProfilePressOut?: () => void;
  /**
   * Called immediately before navigating to this post's thread. Returns the
   * data the caller already has (visible parent chain via `allEvents`, plus
   * profile/metric/quoted-event maps) so the destination thread can render the
   * post optimistically. The tapped event itself is merged in automatically.
   */
  getThreadContext?: () => ThreadSeed | null;
}

export const PostCard = React.memo(function PostCard({
  event,
  metrics,
  quotedEvents,
  profiles,
  getMetrics,
  variant,
  showLineAbove = false,
  showLineBelow = false,
  showFooterBorder = true,
  fullBleedFooterBorder = false,
  index = 0,
  skipAnimation = true,
  feedIndex,
  onOverlayOpenedFromIndex,
  onVideoTap,
  onLinkPress,
  footerOpacity,
  onCommentPress,
  onRepostPress,
  onLikePress,
  onZapPress,
  onMorePress,
  reposted = false,
  liked = false,
  replied = false,
  zapped = false,
  repostPending = false,
  likePending = false,
  zapPending = false,
  repostPendingDirection,
  likePendingDirection,
  onNestedProfilePressIn,
  onNestedProfilePressOut,
  getThreadContext,
}: PostCardProps) {
  const [foreground, defaultColor] = useThemeColor(['foreground', 'default'] as const);

  // We requested deletion of this note (kind:5 sent) — show the greyed
  // tombstone instead of the post. `deletedNoteIds` only ever holds our own
  // notes, so a hit means "you deleted this". The gutter variants inset the
  // tombstone to line up with the text column; the stacked target does not.
  const deleteRequested = useNostrSocialStore(selectIsDeleteRequested(event.id));

  // Author identity comes from the authoritative entity cache, reactively: the
  // row re-renders in place when this pubkey's profile arrives (no manual re-key),
  // and any surface that saw this author renders it here too. `status` tells a
  // genuine loading skeleton apart from a fallback. (`profiles` is still passed to
  // NoteContent for inline mention chips.)
  const { profile, status: authorStatus } = useProfile(event.pubkey);
  // Real display name only. The abbreviated npub fallback is passed as Text's
  // `fallback` prop so the name never flashes through a pubkey placeholder.
  const displayName = profile?.name;
  const nameFallback = `${tryNpubEncode(event.pubkey).slice(0, 12)}…`;
  const shortTime = event.created_at ? formatRelative(event.created_at * 1000, 'compact') : '';

  const isTarget = variant === 'thread-target';
  const isThread = variant === 'thread-reply';
  const isFeed = variant === 'feed';

  // Pre-compute opacity color styles to avoid inline object creation
  const textPrimary = { color: opacity(foreground, 0.9) };
  const textMuted = { color: opacity(foreground, 0.4) };

  // Entry animation — only for feed variant on initial load
  const shouldAnimate = isFeed && !skipAnimation;
  const progress = useSharedValue(shouldAnimate ? 0 : 1);

  useEffect(() => {
    if (!shouldAnimate) return;
    progress.set(
      withDelay(
        Math.min(index * 60, 300),
        withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) })
      )
    );
  }, [progress, index, shouldAnimate]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 12 }],
  }));

  // Thread target: crossfade the in-sheet footer out as the embed sheet
  // collapses. No-op (opacity 1) when not driven.
  const footerFadeStyle = useAnimatedStyle(() => ({ opacity: footerOpacity?.get() ?? 1 }));

  const navigateToThread = useCallback(() => {
    const ctx = getThreadContext?.() ?? null;
    const allEvents = new Map(ctx?.allEvents ?? []);
    allEvents.set(event.id, event);
    seedThread(event.id, {
      allEvents,
      profiles: ctx?.profiles ?? new Map(),
      metrics: ctx?.metrics ?? new Map(),
      quotedEvents: ctx?.quotedEvents ?? new Map(),
      replyPreviewEventIds: ctx?.replyPreviewEventIds,
    });
    router.push({
      pathname: '/(user-flow)/thread',
      params: { eventId: event.id },
    });
  }, [event, getThreadContext]);

  const navigateToProfile = useCallback(() => {
    // push so each profile pushes a new stack entry — see navigateToProfile.
    router.push({
      pathname: '/(user-flow)/profile',
      params: { pubkey: event.pubkey },
    });
  }, [event.pubkey]);

  const quotePost = useQuotePost();
  const handleQuotePress = useCallback(
    () => quotePost(event, profile),
    [quotePost, event, profile]
  );

  const suppressThreadTapRef = useRef(false);

  const handleNestedPressIn = useCallback(() => {
    suppressThreadTapRef.current = true;
    onNestedProfilePressIn?.();
  }, [onNestedProfilePressIn]);

  const handleNestedPressOut = useCallback(() => {
    setTimeout(() => {
      suppressThreadTapRef.current = false;
    }, 0);
    onNestedProfilePressOut?.();
  }, [onNestedProfilePressOut]);

  const handleThreadPress = useCallback(() => {
    if (suppressThreadTapRef.current) return;
    navigateToThread();
  }, [navigateToThread]);

  const handleMorePress = useCallback(() => {
    onMorePress?.();
  }, [onMorePress]);

  const tapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        'worklet';
        runOnJS(handleThreadPress)();
      }),
    [handleThreadPress]
  );

  // Delete-requested: replace the whole card with the tombstone. Placed after
  // all hooks so rules-of-hooks hold across the flip.
  if (deleteRequested) {
    return <DeletedTombstone />;
  }

  // ── Thread target: stacked layout (no gutter) ──
  if (isTarget) {
    const fullDate = event.created_at ? formatDate(event.created_at * 1000, 'short-date-time') : '';
    const truncatedNpub = `${tryNpubEncode(event.pubkey).slice(0, 16)}…`;

    return (
      <Log name="PostCard">
        <View>
          <View style={pcStyles.targetRow}>
            <Pressable
              onPressIn={handleNestedPressIn}
              onPressOut={handleNestedPressOut}
              onPress={navigateToProfile}>
              <HStack align="center" gap={10} style={sharedStyles.mb6}>
                <Avatar
                  state={
                    profile?.picture ? 'image' : authorStatus === 'loading' ? 'loading' : 'fallback'
                  }
                  picture={profile?.picture}
                  seed={event.pubkey}
                  size={AVATAR_SIZE}
                  name={displayName}
                />
                <VStack style={sharedStyles.flex1}>
                  <Text
                    bold
                    size={15}
                    style={textPrimary}
                    numberOfLines={1}
                    fallback={nameFallback}>
                    {displayName}
                  </Text>
                  <Text semibold size={13} style={textMuted}>
                    {truncatedNpub}
                  </Text>
                </VStack>
              </HStack>
            </Pressable>

            <NoteContent
              content={event.content}
              quotedEvents={quotedEvents}
              profiles={profiles}
              getMetrics={getMetrics}
              event={event}
              onVideoTap={onVideoTap}
              onLinkPress={onLinkPress}
              onQuotedPressIn={handleNestedPressIn}
              onQuotedPressOut={handleNestedPressOut}
              onInlineActionPressIn={handleNestedPressIn}
              onInlineActionPressOut={handleNestedPressOut}
            />

            {fullDate ? (
              <Text size={13} style={[textMuted, pcStyles.targetDate]}>
                {fullDate}
              </Text>
            ) : null}
          </View>

          <Reanimated.View style={[pcStyles.targetMetrics, footerFadeStyle]}>
            <MetricsFooter
              metrics={metrics}
              borderColor={foreground}
              onCommentPress={onCommentPress ?? navigateToThread}
              onRepostPress={onRepostPress}
              onQuotePress={handleQuotePress}
              onLikePress={onLikePress}
              onZapPress={onZapPress}
              reposted={reposted}
              liked={liked}
              replied={replied}
              zapped={zapped}
              repostPending={repostPending}
              likePending={likePending}
              zapPending={zapPending}
              repostPendingDirection={repostPendingDirection}
              likePendingDirection={likePendingDirection}
              onActionPressIn={handleNestedPressIn}
              onActionPressOut={handleNestedPressOut}
            />
          </Reanimated.View>
        </View>
      </Log>
    );
  }

  // ── Gutter layout (feed, repost-original, thread-reply) ──
  const hasConnectingBars = showLineAbove || showLineBelow;
  const showMetricsBorder = showFooterBorder && (isThread ? !hasConnectingBars : true);
  const lineColor = defaultColor;

  const gutterContent = (
    <View style={pcStyles.gutterRow}>
      <View style={pcStyles.gutterCol}>
        {showLineAbove ? (
          <View
            style={[
              pcStyles.lineAbove,
              THREAD_CONNECTOR_LINE_STYLE,
              { borderLeftColor: lineColor },
            ]}
          />
        ) : null}
        <Pressable
          onPressIn={handleNestedPressIn}
          onPressOut={handleNestedPressOut}
          onPress={navigateToProfile}>
          <Avatar
            state={profile?.picture ? 'image' : 'fallback'}
            picture={profile?.picture}
            seed={event.pubkey}
            size={AVATAR_SIZE}
            name={displayName}
          />
        </Pressable>
        {showLineBelow ? (
          <View
            style={[
              pcStyles.lineBelow,
              THREAD_CONNECTOR_LINE_STYLE,
              { borderLeftColor: lineColor },
            ]}
          />
        ) : null}
      </View>

      <View style={sharedStyles.flex1}>
        <PostCardGutterHeader
          foreground={foreground}
          hasMore={!!onMorePress}
          isThread={isThread}
          displayName={displayName}
          nameFallback={nameFallback}
          shortTime={shortTime}
          tierBadge={<TierBadge eventId={event.id} />}
          onProfilePress={navigateToProfile}
          onMorePress={handleMorePress}
          onNestedPressIn={handleNestedPressIn}
          onNestedPressOut={handleNestedPressOut}
        />

        <NoteContent
          content={event.content}
          quotedEvents={quotedEvents}
          profiles={profiles}
          getMetrics={getMetrics}
          onVideoTap={onVideoTap}
          onQuotedPressIn={handleNestedPressIn}
          onQuotedPressOut={handleNestedPressOut}
          onInlineActionPressIn={handleNestedPressIn}
          onInlineActionPressOut={handleNestedPressOut}
          onImagePressIn={handleNestedPressIn}
          onImagePressOut={handleNestedPressOut}
          event={event}
          metrics={metrics}
          profile={profile}
          feedIndex={feedIndex}
          onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
          reposted={reposted}
          liked={liked}
          replied={replied}
          zapped={zapped}
          repostPending={repostPending}
          likePending={likePending}
          zapPending={zapPending}
          repostPendingDirection={repostPendingDirection}
          likePendingDirection={likePendingDirection}
          onCommentPress={onCommentPress ?? navigateToThread}
          onRepostPress={onRepostPress}
          onLikePress={onLikePress}
          onZapPress={onZapPress}
          onActionPressIn={handleNestedPressIn}
          onActionPressOut={handleNestedPressOut}
        />

        <Spacer size={8} />

        <View
          style={[
            fullBleedFooterBorder
              ? pcStyles.inlineMetricsWrapFullBleed
              : pcStyles.inlineMetricsWrap,
            fullBleedFooterBorder && showMetricsBorder && pcStyles.inlineMetricsWrapFullBleedBorder,
            fullBleedFooterBorder &&
              showMetricsBorder && { borderBottomColor: opacity(foreground, 0.1) },
          ]}>
          <MetricsFooter
            metrics={metrics}
            borderColor={foreground}
            compact={isThread}
            showBorder={!fullBleedFooterBorder && showMetricsBorder}
            onCommentPress={isThread ? (onCommentPress ?? navigateToThread) : undefined}
            onRepostPress={onRepostPress}
            onQuotePress={handleQuotePress}
            onLikePress={onLikePress}
            onZapPress={onZapPress}
            reposted={reposted}
            liked={liked}
            replied={replied}
            zapped={zapped}
            repostPending={repostPending}
            likePending={likePending}
            zapPending={zapPending}
            repostPendingDirection={repostPendingDirection}
            likePendingDirection={likePendingDirection}
            onActionPressIn={handleNestedPressIn}
            onActionPressOut={handleNestedPressOut}
          />
        </View>
      </View>
    </View>
  );

  if (isFeed) {
    return (
      <Log name="PostCard">
        <GestureDetector gesture={tapGesture}>
          <Reanimated.View style={animStyle}>{gutterContent}</Reanimated.View>
        </GestureDetector>
      </Log>
    );
  }

  if (isThread) {
    return (
      <Log name="PostCard">
        <Pressable onPress={handleThreadPress}>{gutterContent}</Pressable>
      </Log>
    );
  }

  return <Log name="PostCard">{gutterContent}</Log>;
});

export const PostCardSkeleton = React.memo(function PostCardSkeleton({
  variant,
  index = 0,
  exiting = false,
}: {
  variant: Extract<PostCardVariant, 'thread-target' | 'thread-reply'>;
  index?: number;
  exiting?: boolean;
}) {
  const [foreground, loadingShimmerSurface] = useThemeColor(['foreground', 'surface'] as const);
  const textMuted = useMemo(() => ({ color: opacity(foreground, alpha.muted) }), [foreground]);
  const targetDateStyle = useMemo(() => [textMuted, pcStyles.targetDate], [textMuted]);
  const replyVariant = REPLY_SKELETON_VARIANTS[index % REPLY_SKELETON_VARIANTS.length];

  // Render invisible, then fade in once the row has laid out ("settled") so the
  // first-frame list positioning is never seen — any residual settle happens
  // while opacity is 0, and the skeleton appears already in its final spot.
  const revealedRef = useRef(false);
  const revealOpacity = useSharedValue(0);
  const revealStyle = useAnimatedStyle(() => ({ opacity: revealOpacity.value }));
  const revealOnSettle = useCallback(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    revealOpacity.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
  }, [revealOpacity]);

  if (variant === 'thread-target') {
    const skeletonVariant = TARGET_SKELETON_VARIANT;

    return (
      <Reanimated.View onLayout={revealOnSettle} style={revealStyle}>
        <View style={pcStyles.targetRow} pointerEvents="none">
          <HStack align="center" gap={spacing.sm + 2} style={sharedStyles.mb6}>
            <Avatar state="loading" size={AVATAR_SIZE} />
            <VStack style={sharedStyles.flex1}>
              <Text loading numberOfLines={1} placeholder={skeletonVariant.author} bold size={15} />
              <Text
                loading
                numberOfLines={1}
                placeholder={skeletonVariant.npub}
                semibold
                size={13}
                style={textMuted}
              />
            </VStack>
          </HStack>

          <VStack gap={0}>
            {skeletonVariant.content.map((line) => (
              <Text
                key={line}
                loading
                numberOfLines={1}
                placeholder={line}
                size={NOTE_CONTENT_FONT_SIZE}
                style={pcStyles.noteTextLine}
              />
            ))}
          </VStack>

          <Text
            loading
            numberOfLines={1}
            placeholder={skeletonVariant.date}
            size={13}
            style={targetDateStyle}
          />
        </View>

        <View style={pcStyles.targetMetrics}>
          <MetricsFooterSkeleton
            compact={false}
            borderColor={foreground}
            labelWidth={skeletonVariant.metricWidth}
          />
        </View>
        <SkeletonLoadingShimmer active highlightColor={loadingShimmerSurface} />
      </Reanimated.View>
    );
  }

  const skeletonVariant = replyVariant;

  return (
    <Reanimated.View onLayout={revealOnSettle} style={revealStyle}>
      <SkeletonExitReveal active={exiting}>
        <View style={pcStyles.gutterRow} pointerEvents="none">
          <View style={pcStyles.gutterCol}>
            <Avatar state="loading" size={AVATAR_SIZE} />
          </View>

          <View style={sharedStyles.flex1}>
            {/* Same header component as the real post (loading state) — guarantees the
                author row (incl. the more-button box) matches the real row's height. */}
            <PostCardGutterHeader
              loading
              foreground={foreground}
              hasMore
              isThread
              placeholderAuthor={skeletonVariant.author}
              placeholderTimestamp={skeletonVariant.timestamp}
            />

            <VStack gap={0}>
              {skeletonVariant.content.map((line) => (
                <Text
                  key={line}
                  loading
                  numberOfLines={1}
                  placeholder={line}
                  size={NOTE_CONTENT_FONT_SIZE}
                  style={pcStyles.noteTextLine}
                />
              ))}
            </VStack>

            <Spacer size={spacing.sm} />

            <View style={pcStyles.inlineMetricsWrap}>
              <MetricsFooterSkeleton
                compact
                borderColor={foreground}
                labelWidth={skeletonVariant.metricWidth}
              />
            </View>
          </View>
        </View>
      </SkeletonExitReveal>
      <SkeletonLoadingShimmer active={!exiting} highlightColor={loadingShimmerSurface} />
    </Reanimated.View>
  );
});

const MetricsFooterSkeleton = React.memo(function MetricsFooterSkeleton({
  compact,
  borderColor,
  labelWidth,
}: {
  compact: boolean;
  borderColor: string;
  labelWidth: number;
}) {
  const glyph = compact ? POST_ACTION_ICON_SIZES.compact.base : POST_ACTION_ICON_SIZES.regular.base;
  // The real footer's count is a `Text size={11/13}` with no lineHeight, so the
  // footer row is as tall as that font's line box. The skeleton must use the SAME
  // size (via a `Text loading` placeholder) — a hardcoded label rectangle was ~7px
  // shorter, which made the reply row grow when real text replaced the skeleton.
  const labelTextSize = compact ? 11 : 13;
  const skeletonFill = useMemo(() => opacity(borderColor, 0.07), [borderColor]);
  const footerStyle = useMemo(
    () => [
      sharedStyles.noteFooter,
      sharedStyles.footerBorder,
      { borderBottomColor: opacity(borderColor, alpha.faint) },
    ],
    [borderColor]
  );
  const glyphStyle = useMemo(
    () => ({
      width: glyph,
      height: glyph,
      borderRadius: radius.sm,
      backgroundColor: skeletonFill,
    }),
    [glyph, skeletonFill]
  );
  const labelStyle = useMemo(() => ({ width: labelWidth }), [labelWidth]);

  return (
    <View style={footerStyle} pointerEvents="none">
      <HStack align="center" justify="space-between">
        {METRIC_SKELETON_ITEMS.map((item) => (
          <HStack key={item} align="center" gap={spacing.xs}>
            <Skeleton style={glyphStyle} />
            {item < 3 ? (
              // Self-sizes to the real count's line box (same `size`), so the footer
              // row height matches the real footer exactly. Width kept via `labelWidth`.
              <Text
                loading
                numberOfLines={1}
                size={labelTextSize}
                placeholder="0"
                style={labelStyle}
              />
            ) : null}
          </HStack>
        ))}
      </HStack>
    </View>
  );
});

const pcStyles = StyleSheet.create({
  gutterRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  gutterCol: {
    width: AVATAR_SIZE,
    alignItems: 'center',
  },
  targetRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  targetDate: {
    marginTop: 10,
  },
  targetMetrics: {
    paddingHorizontal: 16,
  },
  dotSeparator: {
    marginRight: 4,
  },
  headerTextRow: {
    flex: 1,
    minWidth: 0,
  },
  moreButton: {
    width: 30,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -4,
    marginRight: -6,
    borderRadius: 14,
  },
  inlineMetricsWrap: {
    marginLeft: -(AVATAR_SIZE + 12),
    marginRight: -16,
    paddingLeft: AVATAR_SIZE + 12,
    paddingRight: 16,
  },
  inlineMetricsWrapFullBleed: {
    marginLeft: -(AVATAR_SIZE + 12 + 16),
    marginRight: -16,
    paddingLeft: AVATAR_SIZE + 12 + 16,
    paddingRight: 16,
  },
  inlineMetricsWrapFullBleedBorder: {
    borderBottomWidth: 1,
    paddingBottom: 10,
  },
  noteTextLine: {
    lineHeight: NOTE_CONTENT_LINE_HEIGHT,
  },
  lineAbove: {
    position: 'absolute',
    top: 0,
    left: AVATAR_SIZE / 2 - 1,
    height: AVATAR_SIZE / 2,
  },
  lineBelow: {
    flex: 1,
    marginTop: 6,
  },
});
