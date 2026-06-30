import { describe, it, expect } from 'vitest';
import { createPageBuffer, compareNewestFirst } from '../src/facade/session/page-buffer';

type Item = { id: string; createdAt: number };
const buf = () => createPageBuffer<Item>({ keyOf: (i) => ({ id: i.id, createdAt: i.createdAt }) });
const ids = (items: ReadonlyArray<Item>) => items.map((i) => i.id);

describe('compareNewestFirst', () => {
  it('orders newest first, ties broken by id descending', () => {
    expect(compareNewestFirst({ id: 'a', createdAt: 2 }, { id: 'b', createdAt: 1 })).toBeLessThan(0);
    expect(compareNewestFirst({ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 1 })).toBeGreaterThan(0);
  });
});

describe('PageBuffer', () => {
  it('seed sorts newest-first and de-dupes', () => {
    const b = buf();
    b.seed([
      { id: 'old', createdAt: 1 },
      { id: 'new', createdAt: 3 },
      { id: 'old', createdAt: 1 }, // dup
      { id: 'mid', createdAt: 2 },
    ]);
    expect(ids(b.revealed)).toEqual(['new', 'mid', 'old']);
    expect(b.newestKey()).toEqual({ id: 'new', createdAt: 3 });
    expect(b.oldestKey()).toEqual({ id: 'old', createdAt: 1 });
  });

  it('withholds only items newer than the frozen cutoff', () => {
    const b = buf();
    b.seed([{ id: 'a', createdAt: 10 }]);
    b.offerNew([
      { id: 'newer', createdAt: 20 },
      { id: 'older', createdAt: 5 }, // not newer than cutoff -> ignored
      { id: 'a', createdAt: 10 }, // already seen -> ignored
    ]);
    expect(b.pendingNew).toBe(1);
    expect(ids(b.revealed)).toEqual(['a']); // nothing injected on screen
  });

  it('revealNew merges withheld in, advances the cutoff, and clears pending', () => {
    const b = buf();
    b.seed([{ id: 'a', createdAt: 10 }]);
    b.offerNew([{ id: 'b', createdAt: 20 }]);
    expect(b.pendingNew).toBe(1);

    const revealed = b.revealNew();
    expect(ids(revealed)).toEqual(['b', 'a']);
    expect(b.pendingNew).toBe(0);

    // cutoff now at b(20): a later c(15) is below it and is NOT new.
    b.offerNew([{ id: 'c', createdAt: 15 }]);
    expect(b.pendingNew).toBe(0);
    // but d(30) above it IS new.
    b.offerNew([{ id: 'd', createdAt: 30 }]);
    expect(b.pendingNew).toBe(1);
  });

  it('appendOlder adds at the bottom without disturbing the visible top', () => {
    const b = buf();
    b.seed([
      { id: 'a', createdAt: 30 },
      { id: 'b', createdAt: 20 },
    ]);
    const topBefore = b.revealed[0];
    b.appendOlder([
      { id: 'c', createdAt: 10 },
      { id: 'b', createdAt: 20 }, // dup, ignored
    ]);
    expect(ids(b.revealed)).toEqual(['a', 'b', 'c']);
    expect(b.revealed[0]).toBe(topBefore); // same reference — no reshuffle
  });

  it('with no first page, everything offered counts as new', () => {
    const b = buf();
    b.seed([]);
    b.offerNew([{ id: 'x', createdAt: 1 }]);
    expect(b.pendingNew).toBe(1);
  });
});
