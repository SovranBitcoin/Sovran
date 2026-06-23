import { ShortTextNote } from 'nostr-tools/kinds';

import type { FeedEvent, NoteMetrics } from '@/features/feed/components/nostr/feedTypes';
import type { ThreadResult, ThreadSeedBuckets } from '@/features/feed/data/feedClient';
import {
  buildThreadItemsFromResult,
  buildThreadItemsFromSeed,
  orderedReplyIdsForThreadResult,
} from '@/features/feed/lib/threadItems';

const EMPTY_METRICS: NoteMetrics = {
  likeCount: 0,
  repostCount: 0,
  replyCount: 0,
  satsZapped: 0,
};

function note(params: {
  id: string;
  pubkey?: string;
  content?: string;
  tags?: string[][];
  createdAt?: number;
}): FeedEvent {
  return {
    id: params.id,
    kind: ShortTextNote,
    pubkey: params.pubkey ?? 'a'.repeat(64),
    content: params.content ?? params.id,
    tags: params.tags ?? [],
    created_at: params.createdAt ?? 1700000000,
  };
}

function mapEvents(events: FeedEvent[]): Map<string, FeedEvent> {
  return new Map(events.map((event) => [event.id, event]));
}

function emptySeed(overrides: Partial<ThreadSeedBuckets> = {}): ThreadSeedBuckets {
  return {
    allEvents: new Map(),
    profiles: new Map(),
    metrics: new Map(),
    quotedEvents: new Map(),
    ...overrides,
  };
}

describe('thread item builders', () => {
  it('renders direct replies already present in a thread seed', () => {
    const root = note({ id: 'root', content: 'root post', createdAt: 100 });
    const seededReply = note({
      id: 'seeded-reply',
      content: 'reply already loaded by the feed',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 101,
    });
    const quoteOnly = note({
      id: 'quote-only',
      tags: [['e', 'root', '', 'mention']],
      createdAt: 102,
    });

    const built = buildThreadItemsFromSeed(
      'root',
      emptySeed({
        allEvents: mapEvents([root, seededReply, quoteOnly]),
        metrics: new Map([['root', { ...EMPTY_METRICS, replyCount: 3 }]]),
      })
    );

    expect(built?.items.map((item) => `${item.type}:${item.event.id}`)).toEqual([
      'target:root',
      'reply:seeded-reply',
    ]);
    expect(built?.hiddenReplyCount).toBe(2);
    expect(built?.expectedReplies).toBe(3);
    expect(built?.receivedReplies).toBe(1);
  });

  it('uses preview reply ids from the feed seed as the initial reply order', () => {
    const root = note({ id: 'root', content: 'root post', createdAt: 100 });
    const firstPreviewReply = note({
      id: 'first-preview',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 103,
    });
    const secondPreviewReply = note({
      id: 'second-preview',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 101,
    });

    const built = buildThreadItemsFromSeed(
      'root',
      emptySeed({
        allEvents: mapEvents([root, firstPreviewReply, secondPreviewReply]),
        replyPreviewEventIds: ['first-preview', 'second-preview'],
      })
    );

    expect(
      built?.items.filter((item) => item.type === 'reply').map((item) => item.event.id)
    ).toEqual(['first-preview', 'second-preview']);
  });

  it('renders nested preview replies already shown by the feed seed', () => {
    const root = note({ id: 'root', content: 'root post', createdAt: 100, pubkey: 'alice' });
    const authorReply = note({
      id: 'author-reply',
      pubkey: 'alice',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 101,
    });
    const followedTail = note({
      id: 'followed-tail',
      pubkey: 'carol',
      tags: [
        ['e', 'root', '', 'root'],
        ['e', 'author-reply', '', 'reply'],
      ],
      createdAt: 102,
    });

    const built = buildThreadItemsFromSeed(
      'root',
      emptySeed({
        allEvents: mapEvents([root, authorReply, followedTail]),
        replyPreviewEventIds: ['author-reply', 'followed-tail'],
      })
    );

    expect(
      built?.items.filter((item) => item.type === 'reply').map((item) => item.event.id)
    ).toEqual(['author-reply', 'followed-tail']);
  });

  it('does not duplicate a seeded reply when the GraphQL page returns it again', () => {
    const root = note({ id: 'root', content: 'root post', createdAt: 100 });
    const seededReply = note({
      id: 'seeded-reply',
      content: 'reply already loaded by the feed',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 101,
    });
    const nextReply = note({
      id: 'next-reply',
      content: 'reply from the first GraphQL page',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 102,
    });
    const result: ThreadResult = {
      allEvents: mapEvents([root, seededReply, nextReply]),
      profiles: new Map(),
      metrics: new Map([['root', { ...EMPTY_METRICS, replyCount: 2 }]]),
      quotedEvents: new Map(),
      thread: {
        parents: [],
        target: root,
        replies: [seededReply, nextReply],
      },
      replyPageEventIds: ['seeded-reply', 'next-reply'],
      replyPageSize: 10,
      loadedReplyCount: 2,
      hasMoreReplies: false,
    };

    const orderedIds = orderedReplyIdsForThreadResult(result, 'more', ['seeded-reply']);
    const built = buildThreadItemsFromResult('root', result, orderedIds);

    expect(orderedIds).toEqual(['seeded-reply', 'next-reply']);
    expect(
      built?.items.filter((item) => item.type === 'reply').map((item) => item.event.id)
    ).toEqual(['seeded-reply', 'next-reply']);
  });

  it('initial fetch keeps the seeded reply order as a stable prefix (no reshuffle)', () => {
    const root = note({ id: 'root', content: 'root', tags: [], createdAt: 100 });
    const seededReply = note({
      id: 'seeded-reply', content: 'seeded', tags: [['e', 'root', '', 'reply']], createdAt: 101,
    });
    const rankedFirst = note({
      id: 'ranked-first', content: 'ranked higher by the server', tags: [['e', 'root', '', 'reply']], createdAt: 102,
    });
    const result: ThreadResult = {
      allEvents: mapEvents([root, seededReply, rankedFirst]),
      profiles: new Map(),
      metrics: new Map(),
      quotedEvents: new Map(),
      thread: { parents: [], target: root, replies: [seededReply, rankedFirst] },
      // The server ranks rankedFirst ABOVE the already-on-screen seeded reply.
      replyPageEventIds: ['ranked-first', 'seeded-reply'],
      replyPageSize: 10,
      loadedReplyCount: 2,
      hasMoreReplies: false,
    };

    // The seeded reply (already painted) stays first; the ranked delta appends.
    const orderedIds = orderedReplyIdsForThreadResult(result, 'initial', ['seeded-reply']);
    expect(orderedIds).toEqual(['seeded-reply', 'ranked-first']);

    // With no seed, the server order is used as-is.
    const cold = orderedReplyIdsForThreadResult(result, 'initial', []);
    expect(cold).toEqual(['ranked-first', 'seeded-reply']);
  });
});
