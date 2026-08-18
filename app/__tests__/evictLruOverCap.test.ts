/**
 * The single LRU-trim policy now shared by the mempool, mint-metadata,
 * relay-metadata and query caches. Pins the two properties the four copies
 * used to state separately: oldest-first order, and "never leaves the map over
 * cap" even when a bulk write overshoots by more than one batch.
 */
import { evictLruOverCap } from '@/shared/lib/cache/evictLruOverCap';

const mapOf = (count: number, from = 0): Record<string, { at: number }> =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${from + i}`, { at: from + i }]));

const at = (entry: { at: number }): number => entry.at;

describe('evictLruOverCap', () => {
  it('returns null and touches nothing at or under cap', () => {
    const byKey = mapOf(100);
    expect(evictLruOverCap(byKey, 100, at)).toBeNull();
    expect(Object.keys(byKey)).toHaveLength(100);
  });

  it('trims a 10% batch and drops the least-recently-touched first', () => {
    const byKey = mapOf(101);
    expect(evictLruOverCap(byKey, 100, at)).toEqual({ evicted: 10, remaining: 91 });
    expect(byKey.k0).toBeUndefined();
    expect(byKey.k9).toBeUndefined();
    expect(byKey.k10).toBeDefined();
    expect(byKey.k100).toBeDefined();
  });

  it('evicts the whole overflow when a bulk write overshoots the batch', () => {
    const byKey = mapOf(400);
    expect(evictLruOverCap(byKey, 100, at)).toEqual({ evicted: 300, remaining: 100 });
    expect(Object.keys(byKey)).toHaveLength(100);
  });
});
