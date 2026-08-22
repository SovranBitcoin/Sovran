/** @jest-environment node */

import { createRepostCardProps } from '@/features/feed/components/nostr/repostCardProps';
import type {
  FeedEvent,
  FeedItem,
  NoteMetrics,
  ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';
import type { FeedRow } from '@/features/feed/lib/feedRows';
import type { EngagementViewState } from '@/features/feed/hooks/useNostrEngagement';

const METRICS: NoteMetrics = { replyCount: 1, repostCount: 2, likeCount: 3, satsZapped: 210 };

const ENGAGEMENT: EngagementViewState = {
  liked: true,
  replied: false,
  reposted: true,
  likePending: false,
  repostPending: true,
  likePendingDirection: 'deactivating',
  repostPendingDirection: 'activating',
};

function makeEvent(id: string, pubkey: string): FeedEvent {
  return { id, kind: 1, pubkey, content: 'gm', tags: [], created_at: 1 };
}

function makeRow(
  item: Extract<FeedItem, { type: 'repost' }>,
  overrides?: Partial<FeedRow>
): FeedRow {
  return {
    key: item.repostEvent.id,
    item,
    metrics: METRICS,
    engagement: ENGAGEMENT,
    profiles: new Map<string, ProfileInfo>(),
    quotedEvents: new Map<string, FeedEvent>(),
    ...overrides,
  };
}

function makeDependencies() {
  return {
    getMetrics: jest.fn((_id: string) => METRICS),
    getZapState: jest.fn((_id: string) => ({ zapped: true, zapPending: false })),
    onOverlayOpenedFromIndex: jest.fn((_index: number) => undefined),
    toggleLike: jest.fn((_event: FeedEvent) => undefined),
    toggleRepost: jest.fn((_event: FeedEvent) => undefined),
    openZapMenu: jest.fn((_event: FeedEvent, _baseSats: number) => undefined),
  };
}

describe('repost card props', () => {
  const repostEvent = makeEvent('r'.repeat(64), 'a'.repeat(64));
  const originalEvent = makeEvent('o'.repeat(64), 'b'.repeat(64));
  const item: Extract<FeedItem, { type: 'repost' }> = {
    type: 'repost',
    repostEvent,
    originalEvent,
    originalEventId: originalEvent.id,
    timestamp: 1,
  };

  it('maps the row and defers engagement to the original event', () => {
    const dependencies = makeDependencies();
    const repostCardProps = createRepostCardProps({
      ...dependencies,
      fallbackReposter: { name: 'Fallback' },
    });

    const props = repostCardProps(makeRow(item), 4, item);

    expect(props).toMatchObject({
      repostEvent,
      originalEvent,
      originalMetrics: METRICS,
      index: 4,
      feedIndex: 4,
      reposterName: 'Fallback',
      reposterPubkey: repostEvent.pubkey,
      liked: true,
      replied: false,
      reposted: true,
      likePending: false,
      repostPending: true,
      likePendingDirection: 'deactivating',
      repostPendingDirection: 'activating',
      zapped: true,
      zapPending: false,
    });
    expect(dependencies.getZapState).toHaveBeenCalledWith(originalEvent.id);
    expect(dependencies.toggleLike).not.toHaveBeenCalled();

    props.onLikePress?.();
    props.onRepostPress?.();
    props.onZapPress?.();

    expect(dependencies.toggleLike).toHaveBeenCalledWith(originalEvent);
    expect(dependencies.toggleRepost).toHaveBeenCalledWith(originalEvent);
    expect(dependencies.openZapMenu).toHaveBeenCalledWith(originalEvent, METRICS.satsZapped);
  });

  it('prefers the row reposter over the fallback identity', () => {
    const repostCardProps = createRepostCardProps({
      ...makeDependencies(),
      fallbackReposter: { name: 'Fallback', pubkey: 'c'.repeat(64) },
    });

    const props = repostCardProps(
      makeRow(item, { reposterName: 'Alice', reposterPubkey: 'd'.repeat(64) }),
      0,
      item
    );

    expect(props.reposterName).toBe('Alice');
    expect(props.reposterPubkey).toBe('d'.repeat(64));
  });

  it('falls back to the configured pubkey and drops handlers with no original event', () => {
    const dependencies = makeDependencies();
    const orphan: Extract<FeedItem, { type: 'repost' }> = {
      ...item,
      originalEvent: undefined,
    };
    const repostCardProps = createRepostCardProps({
      ...dependencies,
      fallbackReposter: { name: 'Profile owner', pubkey: 'c'.repeat(64) },
    });

    const props = repostCardProps(makeRow(orphan), 1, orphan);

    expect(props.reposterPubkey).toBe('c'.repeat(64));
    expect(props.onLikePress).toBeUndefined();
    expect(props.onRepostPress).toBeUndefined();
    expect(props.onZapPress).toBeUndefined();
    expect(props.zapped).toBe(false);
    expect(props.zapPending).toBe(false);
    expect(dependencies.getZapState).not.toHaveBeenCalled();
  });
});
