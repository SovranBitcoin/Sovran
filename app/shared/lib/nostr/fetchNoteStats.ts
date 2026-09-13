/**
 * Note-stats backfill: ask the facade for engagement counts on note ids a
 * page did not carry, in bounded batches, once per id per session run. The
 * answers land in the entity cache (the single owner) under each tier's
 * rank; rows read them through `useNoteStats` and paint as they arrive.
 */
import { facade } from 'nostr';
import type { NostrTier, NoteStats } from '@sovranbitcoin/schemas';

import type { NoteMetrics } from '@/features/feed/components/nostr/feedTypes';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { newReadId, readEvents, readKeyHash } from '@/shared/lib/read/readLog';

/** Ids with a backfill in flight or already attempted this layer instance. */
const attempted = new WeakMap<object, Set<string>>();

function attemptedFor(layer: object): Set<string> {
  let set = attempted.get(layer);
  if (!set) {
    set = new Set();
    attempted.set(layer, set);
  }
  return set;
}

/** NoteMetrics (the feed's shape) → the shared NoteStats contract. */
export function noteStatsFromMetrics(metrics: NoteMetrics): NoteStats {
  return {
    likes: metrics.likeCount,
    reposts: metrics.repostCount,
    replies: metrics.replyCount,
    zaps: 0,
    satsZapped: metrics.satsZapped,
  };
}

/**
 * Write a page's metrics into the entity cache so every row binding (this
 * surface and any other showing the same note) sees them, tagged by the tier
 * that served the page.
 */
export function ingestFeedMetrics(
  metrics: ReadonlyMap<string, NoteMetrics>,
  source: NostrTier
): void {
  if (metrics.size === 0) return;
  const cache = buildNostrDataLayer()?.cache;
  if (!cache) return;
  const stats: Record<string, NoteStats> = {};
  for (const [id, m] of metrics) stats[id] = noteStatsFromMetrics(m);
  cache.ingestNoteStats(stats, source);
}

/**
 * Fetch counts for the ids the cache does not hold yet (bounded, deduped).
 * Never throws; the read's outcome is in the log and the cache.
 */
export async function backfillNoteStats(ids: readonly string[]): Promise<void> {
  const layer = buildNostrDataLayer();
  if (!layer) return;
  const seen = attemptedFor(layer);
  const missing = ids.filter((id) => id && !layer.cache.getNoteStats(id) && !seen.has(id));
  if (missing.length === 0) return;
  for (const id of missing) seen.add(id);
  await Promise.all(
    facade.noteStatsBatches(missing).map(async (batch) => {
      const readId = newReadId('noteStats');
      const keyHash = readKeyHash(batch.join(','));
      const t0 = Date.now();
      readEvents.request({
        readId,
        surface: 'noteStats',
        keyHash,
        mode: 'initial',
        trigger: 'mount',
        action: 'fetch',
        strategy: 'aggregate',
        cached: false,
        stale: false,
        coldStart: true,
        gen: 0,
      });
      const result = await layer.getNoteStats({ ids: batch, readId });
      result.match(
        (resolved) =>
          readEvents.done({
            readId,
            surface: 'noteStats',
            keyHash,
            gen: 0,
            durationMs: Date.now() - t0,
            source: 'network',
            tier: resolved.tier,
            sources: resolved.provenance?.sources,
            count: Object.keys(resolved.stats).length,
            empty: Object.keys(resolved.stats).length === 0,
            degraded: resolved.provenance?.degraded ?? false,
            complete: resolved.provenance?.complete ?? true,
          }),
        (error) => {
          // Let a later page retry ids no tier could count.
          for (const id of batch) seen.delete(id);
          readEvents.failed({
            readId,
            surface: 'noteStats',
            keyHash,
            gen: 0,
            durationMs: Date.now() - t0,
            errorType: error.type,
            retained: false,
            attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
          });
        }
      );
    })
  );
}
