import type { facade } from 'nostr';
import { resolvedThreadToResult } from '@/features/feed/data/facadeThreadAdapter';
import type { ThreadReplySort } from '@/features/feed/data/feedClient';

const ROOT = 'r'.repeat(64);
const A = 'a'.repeat(64); // newest, most reposts
const B = 'b'.repeat(64); // most likes
const C = 'c'.repeat(64); // most zaps, oldest

function note(id: string, createdAt: number): facade.FeedItem {
  return {
    type: 'note',
    event: { id, pubkey: 'p'.repeat(64), kind: 1, content: '', tags: [], created_at: createdAt },
  } as unknown as facade.FeedItem;
}

// Stats engineered so each sort yields a distinct top reply.
const STATS = {
  [A]: { likes: 1, reposts: 9, replies: 0, zaps: 0, satsZapped: 0 },
  [B]: { likes: 9, reposts: 1, replies: 0, zaps: 0, satsZapped: 100 },
  [C]: { likes: 0, reposts: 0, replies: 0, zaps: 5, satsZapped: 9000 },
};

function buildThread(): facade.ResolvedThread {
  return {
    tier: 'primal',
    root: note(ROOT, 1000),
    parents: [],
    replies: [note(A, 300), note(B, 200), note(C, 100)],
    stats: STATS,
    profiles: {},
    quoted: {},
    cursor: null,
    missingIds: [],
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
