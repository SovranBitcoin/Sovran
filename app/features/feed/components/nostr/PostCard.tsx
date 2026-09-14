import { useFeedIgnoreStore } from '@/features/feed/stores/ignoreStore';
import { avatarStateFor } from '@/shared/lib/imageLoadState';
import React, { useCallback, useMemo, useRef } from 'react';
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
import { withAlpha } from '@/shared/lib/color';
import Reanimated, {
  type SharedValue,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';

import type { FeedEvent, NoteMetrics, ProfileInfo } from './feedTypes';
import { DeletedTombstone } from './DeletedTombstone';
import {
  selectIsDeleteRequested,
  useNostrSocialStore,
} from '@/shared/stores/profile/nostrSocialStore';
import { TierBadge } from '@/shared/ui/composed/TierBadge';
import { formatDate, formatRelativeUnixSeconds } from '@/shared/lib/date';
import { tryNpubEncode } from './feedParse';
import { useQuotePost } from '@/features/feed/lib/useQuotePost';
import { useCardTapGesture } from '@/features/feed/hooks/useCardTapGesture';
import { NoteContent, NOTE_CONTENT_FONT_SIZE } from './NoteContent';
import { NOTE_CONTENT_LINE_HEIGHT } from '@/features/feed/lib/threadListLayout';
import { useProfile, useNoteStats } from '@/shared/lib/nostr/useEntityCache';
import { MetricsFooter, POST_ACTION_ICON_SIZES, type MetricsCountsState } from './MetricsFooter';
import {
  SkeletonExitReveal,
  SkeletonLoadingShimmer,
} from '@/shared/ui/composed/SkeletonExitShimmer';
import { sharedStyles } from './feedStyles';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';
import { seedThread, type ThreadSeed } from '@/features/feed/lib/threadSeedCache';
import { seedProfileFeed } from '@/features/feed/lib/profileFeedSeedCache';
import { radius, spacing } from '@/shared/styles/tokens';
import {
  POST_AVATAR_GAP,
  POST_AVATAR_SIZE,
  POST_CONTENT_INDENT,
  POST_FONT_FAMILY,
  POST_PADDING_BOTTOM,
  POST_PADDING_H,
  POST_PADDING_TOP,
  postInk,
  postType,
} from '@/features/feed/lib/postTypography';
import {
  REPLY_SKELETON_VARIANTS,
  TARGET_SKELETON_VARIANT,
} from '@/features/feed/lib/threadReplySkeletons';
import { THREAD_CONNECTOR_LINE_STYLE } from './threadConnectorStyle';

type PostCardVariant = 'feed' | 'repost-original' | 'thread-target' | 'thread-reply';

const AVATAR_SIZE = POST_AVATAR_SIZE;

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
  displayName,
  nameFallback,
  shortTime,
  placeholderAuthor,
  placeholderTimestamp,
  tierBadge,
  onProfilePress,
  onMorePress,
  onNestedPressIn,
}: {
  loading?: boolean;
  foreground: string;
  hasMore: boolean;
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
}) {
  const nameStyle = [pcStyles.nameText, { color: withAlpha(foreground, postInk.primary) }];
  const timeStyle = [pcStyles.timeText, { color: withAlpha(foreground, postInk.secondary) }];
  return (
    <HStack align="center" gap={spacing.xs} style={sharedStyles.mb4}>
      <HStack align="flex-end" gap={spacing.xs} style={pcStyles.headerTextRow}>
        {loading ? (
          <Text
            loading
            numberOfLines={1}
            placeholder={placeholderAuthor}
            family={POST_FONT_FAMILY}
            semibold
            size={postType.name.size}
            style={pcStyles.nameText}
          />
        ) : (
          // The name lane shrinks first and the time never truncates, so a long
          // name ellipsises while `· 3h` stays whole (Bluesky's flexShrink rule).
          <Pressable onPressIn={onNestedPressIn} onPress={onProfilePress} style={pcStyles.nameLane}>
            <Text
              family={POST_FONT_FAMILY}
              semibold
              size={postType.name.size}
              style={nameStyle}
              numberOfLines={1}
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
            family={POST_FONT_FAMILY}
            size={postType.meta.size}
            style={timeStyle}
          />
        ) : shortTime ? (
          <Text family={POST_FONT_FAMILY} size={postType.meta.size} style={timeStyle}>
            {`· ${shortTime}`}
          </Text>
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
            hitSlop={8}
            onPressIn={onNestedPressIn}
            onPress={onMorePress}
            haptics
            style={pcStyles.moreButton}>
            <Icon name="tabler:dots" size={18} color={withAlpha(foreground, postInk.secondary)} />
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
  /** Draw the full-width divider under the card (skipped anyway when a
   *  connector line runs on into the next card). */
  showFooterBorder?: boolean;

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
  /**
   * Called immediately before navigating to this post's thread. Returns the
   * data the caller already has (visible parent chain via `allEvents`, plus
   * profile/metric/quoted-event maps) so the destination thread can render the
   * post optimistically. The tapped event itself is merged in automatically.
   */
  getThreadContext?: () => ThreadSeed | null;
  /**
   * False when the page that rendered this card carried no counts for it.
   * The card then reads the entity cache (filled by the cross-tier backfill)
   * and shows a placeholder, never a zero, until a source answers.
   */
  metricsKnown?: boolean;
}

export const PostCard = React.memo(function PostCard(props: PostCardProps) {
  const hidden = useFeedIgnoreStore(
    (s) =>
      s.ignoredPubkeys.includes(props.event.pubkey) || s.ignoredEventIds.includes(props.event.id)
  );
  return hidden ? null : <PostCardBody {...props} />;
});

const PostCardBody = React.memo(function PostCardBody({
  event,
  metrics: pageMetrics,
  quotedEvents,
  profiles,
  getMetrics,
  variant,
  showLineAbove = false,
  showLineBelow = false,
  showFooterBorder = true,
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
  getThreadContext,
  metricsKnown = true,
}: PostCardProps) {
  const [foreground, defaultColor] = useThemeColor(['foreground', 'default'] as const);
  // Counts the page did not carry come from the single owner as they land.
  const cachedStats = useNoteStats(metricsKnown ? undefined : event.id);
  const metrics = metricsKnown ? pageMetrics : (cachedStats.metrics ?? pageMetrics);
  const countsState: MetricsCountsState = metricsKnown
    ? 'known'
    : cachedStats.metrics
      ? 'known'
      : cachedStats.status === 'loading'
        ? 'loading'
        : 'unavailable';

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
  const shortTime = formatRelativeUnixSeconds(event.created_at);

  const isTarget = variant === 'thread-target';
  const isThread = variant === 'thread-reply';
  const isFeed = variant === 'feed';

  // Pre-compute opacity color styles to avoid inline object creation
  const textPrimary = { color: withAlpha(foreground, postInk.primary) };
  const textMuted = { color: withAlpha(foreground, postInk.secondary) };
  const dividerStyle = [
    sharedStyles.footerBorder,
    { borderBottomColor: withAlpha(foreground, postInk.divider) },
  ];

  // Thread target: crossfade the in-sheet footer out as the embed sheet
  // collapses. No-op (opacity 1) when not driven.
  const footerFadeStyle = useAnimatedStyle(() => ({ opacity: footerOpacity?.get() ?? 1 }));

  const openThread = useCallback(
    (focusReply: boolean) => {
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
        params: focusReply ? { eventId: event.id, focusReply: '1' } : { eventId: event.id },
      });
    },
    [event, getThreadContext]
  );
  const navigateToThread = useCallback(() => openThread(false), [openThread]);
  // The reply button lands in the thread with the reply box focused.
  const navigateToThreadReply = useCallback(() => openThread(true), [openThread]);

  const navigateToProfile = useCallback(() => {
    // Hand the author's notes this surface already has to the profile screen,
    // so its feed paints as a partial page before the network answers.
    seedProfileFeed(event.pubkey, getThreadContext?.() ?? null);
    // push so each profile pushes a new stack entry — see navigateToProfile.
    router.push({
      pathname: '/(user-flow)/profile',
      params: { pubkey: event.pubkey },
    });
  }, [event.pubkey, getThreadContext]);

  const quotePost = useQuotePost();
  const handleQuotePress = useCallback(
    () => quotePost(event, profile),
    [quotePost, event, profile]
  );

  const {
    gesture: tapGesture,
    suppress: suppressThreadTap,
    handleTap: handleThreadPress,
    begin: beginThreadTap,
    probe: probeThreadTap,
  } = useCardTapGesture(navigateToThread);

  const handleNestedPressIn = useCallback(() => {
    suppressThreadTap();
    onNestedProfilePressIn?.();
  }, [suppressThreadTap, onNestedProfilePressIn]);

  const handleMorePress = useCallback(() => {
    onMorePress?.();
  }, [onMorePress]);

  // Delete-requested: replace the whole card with the tombstone. Placed after
  // all hooks so rules-of-hooks hold across the flip.
  if (deleteRequested) {
    return <DeletedTombstone />;
  }

  // Interaction wiring shared by both layouts' MetricsFooter; layout-specific
  // props (compact/onCommentPress) stay at each site.
  const metricsFooterShared = {
    metrics,
    borderColor: foreground,
    onRepostPress,
    onQuotePress: handleQuotePress,
    onLikePress,
    onZapPress,
    reposted,
    liked,
    replied,
    zapped,
    repostPending,
    likePending,
    zapPending,
    repostPendingDirection,
    likePendingDirection,
    onActionPressIn: handleNestedPressIn,
  };

  // ── Thread target: stacked layout (no gutter) ──
  if (isTarget) {
    const fullDate = event.created_at ? formatDate(event.created_at * 1000, 'short-date-time') : '';
    const truncatedNpub = `${tryNpubEncode(event.pubkey).slice(0, 16)}…`;

    return (
      <Log name="PostCard">
        <View>
          <View style={pcStyles.targetRow}>
            <Pressable onPressIn={handleNestedPressIn} onPress={navigateToProfile}>
              <HStack align="center" gap={10} style={sharedStyles.mb6}>
                <Avatar
                  state={avatarStateFor(profile?.picture, authorStatus !== 'loading')}
                  picture={profile?.picture}
                  seed={event.pubkey}
                  size={AVATAR_SIZE}
                  name={displayName}
                />
                <VStack style={sharedStyles.flex1}>
                  <Text
                    family={POST_FONT_FAMILY}
                    semibold
                    size={postType.name.size}
                    style={[pcStyles.nameText, textPrimary]}
                    numberOfLines={1}
                    fallback={nameFallback}>
                    {displayName}
                  </Text>
                  <Text
                    family={POST_FONT_FAMILY}
                    size={postType.meta.size}
                    style={[pcStyles.timeText, textMuted]}>
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
              onInlineActionPressIn={handleNestedPressIn}
            />

            {fullDate ? (
              <Text
                family={POST_FONT_FAMILY}
                size={postType.meta.size}
                style={[pcStyles.timeText, textMuted, pcStyles.targetDate]}>
                {fullDate}
              </Text>
            ) : null}
          </View>

          <Reanimated.View
            style={[pcStyles.targetMetrics, showFooterBorder && dividerStyle, footerFadeStyle]}>
            <MetricsFooter
              counts={countsState}
              {...metricsFooterShared}
              onCommentPress={onCommentPress ?? navigateToThreadReply}
            />
          </Reanimated.View>
        </View>
      </Log>
    );
  }

  // ── Gutter layout (feed, repost-original, thread-reply) ──
  // One divider rule on every surface: full row width, and never under a card
  // whose connector line continues into the next one.
  const showDivider = showFooterBorder && !showLineBelow;
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
        <Pressable onPressIn={handleNestedPressIn} onPress={navigateToProfile}>
          <Avatar
            state={avatarStateFor(profile?.picture, authorStatus !== 'loading')}
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
          displayName={displayName}
          nameFallback={nameFallback}
          shortTime={shortTime}
          tierBadge={<TierBadge eventId={event.id} />}
          onProfilePress={navigateToProfile}
          onMorePress={handleMorePress}
          onNestedPressIn={handleNestedPressIn}
        />

        <NoteContent
          content={event.content}
          quotedEvents={quotedEvents}
          profiles={profiles}
          getMetrics={getMetrics}
          onVideoTap={onVideoTap}
          onQuotedPressIn={handleNestedPressIn}
          onInlineActionPressIn={handleNestedPressIn}
          onImagePressIn={handleNestedPressIn}
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
          onCommentPress={onCommentPress ?? navigateToThreadReply}
          onRepostPress={onRepostPress}
          onLikePress={onLikePress}
          onZapPress={onZapPress}
          onActionPressIn={handleNestedPressIn}
        />

        <Spacer size={spacing.sm} />

        <View style={[pcStyles.inlineMetricsWrap, showDivider && dividerStyle]}>
          <MetricsFooter
            counts={countsState}
            {...metricsFooterShared}
            compact={isThread}
            // Reply opens the thread (reply box focused) on every variant. It used
            // to be disabled in the feed and rely on the tap falling through to
            // the card, which the action bar now deliberately blocks.
            onCommentPress={onCommentPress ?? navigateToThreadReply}
          />
        </View>
      </View>
    </View>
  );

  if (isFeed) {
    return (
      <Log name="PostCard">
        <GestureDetector gesture={tapGesture}>
          <View
            onStartShouldSetResponderCapture={beginThreadTap}
            onStartShouldSetResponder={probeThreadTap}>
            {gutterContent}
          </View>
        </GestureDetector>
      </Log>
    );
  }

  if (isThread) {
    return (
      <Log name="PostCard">
        <View
          onStartShouldSetResponderCapture={beginThreadTap}
          onStartShouldSetResponder={probeThreadTap}>
          <Pressable onPress={handleThreadPress}>{gutterContent}</Pressable>
        </View>
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
  const textMuted = useMemo(
    () => ({ color: withAlpha(foreground, postInk.secondary) }),
    [foreground]
  );
  const targetDateStyle = useMemo(
    () => [pcStyles.timeText, textMuted, pcStyles.targetDate],
    [textMuted]
  );
  const dividerStyle = useMemo(
    () => [
      sharedStyles.footerBorder,
      { borderBottomColor: withAlpha(foreground, postInk.divider) },
    ],
    [foreground]
  );
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
    revealOpacity.set(withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) }));
  }, [revealOpacity]);

  if (variant === 'thread-target') {
    const skeletonVariant = TARGET_SKELETON_VARIANT;

    return (
      <Reanimated.View onLayout={revealOnSettle} style={revealStyle}>
        <View style={pcStyles.targetRow} pointerEvents="none">
          <HStack align="center" gap={POST_AVATAR_GAP} style={sharedStyles.mb6}>
            <Avatar state="loading" size={AVATAR_SIZE} />
            <VStack style={sharedStyles.flex1}>
              <Text
                loading
                numberOfLines={1}
                placeholder={skeletonVariant.author}
                family={POST_FONT_FAMILY}
                semibold
                size={postType.name.size}
                style={pcStyles.nameText}
              />
              <Text
                loading
                numberOfLines={1}
                placeholder={skeletonVariant.npub}
                family={POST_FONT_FAMILY}
                size={postType.meta.size}
                style={[pcStyles.timeText, textMuted]}
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
                family={POST_FONT_FAMILY}
                size={NOTE_CONTENT_FONT_SIZE}
                style={pcStyles.noteTextLine}
              />
            ))}
          </VStack>

          <Text
            loading
            numberOfLines={1}
            placeholder={skeletonVariant.date}
            family={POST_FONT_FAMILY}
            size={postType.meta.size}
            style={targetDateStyle}
          />
        </View>

        <View style={[pcStyles.targetMetrics, dividerStyle]}>
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

            <View style={[pcStyles.inlineMetricsWrap, dividerStyle]}>
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
  const glyph = compact ? POST_ACTION_ICON_SIZES.compact : POST_ACTION_ICON_SIZES.regular;
  // The real footer's count is a `postType.count` Text; the skeleton must use the
  // SAME size and line height (via a `Text loading` placeholder) — a hardcoded
  // label rectangle was ~7px shorter, which made the reply row grow when real
  // text replaced the skeleton.
  const labelTextSize = postType.count.size;
  const skeletonFill = useMemo(() => withAlpha(borderColor, 0.07), [borderColor]);
  const glyphStyle = useMemo(
    () => ({
      width: glyph,
      height: glyph,
      borderRadius: radius.sm,
      backgroundColor: skeletonFill,
    }),
    [glyph, skeletonFill]
  );
  const labelStyle = useMemo(
    () => ({ width: labelWidth, lineHeight: postType.count.lineHeight }),
    [labelWidth]
  );

  return (
    <View pointerEvents="none">
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
                family={POST_FONT_FAMILY}
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
    gap: POST_AVATAR_GAP,
    paddingHorizontal: POST_PADDING_H,
    paddingTop: POST_PADDING_TOP,
    paddingBottom: POST_PADDING_BOTTOM,
  },
  gutterCol: {
    width: AVATAR_SIZE,
    alignItems: 'center',
  },
  targetRow: {
    paddingHorizontal: POST_PADDING_H,
    paddingTop: POST_PADDING_TOP,
    paddingBottom: POST_PADDING_BOTTOM,
  },
  targetDate: {
    marginTop: spacing.sm,
  },
  targetMetrics: {
    paddingHorizontal: POST_PADDING_H,
  },
  headerTextRow: {
    flex: 1,
    minWidth: 0,
  },
  nameLane: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '70%',
  },
  nameText: {
    lineHeight: postType.name.lineHeight,
  },
  timeText: {
    lineHeight: postType.meta.lineHeight,
    flexShrink: 0,
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
  // Cancels the gutter row's padding so the divider drawn on this wrapper spans
  // the full row; the padding puts the action row back on the text column.
  inlineMetricsWrap: {
    marginLeft: -(POST_CONTENT_INDENT + POST_PADDING_H),
    marginRight: -POST_PADDING_H,
    paddingLeft: POST_CONTENT_INDENT + POST_PADDING_H,
    paddingRight: POST_PADDING_H,
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
