import type { facade } from 'nostr';
import { resolvedThreadToResult } from '@/features/feed/data/facadeThreadAdapter';
import type { ThreadReplySort, ThreadRequest } from '@/features/feed/data/feedClient';

const ROOT = 'r'.repeat(64);
const A = 'a'.repeat(64); // newest, most reposts
const B = 'b'.repeat(64); // most likes
const C = 'c'.repeat(64); // most zaps, oldest

function note(id: string, createdAt: number): facade.FeedItem {
  // Replies must carry a real NIP-10 parent tag now — the adapter's stack
  // holds only direct replies of the target.
  return {
    type: 'note',
    event: {
      id,
      pubkey: 'p'.repeat(64),
      kind: 1,
      content: '',
      tags: [['e', ROOT, '', 'root']],
      created_at: createdAt,
    },
  } as unknown as facade.FeedItem;
}

function rootNote(createdAt: number): facade.FeedItem {
  return {
    type: 'note',
    event: {
      id: ROOT,
      pubkey: 'p'.repeat(64),
      kind: 1,
      content: '',
      tags: [],
      created_at: createdAt,
    },
  } as unknown as facade.FeedItem;
}

// Stats engineered so each sort yields a distinct top reply.
const STATS = {
  [A]: { likes: 1, reposts: 9, replies: 0, zaps: 0, satsZapped: 0 },
  [B]: { likes: 9, reposts: 1, replies: 0, zaps: 0, satsZapped: 100 },
  [C]: { likes: 0, reposts: 0, replies: 0, zaps: 5, satsZapped: 9000 },
};

function buildThread(overrides: Record<string, unknown> = {}): facade.ResolvedThread {
  return {
    tier: 'primal',
    root: rootNote(1000),
    parents: [],
    replies: [note(A, 300), note(B, 200), note(C, 100)],
    extras: [],
    hasMore: false,
    knownReplyIds: [A, B, C],
    stats: STATS,
    profiles: {},
    quoted: {},
    cursor: null,
    missingIds: [],
    ...overrides,
  } as unknown as facade.ResolvedThread;
}

function order(sort: ThreadReplySort): string[] {
  return resolvedThreadToResult(buildThread(), { eventId: ROOT, sort }).replyPageEventIds;
}

describe('resolvedThreadToResult reply post-sorting', () => {
  test('new → newest created_at first', () => {
    expect(order('new')).toEqual([A, B, C]);
  });
  test('likes → most likes first', () => {
    expect(order('likes')[0]).toBe(B);
  });
  test('zaps → most sats-zapped first', () => {
    expect(order('zaps')[0]).toBe(C);
  });
  test('reposts → most reposts first', () => {
    expect(order('reposts')[0]).toBe(A);
  });
  test('relevant → weighted engagement (reposts*2 + likes + replies) first', () => {
    // A: 1 + 18 = 19; B: 9 + 2 = 11; C: 0 → A wins.
    expect(order('relevant')[0]).toBe(A);
  });
  test('the target is rendered + all replies kept', () => {
    const result = resolvedThreadToResult(buildThread(), { eventId: ROOT, sort: 'new' });
    expect(result.thread.target?.id).toBe(ROOT);
    expect(result.loadedReplyCount).toBe(3);
  });
});

describe('resolvedThreadToResult — tier-aware paging contract', () => {
  const OP = '9'.repeat(64);

  function taggedNote(id: string, pubkey: string, createdAt: number): facade.FeedItem {
    return {
      type: 'note',
      event: {
        id,
        pubkey,
        kind: 1,
        content: '',
        tags: [['e', ROOT, '', 'root']],
        created_at: createdAt,
      },
    } as unknown as facade.FeedItem;
  }

  test('nagg order passes through un-post-sorted into the memory stack', () => {
    // Server ranked B before A on purpose — post-sorting would flip them.
    const thread = buildThread({
      tier: 'nagg',
      replies: [note(B, 200), note(A, 300)],
      hasMore: false,
    });
    const result = resolvedThreadToResult(thread, { eventId: ROOT, sort: 'likes', limit: 10 });
    expect(result.replyPageEventIds).toEqual([B, A]);
    expect(result.allSortedReplyIds).toEqual([B, A]);
    expect(result.hasMoreReplies).toBe(false);
    expect(result.serverHasMoreReplies).toBe(false);
    expect(result.tier).toBe('nagg');
  });

  test('nagg windows the stack to the display page size; a server continuation keeps hasMore', () => {
    const thread = buildThread({
      tier: 'nagg',
      replies: [note(B, 200), note(A, 300), note(C, 100)],
      hasMore: true, // fetch cap exceeded server-side
    });
    const result = resolvedThreadToResult(thread, { eventId: ROOT, sort: 'relevant', limit: 2 });
    expect(result.replyPageEventIds).toEqual([B, A]); // first window, server order kept
    expect(result.allSortedReplyIds).toEqual([B, A, C]); // full stack for memory paging
    expect(result.loadedReplyCount).toBe(2);
    expect(result.hasMoreReplies).toBe(true);
    expect(result.serverHasMoreReplies).toBe(true);
  });

  test('single-shot sources window locally and expose the full sorted order', () => {
    const result = resolvedThreadToResult(buildThread(), { eventId: ROOT, sort: 'new', limit: 2 });
    expect(result.replyPageEventIds).toEqual([A, B]); // window of 2 over [A,B,C]
    expect(result.hasMoreReplies).toBe(true); // C still in memory
    expect(result.allSortedReplyIds).toEqual([A, B, C]);
    expect(result.loadedReplyCount).toBe(2);
  });

  test('relevant pins the OP direct reply first on single-shot sources', () => {
    const opRoot = {
      type: 'note',
      event: { id: ROOT, pubkey: OP, kind: 1, content: '', tags: [], created_at: 1000 },
    } as unknown as facade.FeedItem;
    const thread = buildThread({
      root: opRoot,
      // OP's direct reply is oldest and least engaged — sort alone buries it.
      replies: [
        taggedNote(A, 'a'.repeat(64), 300),
        taggedNote(B, 'b'.repeat(64), 200),
        taggedNote(C, OP, 100),
      ],
    });
    const result = resolvedThreadToResult(thread, { eventId: ROOT, sort: 'relevant', limit: 10 });
    expect(result.replyPageEventIds[0]).toBe(C);
  });

  test('seed events survive the network overlay', () => {
    const seedEvent = {
      id: 's'.repeat(64),
      pubkey: OP,
      kind: 1,
      content: 'seed',
      tags: [],
      created_at: 1,
    };
    const request: ThreadRequest = {
      eventId: ROOT,
      sort: 'new',
      seed: {
        allEvents: new Map([[seedEvent.id, seedEvent]]),
        profiles: new Map(),
        metrics: new Map(),
        quotedEvents: new Map(),
      },
    };
    const result = resolvedThreadToResult(buildThread(), request);
    expect(result.allEvents.get(seedEvent.id)?.content).toBe('seed');
  });
});

describe('resolvedThreadToResult — direct-only reply enforcement (every rail)', () => {
  const NESTED = '6'.repeat(64);

  test('a nested reply in the source set never enters the stack, pages, or known window math', () => {
    const nested = {
      type: 'note',
      event: {
        id: NESTED,
        pubkey: 'n'.repeat(64),
        kind: 1,
        content: '',
        // Replies to A (reply marker) — root tag is thread context, not parent.
        tags: [
          ['e', ROOT, '', 'root'],
          ['e', A, '', 'reply'],
        ],
        created_at: 400,
      },
    } as unknown as facade.FeedItem;

    for (const tier of ['nagg', 'primal'] as const) {
      const thread = buildThread({ tier, replies: [note(A, 300), nested, note(B, 200)] });
      const result = resolvedThreadToResult(thread, { eventId: ROOT, sort: 'new', limit: 10 });
      expect(result.replyPageEventIds).not.toContain(NESTED);
      expect(result.allSortedReplyIds).not.toContain(NESTED);
      // Still hydrated for tap-through: opening it shows its true parent.
      expect(result.allEvents.get(NESTED)?.id).toBe(NESTED);
    }
  });
});
