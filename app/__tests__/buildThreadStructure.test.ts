import { ShortTextNote } from 'nostr-tools/kinds';

import { buildThreadStructure } from '@/features/feed/lib/buildThreadStructure';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

function note(
  id: string,
  pubkey: string,
  tags: string[][] = [],
  createdAt = 1700000000,
  kind = ShortTextNote
): FeedEvent {
  return { id, kind, pubkey, content: '', tags, created_at: createdAt };
}

function makeMap(events: FeedEvent[]): Map<string, FeedEvent> {
  return new Map(events.map((e) => [e.id, e]));
}

describe('buildThreadStructure (audit 59.json F-001)', () => {
  it('returns no parents when only `mention`-marked e-tags reference other events', () => {
    // F-001: a `mention` marker means quoted, NOT a parent.
    const target = note('target', 'alice', [['e', 'quoted_post', '', 'mention']]);
    const quoted = note('quoted_post', 'bob');
    const result = buildThreadStructure('target', makeMap([target, quoted]));

    expect(result.target).toBe(target);
    expect(result.parents).toEqual([]);
    expect(result.replies).toEqual([]);
  });

  it('walks `reply` and `root` markers as parents and ignores `mention`', () => {
    const root = note('root', 'alice');
    const parent = note('parent', 'bob', [['e', 'root', '', 'root']]);
    const target = note('target', 'carol', [
      ['e', 'root', '', 'root'],
      ['e', 'unrelated_quote', '', 'mention'],
      ['e', 'parent', '', 'reply'],
    ]);
    const result = buildThreadStructure(
      'target',
      makeMap([root, parent, target, note('unrelated_quote', 'dan')])
    );

    expect(result.parents.map((p) => p.id)).toEqual(['root', 'parent']);
  });

  it('discovers direct replies via the `reply` marker and ignores `mention`-marked refs', () => {
    const target = note('target', 'alice');
    const directReply = note('direct', 'bob', [['e', 'target', '', 'reply']], 1700000010);
    const quotingPost = note('quoter', 'carol', [['e', 'target', '', 'mention']], 1700000020);
    const result = buildThreadStructure('target', makeMap([target, directReply, quotingPost]));

    expect(result.replies.map((r) => r.id)).toEqual(['direct']);
  });

  it('discovers NIP-22 comment replies fetched by GraphQL', () => {
    const target = note('target', 'alice');
    const commentReply = note('comment', 'bob', [['e', 'target', '', 'reply']], 1700000010, 1111);
    const result = buildThreadStructure('target', makeMap([target, commentReply]));

    expect(result.replies.map((r) => r.id)).toEqual(['comment']);
  });

  it('returns null target when the eventId is missing from the map', () => {
    const result = buildThreadStructure('missing', makeMap([note('other', 'alice')]));
    expect(result).toEqual({ parents: [], target: null, replies: [] });
  });

  it('walks the LAST unmarked e-tag as the immediate parent (A→B→A, not A→A)', () => {
    // Deprecated positional NIP-10: first unmarked e-tag is the root, last is
    // the immediate parent. For an A→B→A chain the leaf (second A) must show
    // both B and the root A — not skip B and render A→A.
    const rootA = note('rootA', 'alice');
    const replyB = note('replyB', 'bob', [['e', 'rootA']]);
    const leafA = note('leafA', 'alice', [
      ['e', 'rootA'],
      ['e', 'replyB'],
    ]);
    const result = buildThreadStructure('leafA', makeMap([rootA, replyB, leafA]));

    expect(result.parents.map((p) => p.id)).toEqual(['rootA', 'replyB']);
  });

  it('prefers an unmarked immediate parent over a `root`-marked ancestor', () => {
    // Some clients mark only the root and leave the immediate parent unmarked.
    const rootA = note('rootA', 'alice');
    const parentB = note('parentB', 'bob', [['e', 'rootA', '', 'root']]);
    const target = note('target', 'carol', [
      ['e', 'rootA', '', 'root'],
      ['e', 'parentB'],
    ]);
    const result = buildThreadStructure('target', makeMap([rootA, parentB, target]));

    expect(result.parents.map((p) => p.id)).toEqual(['rootA', 'parentB']);
  });
});

describe('buildThreadStructure — OP direct replies lead the seed order', () => {
  const OP = 'f'.repeat(64);

  it('partitions the target author\'s direct replies first, chronological within each group', () => {
    const root = note('root', OP, []);
    const early = note('early-other', 'a'.repeat(64), [['e', 'root', '', 'root']], 100);
    const opLate = note('op-late', OP, [['e', 'root', '', 'root']], 300);
    const mid = note('mid-other', 'b'.repeat(64), [['e', 'root', '', 'root']], 200);
    const events = new Map([
      ['root', root],
      ['early-other', early],
      ['op-late', opLate],
      ['mid-other', mid],
    ]);

    const structure = buildThreadStructure('root', events);
    expect(structure.replies.map((e) => e.id)).toEqual(['op-late', 'early-other', 'mid-other']);
  });
});
