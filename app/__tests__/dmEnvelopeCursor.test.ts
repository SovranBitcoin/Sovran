/**
 * The gift-wrap pagination cursor shared by the DM conversation list and a
 * single DM thread: fresh-envelope counting (the "no progress" signal that
 * stops an endless loadMore), the oldest wrap time carried ACROSS pages, and
 * the NIP-59 slack applied exactly once at the `until` boundary.
 */
import {
  CURSOR_SLACK_SECONDS,
  createDmEnvelopeCursor,
} from '@/features/payments/data/dmPagination';
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

  it('keeps the oldest wrap time across pages and adds the slack once', () => {
    const cursor = createDmEnvelopeCursor();
    cursor.track(page({ id: 'a', createdAt: 500 }));
    expect(cursor.nextUntil()).toBe(500 + CURSOR_SLACK_SECONDS);
    // A later page holding something older must move the cursor back.
    cursor.track(page({ id: 'b', createdAt: 100 }, { id: 'c', createdAt: 900 }));
    expect(cursor.nextUntil()).toBe(100 + CURSOR_SLACK_SECONDS);
    // A newer-only page must not walk the cursor forwards again.
    cursor.track(page({ id: 'd', createdAt: 4000 }));
    expect(cursor.nextUntil()).toBe(100 + CURSOR_SLACK_SECONDS);
  });

  it('ignores an empty page', () => {
    const cursor = createDmEnvelopeCursor();
    cursor.track(page({ id: 'a', createdAt: 700 }));
    expect(cursor.track(page())).toBe(0);
    expect(cursor.nextUntil()).toBe(700 + CURSOR_SLACK_SECONDS);
  });

  it('forgets everything on reset', () => {
    const cursor = createDmEnvelopeCursor();
    cursor.track(page({ id: 'a', createdAt: 700 }));
    cursor.reset();
    expect(cursor.nextUntil()).toBeUndefined();
    expect(cursor.track(page({ id: 'a', createdAt: 700 }))).toBe(1);
  });
});
