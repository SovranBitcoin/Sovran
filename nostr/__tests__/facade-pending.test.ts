import { describe, it, expect, vi } from 'vitest';
import { createPendingSet } from '../src/facade/cache/pending';

describe('PendingSet (reference-counted in-flight tracker)', () => {
  it('reports has() true between begin and end', () => {
    const pending = createPendingSet();
    expect(pending.has('a')).toBe(false);
    pending.begin(['a']);
    expect(pending.has('a')).toBe(true);
    pending.end(['a']);
    expect(pending.has('a')).toBe(false);
  });

  it('an early-settling read cannot clear a key a second read still holds', () => {
    const pending = createPendingSet();
    pending.begin(['a']); // read 1
    pending.begin(['a']); // read 2 (overlapping)
    pending.end(['a']); // read 1 settles
    expect(pending.has('a')).toBe(true); // still loading — read 2 holds it
    pending.end(['a']); // read 2 settles
    expect(pending.has('a')).toBe(false);
  });

  it('notifies per-key only on idle↔loading transitions', () => {
    const pending = createPendingSet();
    const onA = vi.fn();
    pending.subscribeKey('a', onA);
    pending.begin(['a']); // idle → loading: fires
    expect(onA).toHaveBeenCalledTimes(1);
    pending.begin(['a']); // already loading: no fire
    expect(onA).toHaveBeenCalledTimes(1);
    pending.end(['a']); // still loading (count 1): no fire
    expect(onA).toHaveBeenCalledTimes(1);
    pending.end(['a']); // loading → idle: fires
    expect(onA).toHaveBeenCalledTimes(2);
  });
});
