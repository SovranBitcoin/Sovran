import { describe, expect, test } from 'vitest';
import {
  followsFeedAppView,
  forYouRankedEventsInput,
  noteStatsAppView,
  notificationsAppView,
  rankedFeedAppView,
  threadAppView,
  userFeedAppView,
} from '../src/recipes';
import {
  NaggFeedPageSchema,
  NaggNoteStatsSchema,
  NaggNotificationsPageSchema,
  NaggThreadSchema,
} from '../src/schemas';

const NOTE_ID = 'a'.repeat(64);
const ROOT_ID = 'b'.repeat(64);
const REPOST_ID = 'c'.repeat(64);
const ORIGINAL_ID = 'd'.repeat(64);
const PUBKEY = 'e'.repeat(64);
const QUOTED_ID = 'f'.repeat(64);

function restEvent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 1,
    pubkey: PUBKEY,
    content: 'hello',
    tags: [['e', ROOT_ID, '', 'root']],
    created_at: 1_700_000_000,
    ...overrides,
  };
}

// A representative nagg REST FeedResponse body mixing a note (with root) and a repost.
const feedResponse = {
  items: [
    {
      type: 'note',
      event: restEvent(NOTE_ID),
      rootEvent: restEvent(ROOT_ID, { kind: 1, content: 'root', tags: [] }),
      rootEventId: ROOT_ID,
    },
    {
      type: 'repost',
      repostEvent: restEvent(REPOST_ID, { kind: 6, content: '', tags: [['e', ORIGINAL_ID]] }),
      originalEvent: restEvent(ORIGINAL_ID, { content: 'original', tags: [] }),
      originalEventId: ORIGINAL_ID,
    },
  ],
  metrics: {
    [NOTE_ID]: { likeCount: 3, repostCount: 1, replyCount: 2, satsZapped: 100 },
  },
  profiles: {
    [PUBKEY]: { name: 'alice', picture: 'https://example/pic.png' },
  },
  quoted: {
    [QUOTED_ID]: restEvent(QUOTED_ID, { content: 'quoted', tags: [] }),
  },
  paginationUntil: 1_699_999_000,
  paginationOffset: 2,
};

// ---------------------------------------------------------------------------
// Bindings reduce to { path, method, params|body, operationName } — no normalize.
// The canonical Nagg*Schema parses the raw nagg REST body directly.
// ---------------------------------------------------------------------------

describe('rankedFeedAppView', () => {
  test('POSTs the ranked input as a JSON body; no normalize on the binding', () => {
    const input = forYouRankedEventsInput({ viewerPubkey: PUBKEY, limit: 20 });
    const binding = rankedFeedAppView(input);

    expect(binding.path).toBe('/nostr/feed/ranked');
    expect(binding.method).toBe('POST');
    expect(binding.searchParams).toBeUndefined();
    expect(binding.body).toBe(input);
    expect('normalize' in binding).toBe(false);

    // The raw REST body parses directly through the canonical feed-page schema.
    const parsed = NaggFeedPageSchema.safeParse(feedResponse);
    expect(parsed.success).toBe(true);
    const page = parsed.data!;
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ type: 'note' });
    expect(page.items[1]).toMatchObject({ type: 'repost' });
    expect(page.metrics[NOTE_ID]).toEqual({
      likeCount: 3,
      repostCount: 1,
      replyCount: 2,
      satsZapped: 100,
    });
    expect(page.paginationUntil).toBe(1_699_999_000);
    expect(page.paginationOffset).toBe(2);
  });
});

describe('followsFeedAppView', () => {
  test('GETs /nostr/feed with an authors CSV; no normalize', () => {
    const binding = followsFeedAppView({
      pubkeys: [PUBKEY, ROOT_ID],
      until: 1_700_000_000,
      limit: 25,
      offset: 5,
    });

    expect(binding.path).toBe('/nostr/feed');
    expect(binding.method).toBe('GET');
    expect(binding.searchParams).toEqual({
      pubkeys: `${PUBKEY},${ROOT_ID}`,
      until: 1_700_000_000,
      limit: 25,
      offset: 5,
    });
    expect('normalize' in binding).toBe(false);
    expect(NaggFeedPageSchema.safeParse(feedResponse).success).toBe(true);
  });

  test('omits the pubkeys param when no authors are provided', () => {
    const binding = followsFeedAppView();
    expect(binding.searchParams).toEqual({ limit: 30 });
  });

  test('the canonical schema accepts the nagg REST note item (created_at, tags, root)', () => {
    const page = NaggFeedPageSchema.parse(feedResponse);
    const note = page.items[0];
    expect(note.type).toBe('note');
    if (note.type !== 'note') throw new Error('expected a note item');
    expect(note.event).toEqual({
      id: NOTE_ID,
      kind: 1,
      pubkey: PUBKEY,
      content: 'hello',
      tags: [['e', ROOT_ID, '', 'root']],
      created_at: 1_700_000_000,
    });
    expect(note.rootEvent?.id).toBe(ROOT_ID);
  });
});

describe('userFeedAppView', () => {
  test('GETs /nostr/feed/user; no normalize', () => {
    const binding = userFeedAppView({ pubkey: PUBKEY, until: 1_700_000_000, limit: 40 });

    expect(binding.path).toBe('/nostr/feed/user');
    expect(binding.method).toBe('GET');
    expect(binding.searchParams).toEqual({
      pubkey: PUBKEY,
      until: 1_700_000_000,
      limit: 40,
    });
    expect('normalize' in binding).toBe(false);
    expect(NaggFeedPageSchema.safeParse(feedResponse).success).toBe(true);
  });

  test('defaults limit to 50 and omits pubkey when absent', () => {
    expect(userFeedAppView().searchParams).toEqual({ limit: 50 });
  });
});

describe('threadAppView', () => {
  test('GETs /nostr/thread; the canonical schema parses the raw REST body', () => {
    const binding = threadAppView({ id: ROOT_ID, limit: 500 });

    expect(binding.path).toBe('/nostr/thread');
    expect(binding.method).toBe('GET');
    expect(binding.searchParams).toEqual({ id: ROOT_ID, limit: 500 });
    expect('normalize' in binding).toBe(false);

    const threadResponse = {
      root: restEvent(ROOT_ID, { content: 'root', tags: [] }),
      events: [restEvent(NOTE_ID), restEvent(REPOST_ID, { tags: [['e', ROOT_ID]] })],
      metrics: { [ROOT_ID]: { likeCount: 9, repostCount: 0, replyCount: 4, satsZapped: 0 } },
      profiles: { [PUBKEY]: { name: 'bob' } },
      quoted: {},
    };

    const parsed = NaggThreadSchema.safeParse(threadResponse);
    expect(parsed.success).toBe(true);
    const thread = parsed.data!;
    expect(thread.root.id).toBe(ROOT_ID);
    expect(thread.events.map((event) => event.id)).toEqual([NOTE_ID, REPOST_ID]);
    expect(thread.metrics[ROOT_ID]).toMatchObject({ likeCount: 9, replyCount: 4 });
  });
});

describe('notificationsAppView', () => {
  test('GETs /nostr/notifications with defaulted params; the schema parses the connection', () => {
    const binding = notificationsAppView({ pubkey: PUBKEY });

    expect(binding.path).toBe('/nostr/notifications');
    expect(binding.method).toBe('GET');
    expect(binding.searchParams).toEqual({
      pubkey: PUBKEY,
      tab: 'ALL',
      policy: 'STRICT',
      replyScope: 'THREAD',
      limit: 50,
    });
    expect('normalize' in binding).toBe(false);

    // nagg now emits the server-side connection { nodes, pageInfo } directly.
    const notificationsResponse = {
      notifications: {
        nodes: [
          { event: restEvent(NOTE_ID), reason: 'mention', actorVertexScore: 0.75 },
          { event: restEvent(REPOST_ID, { kind: 7 }), reason: 'reaction', actorVertexScore: 0.1 },
        ],
        pageInfo: { hasNextPage: false, endCursor: '2026-01-01T00:00:00Z|' + NOTE_ID },
      },
      metrics: { [NOTE_ID]: { likeCount: 1, repostCount: 0, replyCount: 0, satsZapped: 0 } },
      profiles: { [PUBKEY]: { name: 'carol' } },
      quoted: {},
    };

    const parsed = NaggNotificationsPageSchema.safeParse(notificationsResponse);
    expect(parsed.success).toBe(true);
    const page = parsed.data!;
    expect(page.notifications.nodes).toHaveLength(2);
    expect(page.notifications.nodes[0]).toMatchObject({ reason: 'mention', actorVertexScore: 0.75 });
    expect(page.notifications.pageInfo?.hasNextPage).toBe(false);
  });

  test('accepts a null endCursor (empty page)', () => {
    const parsed = NaggNotificationsPageSchema.safeParse({
      notifications: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      metrics: {},
      profiles: {},
      quoted: {},
    });
    expect(parsed.success).toBe(true);
  });

  test('preserves a custom tab, policy, reply scope, and bounds', () => {
    const binding = notificationsAppView({
      pubkey: PUBKEY,
      tab: 'MENTIONS',
      policy: 'RELAXED',
      replyScope: 'DIRECT',
      since: 1,
      until: 2,
      limit: 10,
    });
    expect(binding.searchParams).toEqual({
      pubkey: PUBKEY,
      tab: 'MENTIONS',
      policy: 'RELAXED',
      replyScope: 'DIRECT',
      since: 1,
      until: 2,
      limit: 10,
    });
  });
});

describe('noteStatsAppView', () => {
  test('POSTs the id list; the schema parses the stats map keyed by event id', () => {
    const binding = noteStatsAppView([NOTE_ID, REPOST_ID, '']);

    expect(binding.path).toBe('/nostr/notes/stats');
    expect(binding.method).toBe('POST');
    // Empty ids are dropped.
    expect(binding.body).toEqual({ ids: [NOTE_ID, REPOST_ID] });
    expect('normalize' in binding).toBe(false);

    const parsed = NaggNoteStatsSchema.safeParse({
      [NOTE_ID]: { likeCount: 5, repostCount: 2, replyCount: 1, satsZapped: 21 },
      [REPOST_ID]: { likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data![NOTE_ID]).toEqual({
      likeCount: 5,
      repostCount: 2,
      replyCount: 1,
      satsZapped: 21,
    });
  });
});

// ---------------------------------------------------------------------------
// The REST app-view body IS the canonical shape — the schema parses it directly.
// ---------------------------------------------------------------------------

describe('canonical REST parsing', () => {
  test('feed: the nagg REST body parses through NaggFeedPageSchema', () => {
    const restBody = {
      items: [
        {
          type: 'note',
          event: restEvent(NOTE_ID),
          rootEvent: restEvent(ROOT_ID, { content: 'root', tags: [], created_at: 1_699_900_000 }),
          rootEventId: ROOT_ID,
        },
      ],
      metrics: {
        [NOTE_ID]: { likeCount: 3, repostCount: 1, replyCount: 2, satsZapped: 100 },
        [ROOT_ID]: { likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 },
      },
      profiles: {
        [PUBKEY]: { name: 'alice', picture: 'https://example/pic.png' },
      },
      quoted: {},
      paginationUntil: 1_700_000_000,
      paginationOffset: 1,
    };

    const parsed = NaggFeedPageSchema.safeParse(restBody);
    expect(parsed.success).toBe(true);
  });

  test('notifications: the nagg REST connection body parses through NaggNotificationsPageSchema', () => {
    const restBody = {
      notifications: {
        nodes: [{ event: restEvent(NOTE_ID), reason: 'mention', actorVertexScore: 0.5 }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      metrics: { [NOTE_ID]: { likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 } },
      profiles: { [PUBKEY]: { name: 'alice' } },
      quoted: {},
    };

    const parsed = NaggNotificationsPageSchema.safeParse(restBody);
    expect(parsed.success).toBe(true);
  });
});
