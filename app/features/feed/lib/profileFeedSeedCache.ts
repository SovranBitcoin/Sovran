/**
 * @fileoverview Profile-feed seed cache
 *
 * Transient nav hand-over, like `threadSeedCache`: when the user taps an author
 * from a feed or thread, the calling card writes the author's notes it already
 * has on screen (plus the profile/metrics/quoted maps) keyed by pubkey. The
 * profile screen paints those rows on its first frame as a partial page while
 * the network fetch replaces them with the full, ordered author feed.
 *
 * Module-level Map, FIFO eviction at a low cap, peeked (not consumed) on read so
 * a StrictMode double render cannot lose it; the network page supersedes it.
 */
import type { FeedItem } from '@/features/feed/components/nostr/feedTypes';
import { emptyFeedParseResult, type FeedParseResult } from '@/features/feed/data/feedClient';
import type { ThreadSeed } from '@/features/feed/lib/threadSeedCache';

const MAX_ENTRIES = 20;
const cache = new Map<string, FeedParseResult>();

/**
 * Build and store the seed from what a card already has: the author's own
 * kind-1 notes in the context, newest first. Nothing is stored when the context
 * holds no note by the author (a seed with no rows would only paint a skeleton).
 */
export function seedProfileFeed(pubkey: string, context: ThreadSeed | null | undefined): void {
  if (!pubkey || !context) return;
  const notes = [...context.allEvents.values()]
    .filter((event) => event.pubkey === pubkey && event.kind === 1)
    .sort((a, b) => b.created_at - a.created_at);
  if (notes.length === 0) return;
  const items: FeedItem[] = notes.map((event) => ({
    type: 'note',
    event,
    timestamp: event.created_at,
  }));
  const seed: FeedParseResult = {
    ...emptyFeedParseResult(),
    orderedFeedItems: items,
    metricsMap: new Map(context.metrics),
    profilesMap: new Map(context.profiles),
    quotedEventsMap: new Map(context.quotedEvents),
    // A seed is a partial page: never paginate from it.
    paginationUntil: 0,
    hasMore: undefined,
  };
  if (cache.has(pubkey)) cache.delete(pubkey);
  cache.set(pubkey, seed);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Pure read; the network page supersedes the seed, so it is never consumed. */
export function peekProfileFeedSeed(pubkey: string | undefined): FeedParseResult | undefined {
  return pubkey ? cache.get(pubkey) : undefined;
}
