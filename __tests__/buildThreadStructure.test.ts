import { ShortTextNote } from 'nostr-tools/kinds';

import { buildThreadStructure } from '@/features/feed/lib/buildThreadStructure';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

function note(
  id: string,
  pubkey: string,
  tags: string[][] = [],
  createdAt = 1700000000
): FeedEvent {
  return { id, kind: ShortTextNote, pubkey, content: '', tags, created_at: createdAt };
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

  it('returns null target when the eventId is missing from the map', () => {
    const result = buildThreadStructure('missing', makeMap([note('other', 'alice')]));
    expect(result).toEqual({ parents: [], target: null, replies: [] });
  });
});
