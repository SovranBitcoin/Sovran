/**
 * @fileoverview Builds a NIP-10 reply `ComposerTarget` from the post being
 * replied to. Shared by the thread view's per-post reply action and the sticky
 * thread reply bar.
 */
import { getOwnWriteRelays } from '@/shared/lib/nostr/outbox/relayListStore';
import type { ComposerTarget } from '@/features/composer/publish/buildNoteEvent';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

/** Derives the reply target (root/reply markers + carried p-tags) for `event`. */
export function deriveReplyTarget(event: FeedEvent): ComposerTarget {
  const eTags = event.tags.filter((t) => t[0] === 'e');
  const rootTag = eTags.find((t) => t[3] === 'root') ?? eTags[0];
  const pTags = event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
  return {
    mode: 'reply',
    parentId: event.id,
    parentPubkey: event.pubkey,
    parentPTags: pTags,
    rootId: rootTag?.[1],
    relayHint: getOwnWriteRelays()[0],
  };
}
