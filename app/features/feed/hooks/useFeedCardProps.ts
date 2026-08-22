/**
 * @fileoverview Card wiring for a feed surface.
 *
 * Both card kinds a feed row can render — a post and a repost — need the same
 * engagement dependencies. This binds them once so HomeFeed and UserFeed only
 * differ in the reposter identity they fall back to.
 */

import { useMemo, type MutableRefObject } from 'react';

import { createFeedPostCardProps } from '../components/nostr/feedPostCardProps';
import { createRepostCardProps } from '../components/nostr/repostCardProps';
import type { FeedEvent, NoteMetrics } from '../components/nostr/feedTypes';

type FeedCardPropsOptions = {
  getMetrics: (id: string) => NoteMetrics;
  getZapState: (id: string) => { zapped: boolean; zapPending: boolean };
  onOverlayOpenedFromIndex: (index: number) => void;
  /** Togglers are mirrored into refs by the caller and may resolve async. */
  toggleLikeRef: MutableRefObject<(event: FeedEvent) => unknown>;
  toggleRepostRef: MutableRefObject<(event: FeedEvent) => unknown>;
  openZapMenuRef: MutableRefObject<(event: FeedEvent, baseSats: number) => void>;
  openPostActions: (event: FeedEvent) => void;
  /** @see createRepostCardProps */
  fallbackReposterName: string;
  fallbackReposterPubkey?: string;
};

export function useFeedCardProps({
  getMetrics,
  getZapState,
  onOverlayOpenedFromIndex,
  toggleLikeRef,
  toggleRepostRef,
  openZapMenuRef,
  openPostActions,
  fallbackReposterName,
  fallbackReposterPubkey,
}: FeedCardPropsOptions) {
  const feedPostCardProps = useMemo(
    () =>
      createFeedPostCardProps({
        getMetrics,
        getZapState,
        onOverlayOpenedFromIndex,
        toggleLike: (event: FeedEvent) => void toggleLikeRef.current(event),
        toggleRepost: (event: FeedEvent) => void toggleRepostRef.current(event),
        openZapMenu: (event: FeedEvent, baseSats: number) =>
          openZapMenuRef.current(event, baseSats),
        openPostActions,
      }),
    [
      getMetrics,
      getZapState,
      onOverlayOpenedFromIndex,
      openPostActions,
      openZapMenuRef,
      toggleLikeRef,
      toggleRepostRef,
    ]
  );

  const repostCardProps = useMemo(
    () =>
      createRepostCardProps({
        getMetrics,
        getZapState,
        onOverlayOpenedFromIndex,
        toggleLike: (event: FeedEvent) => void toggleLikeRef.current(event),
        toggleRepost: (event: FeedEvent) => void toggleRepostRef.current(event),
        openZapMenu: (event: FeedEvent, baseSats: number) =>
          openZapMenuRef.current(event, baseSats),
        fallbackReposter: { name: fallbackReposterName, pubkey: fallbackReposterPubkey },
      }),
    [
      getMetrics,
      getZapState,
      onOverlayOpenedFromIndex,
      openZapMenuRef,
      toggleLikeRef,
      toggleRepostRef,
      fallbackReposterName,
      fallbackReposterPubkey,
    ]
  );

  return { feedPostCardProps, repostCardProps };
}
