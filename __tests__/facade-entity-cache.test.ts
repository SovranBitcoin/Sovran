import { describe, it, expect, vi } from 'vitest';
import { createNormalizingStore } from '../src/facade/cache/store';
import { createNostrEntityCache } from '../src/facade/cache/entity-cache';
import type { NaggFeedEvent } from '../src/map/feed';

type Row = { a?: string; b?: string; n?: number };

describe('NormalizingStore', () => {
  it('field-level merge never clobbers omitted fields', () => {
    const store = createNormalizingStore<Row>({ maxEntries: 10 });
    store.set('k', { a: 'one' });
    store.set('k', { b: 'two' });
    expect(store.get('k')).toEqual({ a: 'one', b: 'two' });
    // An explicit value overwrites; an absent field is preserved.
    store.set('k', { a: 'ONE' });
    expect(store.get('k')).toEqual({ a: 'ONE', b: 'two' });
  });

  it('undefined fields in a patch do not erase stored values', () => {
    const store = createNormalizingStore<Row>({ maxEntries: 10 });
    store.set('k', { a: 'one', b: 'two' });
    store.set('k', { a: undefined, n: 3 });
    expect(store.get('k')).toEqual({ a: 'one', b: 'two', n: 3 });
  });

  it('evicts the least-recently-touched entry over the cap', () => {
    const store = createNormalizingStore<Row>({ maxEntries: 2 });
    store.set('x', { a: '1' });
    store.set('y', { a: '2' });
    store.get('x'); // touch x so y is now the LRU
    store.set('z', { a: '3' }); // pushes over cap -> evict y
    expect(store.has('x')).toBe(true);
    expect(store.has('y')).toBe(false);
    expect(store.has('z')).toBe(true);
    expect(store.size).toBe(2);
  });

  it('setMany notifies subscribers exactly once', () => {
    const store = createNormalizingStore<Row>({ maxEntries: 10 });
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    store.setMany([
      ['a', { a: '1' }],
      ['b', { a: '2' }],
      ['c', { a: '3' }],
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    store.set('d', { a: '4' });
    expect(listener).toHaveBeenCalledTimes(1); // unsubscribed
  });

  it('getMany is index-aligned with undefined gaps', () => {
    const store = createNormalizingStore<Row>({ maxEntries: 10 });
    store.set('a', { a: '1' });
    expect(store.getMany(['a', 'missing'])).toEqual([{ a: '1' }, undefined]);
  });
});

describe('NostrEntityCache profile merge (monotonic guard)', () => {
  it('a low-confidence seed fills gaps but never overwrites a fresher field', () => {
    const cache = createNostrEntityCache();
    // Fresh full fetch first.
    cache.ingestProfileMetadata({ pk: { name: 'Alice', about: 'real bio' } }, 100);
    // A later feed seed (seenAt 0) carries a stale name + a picture we lack.
    cache.ingestProfileInfos({ pk: { name: 'stale', picture: 'pic.png' } });
    const p = cache.getProfile('pk');
    expect(p?.name).toBe('Alice'); // fresher fetch wins
    expect(p?.about).toBe('real bio'); // preserved
    expect(p?.picture).toBe('pic.png'); // gap filled by the seed
    expect(p?.seenAt).toBe(100); // freshness retained
  });

  it('a newer fetch overwrites an older one', () => {
    const cache = createNostrEntityCache();
    cache.ingestProfileMetadata({ pk: { name: 'old' } }, 100);
    cache.ingestProfileMetadata({ pk: { name: 'new' } }, 200);
    expect(cache.getProfile('pk')?.name).toBe('new');
    expect(cache.getProfile('pk')?.seenAt).toBe(200);
  });

  it('readProfiles splits cached from missing', () => {
    const cache = createNostrEntityCache();
    cache.ingestProfileInfos({ a: { name: 'A' } });
    const { profiles, missing } = cache.readProfiles(['a', 'b']);
    expect(Object.keys(profiles)).toEqual(['a']);
    expect(missing).toEqual(['b']);
  });
});

describe('NostrEntityCache notes + stats + clear', () => {
  const note: NaggFeedEvent = {
    id: 'n1',
    kind: 1,
    pubkey: 'pk',
    content: 'hello',
    tags: [],
    created_at: 50,
  };

  it('notes are immutable once cached', () => {
    const cache = createNostrEntityCache();
    cache.ingestNotes([note]);
    cache.ingestNotes([{ ...note, content: 'tampered' }]);
    expect(cache.getNote('n1')?.content).toBe('hello');
  });

  it('caches note stats and clears all stores on profile switch', () => {
    const cache = createNostrEntityCache();
    cache.ingestNotes([note]);
    cache.ingestNoteStats({ n1: { likes: 3, reposts: 1, replies: 2, zaps: 0, satsZapped: 0 } });
    expect(cache.getNoteStats('n1')?.likes).toBe(3);
    cache.clear();
    expect(cache.getNote('n1')).toBeUndefined();
    expect(cache.getNoteStats('n1')).toBeUndefined();
    expect(cache.getProfile('pk')).toBeUndefined();
  });
});
