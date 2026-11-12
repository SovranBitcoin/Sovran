/**
 * The gift-wrap pagination cursor shared by the DM conversation list and a
 * single DM thread: fresh-envelope counting (the "no progress" signal that
 * stops an endless loadMore), the oldest wrap time carried ACROSS pages, and
 * the one-second overlap applied at the `until` boundary.
 */
import { createDmEnvelopeCursor } from '@/features/payments/data/dmPagination';
import type { DmEnvelope, DmEnvelopePage } from '@/features/payments/data/dmEnvelopeTypes';

function page(...envelopes: { id: string; createdAt: DmEnvelope['createdAt'] }[]): DmEnvelopePage {
  return {
    envelopes: envelopes.map(({ id, createdAt }) => ({
      id,
      pubkey: 'peer',
      kind: 1059,
      createdAt,
      content: '',
      tags: [],
    })),
    hasNextPage: false,
  };
}

describe('DM envelope cursor', () => {
  it('has no cursor until a page is tracked', () => {
    expect(createDmEnvelopeCursor().nextUntil()).toBeUndefined();
  });

  it('counts only envelopes it has not seen before', () => {
    const cursor = createDmEnvelopeCursor();
    expect(cursor.track(page({ id: 'a', createdAt: 200 }, { id: 'b', createdAt: 300 }))).toBe(2);
    expect(cursor.track(page({ id: 'b', createdAt: 300 }, { id: 'c', createdAt: 400 }))).toBe(1);
    expect(cursor.track(page({ id: 'a', createdAt: 200 }))).toBe(0);
  });

  it('keeps the oldest wrap time across pages and overlaps only the boundary second', () => {
    const cursor = createDmEnvelopeCursor();
    cursor.track(page({ id: 'a', createdAt: 500 }));
    expect(cursor.nextUntil()).toBe(500 + 1);
    // A later page holding something older must move the cursor back.
    cursor.track(page({ id: 'b', createdAt: 100 }, { id: 'c', createdAt: 900 }));
    expect(cursor.nextUntil()).toBe(100 + 1);
    // A newer-only page must not walk the cursor forwards again.
    cursor.track(page({ id: 'd', createdAt: 4000 }));
    expect(cursor.nextUntil()).toBe(100 + 1);
  });

  it('ignores an empty page', () => {
    const cursor = createDmEnvelopeCursor();
    cursor.track(page({ id: 'a', createdAt: 700 }));
    expect(cursor.track(page())).toBe(0);
    expect(cursor.nextUntil()).toBe(700 + 1);
  });

  it('reads a wrap time sent as a numeric string the same as the number', () => {
    const at = (createdAt: DmEnvelope['createdAt']) => {
      const cursor = createDmEnvelopeCursor();
      cursor.track(page({ id: 'a', createdAt }));
      return cursor.nextUntil();
    };
    expect(at('1700000000')).toBe(at(1_700_000_000));
    expect(at('1700000000000')).toBe(at(1_700_000_000_000));
    expect(at('1700000000')).toBe(1_700_000_000 + 1);
    // ISO strings still read as before.
    expect(at('2023-11-14T22:13:20.000Z')).toBe(1_700_000_000 + 1);
  });
});
