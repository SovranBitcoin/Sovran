import type { EngagementViewState } from '@/features/feed/hooks/useNostrEngagement';
import type { FeedRow } from '@/features/feed/lib/feedRows';
import type { FeedEvent, NoteMetrics } from './feedTypes';

type FeedPostCardDependencies = {
  getMetrics: (id: string) => NoteMetrics;
  getZapState: (id: string) => { zapped: boolean; zapPending: boolean };
  onOverlayOpenedFromIndex: (index: number) => void;
  toggleLike: (event: FeedEvent) => void;
  toggleRepost: (event: FeedEvent) => void;
  openZapMenu: (event: FeedEvent, baseSats: number) => void;
  openPostActions: (event: FeedEvent) => void;
};

type FeedPostCardRow = Pick<FeedRow, 'profiles' | 'quotedEvents'>;

/**
 * Builds the shared `PostCard` wiring for a post rendered inside a feed row.
 * Presentation props such as variant, borders, animation, and thread context
 * stay at the render site.
 */
export function createFeedPostCardProps(dependencies: FeedPostCardDependencies) {
  return (
    row: FeedPostCardRow,
    index: number,
    event: FeedEvent,
    metrics: NoteMetrics,
    viewerState: EngagementViewState
  ) => {
    const zapState = dependencies.getZapState(event.id);
    return {
      event,
      metrics,
      index,
      feedIndex: index,
      onOverlayOpenedFromIndex: dependencies.onOverlayOpenedFromIndex,
      quotedEvents: row.quotedEvents,
      profiles: row.profiles,
      getMetrics: dependencies.getMetrics,
      liked: viewerState.liked,
      replied: viewerState.replied,
      reposted: viewerState.reposted,
      likePending: viewerState.likePending,
      repostPending: viewerState.repostPending,
      likePendingDirection: viewerState.likePendingDirection,
      repostPendingDirection: viewerState.repostPendingDirection,
      zapped: zapState.zapped,
      zapPending: zapState.zapPending,
      onLikePress: () => dependencies.toggleLike(event),
      onMorePress: () => dependencies.openPostActions(event),
      onRepostPress: () => dependencies.toggleRepost(event),
      onZapPress: () => dependencies.openZapMenu(event, metrics.satsZapped),
    };
  };
}
