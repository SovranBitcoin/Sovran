import { describe, expect, test } from 'vitest';
import { mapNaggFeedPage, type NaggFeedEvent } from '../src/map';

function event(overrides: Partial<NaggFeedEvent> = {}): NaggFeedEvent {
  return {
    id: 'event-a',
    kind: 1,
    pubkey: 'alice',
    content: 'hello',
    tags: [],
    created_at: 100,
    ...overrides,
  };
}

describe('feed mapper', () => {
  test('collapses multiple reposts of the same original', () => {
    const original = event({ id: 'root', pubkey: 'carol' });
    const repostA = event({
      id: 'repost-a',
      kind: 6,
      pubkey: 'alice',
      content: '',
      tags: [['e', original.id]],
      created_at: 110,
    });
    const repostB = event({
      id: 'repost-b',
      kind: 6,
      pubkey: 'bob',
      content: '',
      tags: [['e', original.id]],
      created_at: 109,
    });

    const mapped = mapNaggFeedPage({
      items: [
        { type: 'repost', repostEvent: repostA, originalEvent: original },
        { type: 'repost', repostEvent: repostB, originalEvent: original },
      ],
      metrics: {},
      profiles: {},
      quoted: {},
      paginationUntil: 109,
      paginationOffset: 2,
    });

    expect(mapped.orderedFeedItems).toHaveLength(1);
    expect(mapped.orderedFeedItems[0]).toMatchObject({
      type: 'repost',
      originalEventId: original.id,
      reposters: [
        { pubkey: 'alice', event: expect.objectContaining({ id: 'repost-a' }) },
        { pubkey: 'bob', event: expect.objectContaining({ id: 'repost-b' }) },
      ],
    });
  });
});
