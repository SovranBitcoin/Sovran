/**
 * @fileoverview Thread seed cache
 *
 * Transient nav-handoff store. When the user taps a post (in the Feed, a
 * thread, or a profile feed), the calling site writes a snapshot of the data
 * it already has — the event itself, its visible parent chain, and the
 * profile/metrics/quoted-event maps — keyed by the tapped event id. `useThread`
 * consumes that snapshot on mount to render the post immediately while the
 * network fetch fills in replies.
 *
 * Module-level Map (not Zustand): purely transient, no UI subscriptions, FIFO
 * eviction at a low cap. `consumeThreadSeed` deletes on read so stale snapshots
 * don't leak into future re-opens of the same thread.
 */

import type {
  FeedEvent,
  NoteMetrics,
  ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';

export type ThreadSeed = {
  allEvents: Map<string, FeedEvent>;
  profiles: Map<string, ProfileInfo>;
  metrics: Map<string, NoteMetrics>;
  quotedEvents: Map<string, FeedEvent>;
  replyPreviewEventIds?: string[];
};

const MAX_ENTRIES = 40;
const cache = new Map<string, ThreadSeed>();

export function seedThread(eventId: string, seed: ThreadSeed): void {
  if (!eventId) return;
  if (cache.has(eventId)) cache.delete(eventId);
  cache.set(eventId, seed);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function readThreadSeed(eventId: string): ThreadSeed | undefined {
  return cache.get(eventId);
}

export function consumeThreadSeed(eventId: string): ThreadSeed | undefined {
  const seed = cache.get(eventId);
  if (seed) cache.delete(eventId);
  return seed;
}
