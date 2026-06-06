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

// A representative FeedResponse payload mixing a note (with root) and a repost.
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

describe('rankedFeedAppView', () => {
  test('POSTs the ranked input as a JSON body and normalizes to the feed page', () => {
    const input = forYouRankedEventsInput({ viewerPubkey: PUBKEY, limit: 20 });
    const binding = rankedFeedAppView(input);

    expect(binding.path).toBe('/nostr/feed/ranked');
    expect(binding.method).toBe('POST');
    expect(binding.searchParams).toBeUndefined();
    expect(binding.body).toBe(input);

    const normalized = binding.normalize(feedResponse);
    expect(NaggFeedPageSchema.safeParse(normalized).success).toBe(true);

    const page = normalized as ReturnType<typeof binding.normalize> & {
      items: Array<Record<string, unknown>>;
      metrics: Record<string, unknown>;
      paginationUntil: number;
      paginationOffset: number;
    };
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
  test('GETs /nostr/feed with an authors CSV and normalizes to the feed page', () => {
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

    const normalized = binding.normalize(feedResponse);
    expect(NaggFeedPageSchema.safeParse(normalized).success).toBe(true);
  });

  test('omits the pubkeys param when no authors are provided', () => {
    const binding = followsFeedAppView();
    expect(binding.searchParams).toEqual({ limit: 30 });
  });

  test('normalizes the canonical note item shape (created_at, tags, root)', () => {
    const binding = followsFeedAppView({ pubkeys: [PUBKEY] });
    const page = binding.normalize(feedResponse) as {
      items: Array<{ type: string; event?: Record<string, unknown>; rootEvent?: Record<string, unknown> }>;
    };
    const note = page.items[0];
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
  test('GETs /nostr/feed/user and normalizes to the feed page', () => {
    const binding = userFeedAppView({ pubkey: PUBKEY, until: 1_700_000_000, limit: 40 });

    expect(binding.path).toBe('/nostr/feed/user');
    expect(binding.method).toBe('GET');
    expect(binding.searchParams).toEqual({
      pubkey: PUBKEY,
      until: 1_700_000_000,
      limit: 40,
    });

    expect(NaggFeedPageSchema.safeParse(binding.normalize(feedResponse)).success).toBe(true);
  });

  test('defaults limit to 50 and omits pubkey when absent', () => {
    expect(userFeedAppView().searchParams).toEqual({ limit: 50 });
  });
});

describe('threadAppView', () => {
  test('GETs /nostr/thread and normalizes to the canonical thread shape', () => {
    const binding = threadAppView({ id: ROOT_ID, limit: 500 });

    expect(binding.path).toBe('/nostr/thread');
    expect(binding.method).toBe('GET');
    expect(binding.searchParams).toEqual({ id: ROOT_ID, limit: 500 });

    const threadResponse = {
      root: restEvent(ROOT_ID, { content: 'root', tags: [] }),
      events: [restEvent(NOTE_ID), restEvent(REPOST_ID, { tags: [['e', ROOT_ID]] })],
      metrics: { [ROOT_ID]: { likeCount: 9, repostCount: 0, replyCount: 4, satsZapped: 0 } },
      profiles: { [PUBKEY]: { name: 'bob' } },
      quoted: {},
    };

    const normalized = binding.normalize(threadResponse);
    expect(NaggThreadSchema.safeParse(normalized).success).toBe(true);

    const thread = normalized as {
      root: { id: string };
      events: Array<{ id: string }>;
      metrics: Record<string, unknown>;
    };
    expect(thread.root.id).toBe(ROOT_ID);
    expect(thread.events.map((event) => event.id)).toEqual([NOTE_ID, REPOST_ID]);
    expect(thread.metrics[ROOT_ID]).toMatchObject({ likeCount: 9, replyCount: 4 });
  });
});

describe('notificationsAppView', () => {
  test('GETs /nostr/notifications with defaulted params and builds the connection', () => {
    const binding = notificationsAppView({ viewer: PUBKEY });

    expect(binding.path).toBe('/nostr/notifications');
    expect(binding.method).toBe('GET');
    expect(binding.searchParams).toEqual({
      viewer: PUBKEY,
      tab: 'ALL',
      policy: 'STRICT',
      replyScope: 'THREAD',
      limit: 50,
    });

    const notificationsResponse = {
      notifications: [
        { event: restEvent(NOTE_ID), reason: 'mention', actorVertexScore: 0.75 },
        { event: restEvent(REPOST_ID, { kind: 7 }), reason: 'reaction', actorVertexScore: 0.1 },
      ],
      metrics: { [NOTE_ID]: { likeCount: 1, repostCount: 0, replyCount: 0, satsZapped: 0 } },
      profiles: { [PUBKEY]: { name: 'carol' } },
      quoted: {},
      paginationUntil: 1_699_990_000,
    };

    const normalized = binding.normalize(notificationsResponse);
    expect(NaggNotificationsPageSchema.safeParse(normalized).success).toBe(true);

    const page = normalized as {
      notifications: {
        nodes: Array<{ event: { id: string }; reason: string; actorVertexScore: number }>;
        pageInfo: { hasNextPage: boolean; endCursor: number | null };
      };
    };
    expect(page.notifications.nodes).toHaveLength(2);
    expect(page.notifications.nodes[0]).toMatchObject({ reason: 'mention', actorVertexScore: 0.75 });
    expect(page.notifications.pageInfo.endCursor).toBe(1_699_990_000);
    // 2 nodes < limit 50 → no next page.
    expect(page.notifications.pageInfo.hasNextPage).toBe(false);
  });

  test('flags hasNextPage when the page fills to the limit', () => {
    const binding = notificationsAppView({ viewer: PUBKEY, limit: 2 });
    const page = binding.normalize({
      notifications: [
        { event: restEvent(NOTE_ID), reason: 'mention', actorVertexScore: 0 },
        { event: restEvent(REPOST_ID), reason: 'reply', actorVertexScore: 0 },
      ],
      metrics: {},
      profiles: {},
      quoted: {},
      paginationUntil: 1_699_990_000,
    }) as { notifications: { pageInfo: { hasNextPage: boolean } } };
    expect(page.notifications.pageInfo.hasNextPage).toBe(true);
  });

  test('preserves a custom tab, policy, reply scope, and bounds', () => {
    const binding = notificationsAppView({
      viewer: PUBKEY,
      tab: 'MENTIONS',
      policy: 'RELAXED',
      replyScope: 'DIRECT',
      since: 1,
      until: 2,
      limit: 10,
    });
    expect(binding.searchParams).toEqual({
      viewer: PUBKEY,
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
  test('POSTs the id list and normalizes the stats map keyed by event id', () => {
    const binding = noteStatsAppView([NOTE_ID, REPOST_ID, '']);

    expect(binding.path).toBe('/nostr/notes/stats');
    expect(binding.method).toBe('POST');
    // Empty ids are dropped.
    expect(binding.body).toEqual({ ids: [NOTE_ID, REPOST_ID] });

    const normalized = binding.normalize({
      [NOTE_ID]: { likeCount: 5, repostCount: 2, replyCount: 1, satsZapped: 21 },
      [REPOST_ID]: { likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 },
    });
    expect(NaggNoteStatsSchema.safeParse(normalized).success).toBe(true);

    const stats = normalized as Record<string, Record<string, number>>;
    expect(stats[NOTE_ID]).toEqual({
      likeCount: 5,
      repostCount: 2,
      replyCount: 1,
      satsZapped: 21,
    });
    // Missing fields default to 0.
    expect(binding.normalize({ [NOTE_ID]: {} })).toEqual({
      [NOTE_ID]: { likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 },
    });
  });
});
