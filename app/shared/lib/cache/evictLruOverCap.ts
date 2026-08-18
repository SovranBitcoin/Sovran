/**
 * @fileoverview LRU trim for a keyed cache map.
 *
 * Four caches — mempool addresses, mint metadata, relay metadata, and every
 * `createQueryCacheStore` instance — each grew a private copy of this policy,
 * and the copies had already drifted on the batch formula. One definition, so
 * "how a Sovran cache sheds entries" is decided in one place.
 *
 * Trims `byKey` in place. Evicts at least the overflow so a bulk write can't
 * leave the map permanently over cap, rounded up to a 10% batch so steady-state
 * single-entry writes don't re-sort and trim one at a time at the boundary.
 *
 * Returns `null` when the map is at or under cap, so callers log only on a real
 * eviction — each cache keeps its own event name, level and payload.
 */
export function evictLruOverCap<T>(
  byKey: Record<string, T>,
  maxEntries: number,
  lastTouchedAt: (entry: T) => number
): { evicted: number; remaining: number } | null {
  const keys = Object.keys(byKey);
  if (keys.length <= maxEntries) return null;
  const overflow = keys.length - maxEntries;
  const evictCount = Math.max(overflow, Math.floor(maxEntries * 0.1));
  keys.sort((a, b) => lastTouchedAt(byKey[a]) - lastTouchedAt(byKey[b]));
  for (let i = 0; i < evictCount; i++) delete byKey[keys[i]];
  return { evicted: evictCount, remaining: Object.keys(byKey).length };
}
