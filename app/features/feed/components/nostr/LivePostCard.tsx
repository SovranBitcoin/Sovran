/**
 * @fileoverview Post cards that follow their own note's engagement.
 *
 * A list hands these the note and the surface's counts; the card subscribes to
 * that one note's likes, reposts and zaps. The list therefore passes nothing
 * that changes when some other note is liked, and only the card whose note
 * changed re-renders.
 */

import React from 'react';

import type { FeedRow } from '@/features/feed/lib/feedRows';
import { useNoteEngagement } from '@/features/feed/hooks/useNoteEngagement';

import type { createFeedPostCardProps } from './feedPostCardProps';
import type { FeedEvent, NoteMetrics } from './feedTypes';
import { PostCard } from './PostCard';

type PostCardProps = React.ComponentProps<typeof PostCard>;

/** What the card reads for itself, and the handlers it binds to its note. */
type EngagementProps =
  | 'metrics'
  | 'liked'
  | 'replied'
  | 'reposted'
  | 'zapped'
  | 'likePending'
  | 'repostPending'
  | 'zapPending'
  | 'likePendingDirection'
  | 'repostPendingDirection'
  | 'onLikePress'
  | 'onRepostPress'
  | 'onZapPress'
  | 'onMorePress';

type LivePostCardProps = Omit<PostCardProps, EngagementProps> & {
  /** The surface's own counts, shown until the shared cache has the note. */
  fallbackMetrics: NoteMetrics;
  onLike: (event: FeedEvent) => void;
  onRepost: (event: FeedEvent) => void;
  /** `shownSats` is the zap total on the card when the button was pressed. */
  onZap: (event: FeedEvent, shownSats: number) => void;
  onMore: (event: FeedEvent) => void;
};

/**
 * A `PostCard` for a list that wires its own handlers. They take the note, so
 * the list passes the same functions to every row.
 */
// Memoized at the list boundary: a thread repaints its rows on every data
// arrival, and `engagementRowRenders.test` pins that one like renders one card.
export const LivePostCard = React.memo(function LivePostCard({
  fallbackMetrics,
  onLike,
  onRepost,
  onZap,
  onMore,
  ...card
}: LivePostCardProps) {
  const { event } = card;
  const { metrics, state, zap } = useNoteEngagement(event.id, fallbackMetrics);
  return (
    <PostCard
      {...card}
      metrics={metrics}
      liked={state.liked}
      replied={state.replied}
      reposted={state.reposted}
      likePending={state.likePending}
      repostPending={state.repostPending}
      likePendingDirection={state.likePendingDirection}
      repostPendingDirection={state.repostPendingDirection}
      zapped={zap.zapped}
      zapPending={zap.zapPending}
      onLikePress={() => onLike(event)}
      onRepostPress={() => onRepost(event)}
      onZapPress={() => onZap(event, metrics.satsZapped)}
      onMorePress={() => onMore(event)}
    />
  );
});

type FeedCardPresentation = Pick<
  PostCardProps,
  'variant' | 'getThreadContext' | 'showFooterBorder' | 'showLineAbove' | 'showLineBelow'
>;

type FeedPostCardProps = FeedCardPresentation & {
  row: FeedRow;
  index: number;
  event: FeedEvent;
  /** The surface's own counts for `event`, shown until the shared cache has the note. */
  fallbackMetrics: NoteMetrics;
  /** The surface's card wiring (`useFeedCardProps`). */
  cardProps: ReturnType<typeof createFeedPostCardProps>;
};

/** A `PostCard` inside a feed row, wired by the feed's shared card props. */
export function FeedPostCard({
  row,
  index,
  event,
  fallbackMetrics,
  cardProps,
  ...presentation
}: FeedPostCardProps) {
  const { metrics, state } = useNoteEngagement(event.id, fallbackMetrics);
  // `cardProps` reads the note's zap state from the store as it is called; the
  // subscription above is what re-runs it when that state changes.
  return <PostCard {...presentation} {...cardProps(row, index, event, metrics, state)} />;
}
