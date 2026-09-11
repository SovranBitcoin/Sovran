import * as nip19 from 'nostr-tools/nip19';
import { mapNaggFeedPage } from '@/features/feed/data/mapNaggFeedPage';
import { DEFAULT_METRICS, type FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import { THREAD_CONNECTOR_LINE_STYLE } from '@/features/feed/components/nostr/threadConnectorStyle';
import { getFeedItemRootContext } from '@/features/feed/lib/rootContext';

type FeedPage = Parameters<typeof mapNaggFeedPage>[0];

const metrics = {
  likeCount: 1,
  repostCount: 2,
  replyCount: 3,
  satsZapped: 4,
};

function event(overrides: Partial<FeedEvent> = {}): FeedEvent {
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

describe('mapNaggFeedPage', () => {
  it('maps Nagg feed responses into FeedParseResult', () => {
    const note = event({ id: 'note-a', pubkey: 'alice', created_at: 100 });
    const original = event({ id: 'note-b', pubkey: 'carol', created_at: 80 });
    const repost = event({
      id: 'repost-a',
      kind: 6,
      pubkey: 'bob',
      content: '',
      tags: [['e', original.id]],
      created_at: 90,
    });

    const page: FeedPage = {
      items: [
        { type: 'note', event: note },
        { type: 'repost', repostEvent: repost, originalEvent: original },
      ],
      metrics: { [note.id]: metrics },
      profiles: { alice: { name: 'Alice' } },
      quoted: {},
      paginationUntil: 80,
      paginationOffset: 2,
    };

    const result = mapNaggFeedPage(page);

    expect(result.orderedFeedItems).toHaveLength(2);
    expect(result.orderedFeedItems[0]).toMatchObject({ type: 'note', event: note });
    expect(result.orderedFeedItems[1]).toMatchObject({
      type: 'repost',
      repostEvent: repost,
      originalEvent: original,
      originalEventId: original.id,
    });
    expect(result.metricsMap.get(note.id)).toEqual(metrics);
    expect(result.metricsMap.get(original.id)).toEqual(DEFAULT_METRICS);
    expect(result.missingProfilePubkeys).toEqual(['carol', 'bob']);
    expect(result.paginationUntil).toBe(80);
    expect(result.paginationOffset).toBe(2);
  });

  it('maps root context events into feed items and hydration maps', () => {
    const root = event({
      id: 'a'.repeat(64),
      pubkey: 'root-author',
      content: 'root post',
      created_at: 100,
    });
    const quote = event({
      id: 'b'.repeat(64),
      pubkey: 'quote-author',
      content: 'quoted post',
      created_at: 95,
    });
    const reply = event({
      id: 'c'.repeat(64),
      pubkey: 'reply-author',
      content: 'reply quoting by tag',
      tags: [
        ['e', root.id, '', 'root'],
        ['q', quote.id],
      ],
      created_at: 90,
    });

    const page: FeedPage = {
      items: [{ type: 'note', event: reply, rootEvent: root, rootEventId: root.id }],
      metrics: { [root.id]: metrics, [reply.id]: { ...metrics, likeCount: 9 } },
      profiles: {
        'root-author': { name: 'Root Author' },
        'reply-author': { name: 'Reply Author' },
        'quote-author': { name: 'Quote Author' },
      },
      quoted: { [quote.id]: quote },
      paginationUntil: 90,
      paginationOffset: 1,
    };

    const result = mapNaggFeedPage(page);
    const item = result.orderedFeedItems[0];

    expect(item).toMatchObject({
      type: 'note',
      event: reply,
      rootEvent: root,
      rootEventId: root.id,
    });
    expect(result.metricsMap.get(root.id)).toEqual(metrics);
    expect(result.metricsMap.get(reply.id)?.likeCount).toBe(9);
    expect(result.quotedEventsMap.get(quote.id)).toEqual(quote);
    expect(result.missingQuotedIds).toEqual([]);
    expect(result.missingProfilePubkeys).toEqual([]);
  });

  it('skips duplicate root context when the visible post is already the root', () => {
    const root = event({
      id: 'root',
      pubkey: 'alice',
      content: 'root post',
      created_at: 100,
    });

    const page: FeedPage = {
      items: [{ type: 'note', event: root, rootEvent: root, rootEventId: root.id }],
      metrics: {},
      profiles: {},
      quoted: {},
      paginationUntil: 100,
      paginationOffset: 1,
    };

    const result = mapNaggFeedPage(page);

    expect(getFeedItemRootContext(result.orderedFeedItems[0])).toBeUndefined();
  });

  it('uses a dotted connector rail for feed root context stacks', () => {
    expect(THREAD_CONNECTOR_LINE_STYLE).toEqual(
      expect.objectContaining({
        width: 0,
        borderLeftWidth: 2,
        borderStyle: 'dotted',
      })
    );
  });

  it('keeps Nagg-provided profiles and cursors in the feed result', () => {
    const note = event({
      id: 'note-a',
      pubkey: 'alice',
      content: 'hello',
      created_at: 100,
    });
    const naggPage: FeedPage = {
      items: [{ type: 'note', event: note }],
      metrics: { [note.id]: metrics },
      profiles: { alice: { name: 'Alice', picture: 'https://example.test/a.png' } },
      quoted: {},
      paginationUntil: 100,
      paginationOffset: 1,
    };

    const result = mapNaggFeedPage(naggPage);
    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.profilesMap.get('alice')).toEqual({
      name: 'Alice',
      picture: 'https://example.test/a.png',
    });
    expect(result.metricsMap.get(note.id)).toEqual(metrics);
    expect(result.paginationUntil).toBe(100);
    expect(result.paginationOffset).toBe(1);
  });

  it('reports missing quoted events using the existing NIP-19 parser path', () => {
    const quotedId = 'f'.repeat(64);
    const note = event({
      id: 'note-with-quote',
      content: `see nostr:${nip19.noteEncode(quotedId)}`,
    });

    const page: FeedPage = {
      items: [{ type: 'note', event: note }],
      metrics: {},
      profiles: { alice: { name: 'Alice' } },
      quoted: {},
      paginationUntil: 100,
      paginationOffset: 1,
    };

    const result = mapNaggFeedPage(page);

    expect(result.missingQuotedIds).toEqual([quotedId]);
    expect(result.metricsMap.get(note.id)).toEqual(DEFAULT_METRICS);
  });

  it('reports missing quoted events from Nostr q tags', () => {
    const quotedId = 'e'.repeat(64);
    const note = event({
      id: 'note-with-q-tag',
      content: 'see quoted post',
      tags: [['q', quotedId]],
    });

    const page: FeedPage = {
      items: [{ type: 'note', event: note }],
      metrics: {},
      profiles: { alice: { name: 'Alice' } },
      quoted: {},
      paginationUntil: 100,
      paginationOffset: 1,
    };

    const result = mapNaggFeedPage(page);

    expect(result.missingQuotedIds).toEqual([quotedId]);
  });

  it('supports the user-feed root-note filter', () => {
    const root = event({ id: 'root', pubkey: 'alice', tags: [] });
    const reply = event({
      id: 'reply',
      pubkey: 'alice',
      tags: [['e', 'root', '', 'reply']],
      created_at: 90,
    });
    const quote = event({
      id: 'quote',
      pubkey: 'alice',
      tags: [['e', 'quoted', '', 'mention']],
      created_at: 80,
    });

    const page: FeedPage = {
      items: [
        { type: 'note', event: root },
        { type: 'note', event: reply },
        { type: 'note', event: quote },
      ],
      metrics: {},
      profiles: {},
      quoted: {},
      paginationUntil: 80,
      paginationOffset: 3,
    };

    const result = mapNaggFeedPage(page, {
      includeNote: (ev) => {
        const eTags = ev.tags.filter((tag) => tag[0] === 'e');
        return eTags.length === 0 || eTags.every((tag) => tag[3] === 'mention');
      },
      extraProfile: { pubkey: 'alice', profile: { name: 'Alice' } },
    });

    expect(
      result.orderedFeedItems.map((item) => (item.type === 'note' ? item.event.id : ''))
    ).toEqual(['root', 'quote']);
    expect(result.profilesMap.get('alice')).toEqual({ name: 'Alice' });
  });
});
