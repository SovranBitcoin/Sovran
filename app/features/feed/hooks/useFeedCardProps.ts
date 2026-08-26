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
  // The engagement wiring both card kinds take, bound once. Memoized rather
  // than rebuilt per card kind so the two `createXCardProps` results keep the
  // identity they had when each spelled the block out: they change exactly when
  // one of these six inputs does, and card props reach a recycling list where a
  // fresh identity means a re-render of every row.
  // ast-grep-ignore: no-manual-memo-ts — list-boundary identity, see above.
  const engagement = useMemo(
    () => ({
      getMetrics,
      getZapState,
      onOverlayOpenedFromIndex,
      toggleLike: (event: FeedEvent) => void toggleLikeRef.current(event),
      toggleRepost: (event: FeedEvent) => void toggleRepostRef.current(event),
      openZapMenu: (event: FeedEvent, baseSats: number) => openZapMenuRef.current(event, baseSats),
    }),
    [
      getMetrics,
      getZapState,
      onOverlayOpenedFromIndex,
      openZapMenuRef,
      toggleLikeRef,
      toggleRepostRef,
    ]
  );

  // ast-grep-ignore: no-manual-memo-ts — list-boundary identity, see above.
  const feedPostCardProps = useMemo(
    () => createFeedPostCardProps({ ...engagement, openPostActions }),
    [engagement, openPostActions]
  );

  // ast-grep-ignore: no-manual-memo-ts — list-boundary identity, see above.
  const repostCardProps = useMemo(
    () =>
      createRepostCardProps({
        ...engagement,
        fallbackReposter: { name: fallbackReposterName, pubkey: fallbackReposterPubkey },
      }),
    [engagement, fallbackReposterName, fallbackReposterPubkey]
  );

  return { feedPostCardProps, repostCardProps };
}
