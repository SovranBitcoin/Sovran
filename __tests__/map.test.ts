import { describe, expect, test } from 'vitest';
import { graphqlNodesToNaggPage, mapNaggFeedPage, type NaggFeedEvent } from '../src/map';

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

describe('GraphQL mapper', () => {
  test('maps event nodes into an app-view shaped feed page', () => {
    const root = {
      id: 'root',
      kind: 1,
      pubkey: 'alice',
      content: 'root',
      tags: [],
      createdAt: 100,
      authorMetadata: [
        {
          id: 'profile-alice',
          kind: 0,
          pubkey: 'alice',
          content: JSON.stringify({ name: 'Alice' }),
          tags: [],
          createdAt: 99,
        },
      ],
      noteStats: { likes: 2, reposts: 1, replies: 3, zapSats: 4 },
    };
    const reply = {
      id: 'reply',
      kind: 1,
      pubkey: 'bob',
      content: 'reply',
      tags: [['e', root.id, '', 'reply']],
      createdAt: 90,
      rootContext: { nodes: [root] },
      authorMetadata: [
        {
          id: 'profile-bob',
          kind: 0,
          pubkey: 'bob',
          content: JSON.stringify({ display_name: 'Bob' }),
          tags: [],
          createdAt: 89,
        },
      ],
    };

    const page = graphqlNodesToNaggPage([reply]);
    const mapped = mapNaggFeedPage(page);

    expect(mapped.orderedFeedItems[0]).toMatchObject({
      type: 'note',
      event: expect.objectContaining({ id: 'reply', created_at: 90 }),
      rootEvent: expect.objectContaining({ id: 'root' }),
      rootEventId: 'root',
    });
    expect(mapped.metricsMap.get('root')).toEqual({
      likeCount: 2,
      repostCount: 1,
      replyCount: 3,
      satsZapped: 4,
    });
    expect(mapped.profilesMap.get('bob')).toEqual({ name: 'Bob' });
  });
});
