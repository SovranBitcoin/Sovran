import type { FeedItem, FeedEvent, NoteMetrics } from './feedTypes';
import type { FeedRow } from '@/features/feed/lib/feedRows';

type RepostCardDependencies = {
  getMetrics: (id: string) => NoteMetrics;
  getZapState: (id: string) => { zapped: boolean; zapPending: boolean };
  onOverlayOpenedFromIndex: (index: number) => void;
  toggleLike: (event: FeedEvent) => void;
  toggleRepost: (event: FeedEvent) => void;
  openZapMenu: (event: FeedEvent, baseSats: number) => void;
  /**
   * Reposter identity to show when the row carries none. A profile feed knows
   * whose page it is; an algorithmic feed only knows the repost event's author.
   */
  fallbackReposter: { name: string; pubkey?: string };
};

const NO_ZAP_STATE = Object.freeze({ zapped: false, zapPending: false });

/**
 * Builds the shared `RepostCard` wiring for a repost row. Presentation props
 * such as animation, borders, thread context, and the "more" action stay at the
 * render site. Engagement handlers are omitted when the original event never
 * resolved — there is nothing to like, repost, or zap.
 */
export function createRepostCardProps(dependencies: RepostCardDependencies) {
  return (row: FeedRow, index: number, item: Extract<FeedItem, { type: 'repost' }>) => {
    const originalEvent = item.originalEvent;
    const engagement = row.engagement;
    const zapState = originalEvent ? dependencies.getZapState(originalEvent.id) : NO_ZAP_STATE;
    return {
      repostEvent: item.repostEvent,
      originalEvent,
      originalMetrics: row.metrics,
      index,
      feedIndex: index,
      onOverlayOpenedFromIndex: dependencies.onOverlayOpenedFromIndex,
      quotedEvents: row.quotedEvents,
      profiles: row.profiles,
      getMetrics: dependencies.getMetrics,
      reposterName: row.reposterName ?? dependencies.fallbackReposter.name,
      reposterPubkey:
        row.reposterPubkey ?? dependencies.fallbackReposter.pubkey ?? item.repostEvent.pubkey,
      reposters: row.reposters,
      liked: engagement.liked,
      replied: engagement.replied,
      reposted: engagement.reposted,
      likePending: engagement.likePending,
      repostPending: engagement.repostPending,
      likePendingDirection: engagement.likePendingDirection,
      repostPendingDirection: engagement.repostPendingDirection,
      zapped: zapState.zapped,
      zapPending: zapState.zapPending,
      onLikePress: originalEvent ? () => dependencies.toggleLike(originalEvent) : undefined,
      onRepostPress: originalEvent ? () => dependencies.toggleRepost(originalEvent) : undefined,
      onZapPress: originalEvent
        ? () => dependencies.openZapMenu(originalEvent, row.metrics.satsZapped)
        : undefined,
    };
  };
}
