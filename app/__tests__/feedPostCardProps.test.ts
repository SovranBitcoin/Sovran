/** @jest-environment node */

import { createFeedPostCardProps } from '@/features/feed/components/nostr/feedPostCardProps';
import type {
  FeedEvent,
  NoteMetrics,
  ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';
import type { EngagementViewState } from '@/features/feed/hooks/useNostrEngagement';

describe('feed post card props', () => {
  it('maps row and viewer state while preserving deferred post actions', () => {
    const event: FeedEvent = {
      id: 'e'.repeat(64),
      kind: 1,
      pubkey: 'p'.repeat(64),
      content: 'hello',
      tags: [],
      created_at: 1,
    };
    const metrics: NoteMetrics = {
      replyCount: 2,
      repostCount: 3,
      likeCount: 4,
      satsZapped: 21,
    };
    const viewerState: EngagementViewState = {
      liked: true,
      replied: false,
      reposted: true,
      likePending: true,
      repostPending: false,
      likePendingDirection: 'activating',
      repostPendingDirection: 'deactivating',
    };
    const profiles = new Map<string, ProfileInfo>([[event.pubkey, { name: 'Alice' }]]);
    const quotedEvents = new Map<string, FeedEvent>();
    const getMetrics = jest.fn((_id: string) => metrics);
    const getZapState = jest.fn((_id: string) => ({ zapped: true, zapPending: false }));
    const onOverlayOpenedFromIndex = jest.fn((_index: number) => undefined);
    const toggleLike = jest.fn((_event: FeedEvent) => undefined);
    const toggleRepost = jest.fn((_event: FeedEvent) => undefined);
    const openZapMenu = jest.fn((_event: FeedEvent, _baseSats: number) => undefined);
    const openPostActions = jest.fn((_event: FeedEvent) => undefined);
    const feedPostCardProps = createFeedPostCardProps({
      getMetrics,
      getZapState,
      onOverlayOpenedFromIndex,
      toggleLike,
      toggleRepost,
      openZapMenu,
      openPostActions,
    });

    const props = feedPostCardProps({ profiles, quotedEvents }, 7, event, metrics, viewerState);

    expect(props).toMatchObject({
      event,
      metrics,
      index: 7,
      feedIndex: 7,
      profiles,
      quotedEvents,
      getMetrics,
      onOverlayOpenedFromIndex,
      liked: true,
      replied: false,
      reposted: true,
      likePending: true,
      repostPending: false,
      likePendingDirection: 'activating',
      repostPendingDirection: 'deactivating',
      zapped: true,
      zapPending: false,
    });
    expect(getZapState).toHaveBeenCalledTimes(1);
    expect(getZapState).toHaveBeenCalledWith(event.id);
    expect(toggleLike).not.toHaveBeenCalled();
    expect(toggleRepost).not.toHaveBeenCalled();
    expect(openPostActions).not.toHaveBeenCalled();
    expect(openZapMenu).not.toHaveBeenCalled();

    props.onLikePress();
    props.onRepostPress();
    props.onMorePress();
    props.onZapPress();

    expect(toggleLike).toHaveBeenCalledWith(event);
    expect(toggleLike).toHaveBeenCalledTimes(1);
    expect(toggleRepost).toHaveBeenCalledWith(event);
    expect(toggleRepost).toHaveBeenCalledTimes(1);
    expect(openPostActions).toHaveBeenCalledWith(event);
    expect(openPostActions).toHaveBeenCalledTimes(1);
    expect(openZapMenu).toHaveBeenCalledWith(event, metrics.satsZapped);
    expect(openZapMenu).toHaveBeenCalledTimes(1);
  });
});
