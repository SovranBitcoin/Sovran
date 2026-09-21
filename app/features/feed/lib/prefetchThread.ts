/**
 * @fileoverview Thread prefetch — the fetch half of the thread hand-off.
 *
 * `threadSeedCache` serves surfaces that already HOLD the event they link to:
 * they hand the snapshot over and `useThread` paints from it. A surface that
 * holds only an event id has nothing to hand over — the transaction detail's
 * zapped-post card persists the post's id and a text preview in its annotation,
 * never the note — so tapping it opened the thread on skeletons and fetched
 * from scratch.
 *
 * This warms the shared entity cache instead: one thread read, ingested by the
 * data layer, so `useThread`'s `cachedThreadSeed` finds the note plus its
 * ancestors, author profiles and counts, and paints on the first frame.
 *
 * Deduped per data-layer instance. That instance is rebuilt (and its cache
 * dropped) on profile switch, so an attempt never carries across identities,
 * and a warm note is skipped entirely.
 */

import { getFeedClient } from '@/features/feed/data/useFeedClient';
import { readIsUnavailable } from '@/features/feed/data/feedClient';
import { feedLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';

/** Note ids prefetched, or in flight, for one data-layer instance. */
const attempted = new WeakMap<object, Set<string>>();

function attemptedFor(layer: object): Set<string> {
  let ids = attempted.get(layer);
  if (!ids) {
    ids = new Set();
    attempted.set(layer, ids);
  }
  return ids;
}

/**
 * Warm one note's thread in the entity cache. Never throws and never reports:
 * the outcome is the cache, and a thread that no tier could serve is simply
 * fetched again by the screen that opens it.
 */
export async function prefetchThread(eventId: string): Promise<void> {
  if (!eventId) return;
  const layer = buildNostrDataLayer();
  if (!layer) return;
  // Already cached — `readThread` will project a first frame without us.
  if (layer.readThread(eventId).root) return;
  const ids = attemptedFor(layer);
  if (ids.has(eventId)) return;
  ids.add(eventId);

  const client = getFeedClient();
  try {
    const result = await client.getThread({ eventId });
    if (readIsUnavailable(result.read)) {
      // Every tier was exhausted; let a later visit try again.
      ids.delete(eventId);
    }
    feedLog.info('thread.prefetch.done', {
      eventId,
      tier: result.tier,
      events: result.allEvents.size,
    });
  } catch (error) {
    ids.delete(eventId);
    feedLog.warn('thread.prefetch.failed', {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    client.dispose?.();
  }
}
