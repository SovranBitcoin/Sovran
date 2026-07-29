import { ShortTextNote } from 'nostr-tools/kinds';

import type { FeedEvent, NoteMetrics } from '@/features/feed/components/nostr/feedTypes';
import type { ThreadResult, ThreadSeedBuckets } from '@/features/feed/data/feedClient';
import {
  buildThreadItemsFromResult,
  buildThreadItemsFromSeed,
  composeThreadItems,
  orderedReplyIdsForThreadResult,
  type ThreadItem,
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

    expect(
      built?.items.map((item) =>
        item.type === 'spam-separator' ? item.type : `${item.type}:${item.event.id}`
      )
    ).toEqual(['target:root', 'reply:seeded-reply']);
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

  it('drops nested preview replies from the flat list (they belong to their own subtree)', () => {
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

    // followed-tail replies to author-reply, not the root — force-rendering it
    // flat put it under the wrong parent (the reported wrong-tree taps).
    expect(
      built?.items.filter((item) => item.type === 'reply').map((item) => item.event.id)
    ).toEqual(['author-reply']);
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
      tier: 'nagg',
      knownReplyIds: [],
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
      id: 'seeded-reply',
      content: 'seeded',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 101,
    });
    const rankedFirst = note({
      id: 'ranked-first',
      content: 'ranked higher by the server',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 102,
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
      tier: 'nagg',
      knownReplyIds: [],
    };

    // The seeded reply (already painted) stays first; the ranked delta appends.
    const orderedIds = orderedReplyIdsForThreadResult(result, 'initial', ['seeded-reply']);
    expect(orderedIds).toEqual(['seeded-reply', 'ranked-first']);

    // With no seed, the server order is used as-is.
    const cold = orderedReplyIdsForThreadResult(result, 'initial', []);
    expect(cold).toEqual(['ranked-first', 'seeded-reply']);
  });
});

describe('composeThreadItems — ignore filters + the "Might be spam" section', () => {
  const target = note({ id: 'root', pubkey: 'op' });
  const reply = note({ id: 'reply-1', pubkey: 'friend', tags: [['e', 'root', '', 'root']] });
  const ignoredReply = note({ id: 'reply-2', pubkey: 'blocked', tags: [['e', 'root', '', 'root']] });
  const built: ThreadItem[] = [
    { type: 'target', event: target },
    { type: 'reply', event: reply },
    { type: 'reply', event: ignoredReply },
  ];
  const spamA = note({ id: 'spam-1', pubkey: 'rando', tags: [['e', 'root', '', 'root']] });
  const spamIgnored = note({ id: 'spam-2', pubkey: 'blocked', tags: [['e', 'root', '', 'root']] });
  const noIgnore = { pubkeys: new Set<string>(), eventIds: new Set<string>() };

  it('appends the separator + spam cards only when the primary list is exhausted', () => {
    const withSpam = composeThreadItems(built, [spamA], noIgnore, { includeSpam: true });
    expect(withSpam.map((i) => i.type)).toEqual([
      'target',
      'reply',
      'reply',
      'spam-separator',
      'spam-reply',
    ]);
    expect(withSpam.find((i) => i.type === 'spam-separator')).toMatchObject({ count: 1 });

    const stillPaging = composeThreadItems(built, [spamA], noIgnore, { includeSpam: false });
    expect(stillPaging.some((i) => i.type === 'spam-separator')).toBe(false);
  });

  it('ignore filters drop replies AND spam, never the target', () => {
    const filtered = composeThreadItems(built, [spamA, spamIgnored], {
      pubkeys: new Set(['blocked']),
      eventIds: new Set<string>(),
    }, { includeSpam: true });
    expect(filtered.map((i) => (i.type === 'spam-separator' ? i.type : `${i.type}:${i.event.id}`))).toEqual([
      'target:root',
      'reply:reply-1',
      'spam-separator',
      'spam-reply:spam-1',
    ]);
    // Ignoring the target's author never removes the target itself.
    const opIgnored = composeThreadItems(built, [], {
      pubkeys: new Set(['op']),
      eventIds: new Set<string>(),
    }, { includeSpam: true });
    expect(opIgnored.some((i) => i.type === 'target')).toBe(true);
  });

  it('spam already acknowledged by the primary list is deduped, and an empty bucket adds no separator', () => {
    const dupSpam = note({ id: 'reply-1', pubkey: 'friend', tags: [['e', 'root', '', 'root']] });
    const composed = composeThreadItems(built, [dupSpam], noIgnore, { includeSpam: true });
    expect(composed.some((i) => i.type === 'spam-separator')).toBe(false);
  });
});
