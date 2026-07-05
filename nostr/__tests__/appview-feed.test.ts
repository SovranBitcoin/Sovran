import { describe, expect, test } from 'vitest';
import {
  eventsAggregatesAppView,
  followsFeedAppView,
  forYouRankedEventsInput,
  notificationsAppView,
  rankedFeedAppView,
  threadAppView,
  userFeedAppView,
} from '../src/recipes';
import {
  NaggEnvelopeSchema,
  NaggNotificationsEnvelopeSchema,
  noteStatsFromEnvelope,
  feedPageFromEnvelope,
} from '../src/envelope';

const NOTE_ID = 'a'.repeat(64);
const ROOT_ID = 'b'.repeat(64);
const REPOST_ID = 'c'.repeat(64);
const PUBKEY = 'e'.repeat(64);

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

// A representative nagg v2 envelope body: ordered note + hydrated root + author profile.
const feedEnvelopeBody = {
  order: [NOTE_ID],
  orderBy: 'created_at',
  events: [
    restEvent(NOTE_ID),
    restEvent(ROOT_ID, { content: 'root', tags: [] }),
    restEvent('9'.repeat(64), { kind: 0, content: JSON.stringify({ name: 'alice' }), tags: [] }),
  ],
  aggregates: { [NOTE_ID]: { k7_e: { actors: 3 }, k1_1111_e_reply: { sources: 2 } } },
  cursor: '1699999000|1',
};

// ---------------------------------------------------------------------------
// Bindings reduce to { path, method, params|body, operationName } — every
// route's body is the same generic envelope, parsed by NaggEnvelopeSchema.
// ---------------------------------------------------------------------------

describe('rankedFeedAppView', () => {
  test('POSTs the ranked input as a JSON body; the envelope parses the response', () => {
    const input = forYouRankedEventsInput({ viewerPubkey: PUBKEY, limit: 20 });
    const binding = rankedFeedAppView(input);

    expect(binding.path).toBe('/nostr/feed/ranked');
    expect(binding.method).toBe('POST');
    expect(binding.searchParams).toBeUndefined();
    expect(binding.body).toBe(input);

    const parsed = NaggEnvelopeSchema.safeParse(feedEnvelopeBody);
    expect(parsed.success).toBe(true);
    const page = feedPageFromEnvelope(parsed.data!);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ type: 'note' });
    expect(page.metrics[NOTE_ID]).toMatchObject({ likeCount: 3, replyCount: 2, satsZapped: 0 });
    expect(page.paginationUntil).toBe(1_699_999_000);
    expect(page.paginationOffset).toBe(1);
  });
});

describe('followsFeedAppView', () => {
  test('GETs /nostr/feed with an authors CSV', () => {
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
  });

  test('omits the pubkeys param when no authors are provided', () => {
    const binding = followsFeedAppView();
    expect(binding.searchParams).toEqual({ limit: 30 });
  });
});

describe('userFeedAppView', () => {
  test('GETs /nostr/feed/user', () => {
    const binding = userFeedAppView({ pubkey: PUBKEY, until: 1_700_000_000, limit: 40 });

    expect(binding.path).toBe('/nostr/feed/user');
    expect(binding.method).toBe('GET');
    expect(binding.searchParams).toEqual({
      pubkey: PUBKEY,
      until: 1_700_000_000,
      limit: 40,
    });
  });

  test('defaults limit to 50 and omits pubkey when absent', () => {
    expect(userFeedAppView().searchParams).toEqual({ limit: 50 });
  });
});

describe('threadAppView', () => {
  test('GETs /nostr/thread; the envelope parses the response', () => {
    const binding = threadAppView({ id: ROOT_ID, limit: 500 });

    expect(binding.path).toBe('/nostr/thread');
    expect(binding.method).toBe('GET');
    expect(binding.searchParams).toEqual({ id: ROOT_ID, limit: 500 });

    const threadEnvelope = {
      order: [ROOT_ID, NOTE_ID],
      orderBy: 'rank',
      events: [restEvent(ROOT_ID, { content: 'root', tags: [] }), restEvent(NOTE_ID)],
      aggregates: { [ROOT_ID]: { k7_e: { actors: 9 }, k1_1111_e_reply: { sources: 4 } } },
    };
    expect(NaggEnvelopeSchema.safeParse(threadEnvelope).success).toBe(true);
  });
});

describe('notificationsAppView', () => {
  test('GETs /nostr/notifications with defaulted params; the extended envelope parses', () => {
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

    // v2: envelope + entries + hasNext (no reason strings).
    const notificationsBody = {
      order: [REPOST_ID],
      orderBy: 'created_at',
      events: [restEvent(REPOST_ID, { kind: 7, content: '+', tags: [['e', NOTE_ID]] })],
      aggregates: {},
      entries: [
        {
          id: REPOST_ID,
          kind: 7,
          actor: PUBKEY,
          target: NOTE_ID,
          actors: [{ pubkey: PUBKEY, eventId: REPOST_ID, createdAt: 1_700_000_000 }],
        },
      ],
      hasNext: false,
      cursor: '2026-07-03T23:21:35Z|' + REPOST_ID,
    };
    const parsed = NaggNotificationsEnvelopeSchema.safeParse(notificationsBody);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.entries).toHaveLength(1);
    expect(parsed.data!.hasNext).toBe(false);
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

describe('eventsAggregatesAppView', () => {
  test('POSTs the id list to the v2 aggregates route; values ride in the envelope', () => {
    const binding = eventsAggregatesAppView([NOTE_ID, REPOST_ID, '']);

    expect(binding.path).toBe('/nostr/events/aggregates');
    expect(binding.method).toBe('POST');
    // Empty ids are dropped.
    expect(binding.body).toEqual({ ids: [NOTE_ID, REPOST_ID] });

    // The live response: order/events empty, aggregates keyed by event id.
    const body = {
      order: [],
      orderBy: 'created_at',
      events: [],
      aggregates: {
        [NOTE_ID]: { k7_e: { actors: 5 }, k6_16_e: { actors: 2 }, k9735_e: { sources: 1, value_total: 21 } },
      },
    };
    const parsed = NaggEnvelopeSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    const stats = noteStatsFromEnvelope(parsed.data!);
    expect(stats[NOTE_ID]).toEqual({
      likeCount: 5,
      repostCount: 2,
      replyCount: 0,
      satsZapped: 21,
      zapCount: 1,
      quoteCount: 0,
    });
    // The requested-but-unengaged id is simply absent (zero-omission) — callers
    // default through noteMetricsFromAggregates when they need explicit zeros.
    expect(stats[REPOST_ID]).toBeUndefined();
  });
});
