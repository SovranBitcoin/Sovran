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
        { type: 'repost' as const, repostEvent: event(REPOST, 150), originalEvent: event(ORIG, 100), originalEventId: ORIG },
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
    expect(result.metricsMap.get(NOTE)).toEqual({ likeCount: 5, repostCount: 2, replyCount: 1, satsZapped: 2100 });
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
