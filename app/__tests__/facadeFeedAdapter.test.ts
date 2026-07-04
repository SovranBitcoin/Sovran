/**
 * Validates the facade ResolvedFeedPage → app FeedParseResult adapter: the shape
 * bridge that lets the tier-selecting facade drive the existing feed UI.
 */
import { resolvedFeedPageToParseResult } from '@/features/feed/data/facadeFeedAdapter';

const NOTE = 'a'.repeat(64);
const REPOST = 'b'.repeat(64);
const ORIG = 'c'.repeat(64);
const PUB = 'd'.repeat(64);
const QUOTED = 'e'.repeat(64);

function event(id: string, created_at: number, tags: string[][] = []) {
  return { id, kind: 1, pubkey: PUB, content: `e ${id}`, tags, created_at };
}

describe('resolvedFeedPageToParseResult', () => {
  it('maps notes + reposts (adding timestamp), stats→metrics, and cursor', () => {
    const page = {
      tier: 'relay' as const,
      items: [
        { type: 'note' as const, event: event(NOTE, 200, [['q', QUOTED]]) },
        {
          type: 'repost' as const,
          repostEvent: event(REPOST, 150),
          originalEvent: event(ORIG, 100),
          originalEventId: ORIG,
        },
      ],
      stats: { [NOTE]: { likes: 5, reposts: 2, replies: 1, zaps: 3, satsZapped: 2100 } },
      profiles: { [PUB]: { name: 'alice', picture: 'http://x/a.png' } },
      quoted: {},
      cursor: { createdAt: 100, id: ORIG },
      missingIds: [],
    };

    const result = resolvedFeedPageToParseResult(page);

    // notes carry a timestamp from created_at
    const note = result.orderedFeedItems[0];
    expect(note.type === 'note' && note.event.id).toBe(NOTE);
    expect(note.timestamp).toBe(200);
    // repost normalizes originalEvent/originalEventId + timestamp
    const repost = result.orderedFeedItems[1];
    expect(repost.type === 'repost' && repost.originalEventId).toBe(ORIG);
    expect(repost.timestamp).toBe(150);
    // stats → NoteMetrics field rename
    expect(result.metricsMap.get(NOTE)).toEqual({
      likeCount: 5,
      repostCount: 2,
      replyCount: 1,
      satsZapped: 2100,
    });
    // profiles + cursor
    expect(result.profilesMap.get(PUB)).toEqual({ name: 'alice', picture: 'http://x/a.png' });
    expect(result.paginationUntil).toBe(100);
    expect(result.paginationOffset).toBe(2);
    // gaps for the enrichment path: the q-tagged quote + the author profile when absent
    expect(result.missingQuotedIds).toContain(QUOTED);
  });

  it('produces an empty-but-valid result for an empty page', () => {
    const result = resolvedFeedPageToParseResult({
      tier: 'nagg' as const,
      items: [],
      stats: {},
      profiles: {},
      quoted: {},
      cursor: null,
      missingIds: [],
    });
    expect(result.orderedFeedItems).toEqual([]);
    expect(result.paginationUntil).toBe(0);
    expect(result.missingProfilePubkeys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Profile-feed filter options: the legacy nagg-only user feed kept author-owned
// root notes + author-owned reposts. Routing user feeds through the facade must
// preserve those semantics no matter which tier answered.
// ---------------------------------------------------------------------------

import { isRootNote } from '@/features/feed/data/facadeFeedAdapter';

const OTHER_PUB = 'f'.repeat(64);

function authoredEvent(id: string, pubkey: string, created_at: number, tags: string[][] = []) {
  return { id, kind: 1, pubkey, content: `e ${id}`, tags, created_at };
}

describe('resolvedFeedPageToParseResult filter options', () => {
  const page = {
    tier: 'relay' as const,
    items: [
      // author root note — kept
      { type: 'note' as const, event: authoredEvent('1'.repeat(64), PUB, 400) },
      // author REPLY (real e-tag) — dropped by the root-note rule
      {
        type: 'note' as const,
        event: authoredEvent('2'.repeat(64), PUB, 300, [['e', NOTE, '', 'reply']]),
      },
      // someone else's note — dropped by the author rule
      { type: 'note' as const, event: authoredEvent('3'.repeat(64), OTHER_PUB, 250) },
      // author repost — kept
      {
        type: 'repost' as const,
        repostEvent: authoredEvent('4'.repeat(64), PUB, 200),
        originalEvent: authoredEvent(ORIG, OTHER_PUB, 100),
        originalEventId: ORIG,
      },
      // someone else's repost — dropped
      {
        type: 'repost' as const,
        repostEvent: authoredEvent('5'.repeat(64), OTHER_PUB, 150),
        originalEvent: null,
        originalEventId: ORIG,
      },
    ],
    stats: {},
    profiles: {},
    quoted: {},
    cursor: { createdAt: 100, id: ORIG },
    missingIds: [],
  };

  it('applies the legacy author-owned root-note/repost profile-feed filters', () => {
    const result = resolvedFeedPageToParseResult(page, {
      includeNote: (event) => event.pubkey === PUB && isRootNote(event),
      includeRepost: (event) => event.pubkey === PUB,
    });
    const ids = result.orderedFeedItems.map((item) =>
      item.type === 'note' ? item.event.id : item.repostEvent.id
    );
    expect(ids).toEqual(['1'.repeat(64), '4'.repeat(64)]);
    // Pagination cursor still comes from the tier, not the filtered items.
    expect(result.paginationUntil).toBe(100);
  });

  it('keeps everything when no filters are given', () => {
    const result = resolvedFeedPageToParseResult(page);
    expect(result.orderedFeedItems).toHaveLength(5);
  });

  it('seeds extraProfile only when the tier did not return that profile', () => {
    const seeded = resolvedFeedPageToParseResult(page, {
      extraProfile: { pubkey: PUB, profile: { name: 'seeded', picture: 'http://x/s.png' } },
    });
    expect(seeded.profilesMap.get(PUB)).toEqual({ name: 'seeded', picture: 'http://x/s.png' });

    const withTierProfile = resolvedFeedPageToParseResult(
      { ...page, profiles: { [PUB]: { name: 'from-tier' } } },
      { extraProfile: { pubkey: PUB, profile: { name: 'seeded' } } }
    );
    expect(withTierProfile.profilesMap.get(PUB)).toEqual({ name: 'from-tier' });
  });
});

describe('isRootNote', () => {
  it('treats no e-tags and mention-only e-tags as root', () => {
    expect(isRootNote({ tags: [] })).toBe(true);
    expect(isRootNote({ tags: [['e', NOTE, '', 'mention']] })).toBe(true);
    expect(isRootNote({ tags: [['e', NOTE, '', 'reply']] })).toBe(false);
    expect(isRootNote({ tags: [['e', NOTE]] })).toBe(false);
  });
});
