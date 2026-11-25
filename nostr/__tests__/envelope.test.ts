import { describe, expect, test } from 'vitest';
import {
  NaggEnvelopeSchema,
  NaggProfilesEnvelopeSchema,
  aggregateValue,
  profileMetadataByPubkey,
} from '../src/envelope';
import { searchHitsFromEnvelope } from '../src/facade/search';

const NOTE_ID = 'a'.repeat(64);
const ROOT_ID = 'b'.repeat(64);
const PUBKEY = 'e'.repeat(64);
const REPOSTER = 'f'.repeat(64);
const QUOTED_ID = '1'.repeat(64);
const VIEWER = '2'.repeat(64);
const ACTOR = '3'.repeat(64);

function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 1,
    pubkey: PUBKEY,
    content: 'hello',
    tags: [] as string[][],
    created_at: 1_700_000_000,
    ...overrides,
  };
}

function kind0(pubkey: string, content: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return event(`9${pubkey.slice(1)}`, {
    kind: 0,
    pubkey,
    content: JSON.stringify(content),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Envelope parse
// ---------------------------------------------------------------------------

describe('NaggEnvelopeSchema', () => {
  test('parses a live-shaped feed envelope', () => {
    const parsed = NaggEnvelopeSchema.safeParse({
      order: [NOTE_ID],
      orderBy: 'created_at',
      events: [event(NOTE_ID)],
      aggregates: { [NOTE_ID]: { k7_e: { actors: 1 } } },
      cursor: '1783180778|2',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.order).toEqual([NOTE_ID]);
    expect(parsed.data!.aggregates[NOTE_ID].k7_e.actors).toBe(1);
  });

  test('tolerates Go nil slices/maps (null order/events/aggregates) and no cursor', () => {
    const parsed = NaggEnvelopeSchema.safeParse({
      order: null,
      orderBy: 'rank',
      events: null,
      aggregates: null,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.order).toEqual([]);
    expect(parsed.data!.events).toEqual([]);
    expect(parsed.data!.aggregates).toEqual({});
    expect(parsed.data!.cursor ?? null).toBeNull();
  });

});

// ---------------------------------------------------------------------------
// Aggregates → friendly names (zero values omitted server-side)
// ---------------------------------------------------------------------------

describe('aggregate accessors', () => {
  const aggregates: import('../src/envelope').NaggAggregates = {
    [NOTE_ID]: {
      k7_e: { actors: 22 },
      k6_16_e: { actors: 4 },
      k1_1111_e_reply: { sources: 12 },
      k1_q: { sources: 1 },
      k9735_e: { sources: 3, value_total: 2514 },
    },
    [PUBKEY]: {
      k3_p_latest: { actors: 163 },
      k3_author_latest: { sources: 99 },
      k1_1111_author: { sources: 1234 },
    },
  };

  test('maps friendly names to rule metrics', () => {
    expect(aggregateValue(aggregates, NOTE_ID, 'likeCount')).toBe(22);
    expect(aggregateValue(aggregates, NOTE_ID, 'satsZapped')).toBe(2514);
    expect(aggregateValue(aggregates, PUBKEY, 'followers')).toBe(163);
    expect(aggregateValue(aggregates, PUBKEY, 'following')).toBe(99);
  });

  test('zero-omitted rules are undefined for unknown ids', () => {
    expect(aggregateValue(aggregates, ROOT_ID, 'likeCount')).toBeUndefined();
    expect(aggregateValue(aggregates, ROOT_ID, 'followers')).toBeUndefined();
  });

});

// ---------------------------------------------------------------------------
// Profile extraction from kind-0 hydration
// ---------------------------------------------------------------------------

describe('profile extraction', () => {

  test('keeps the LATEST kind-0 per pubkey and tolerates junk content', () => {
    const envelope = NaggEnvelopeSchema.parse({
      order: [],
      orderBy: 'created_at',
      events: [
        kind0(PUBKEY, { name: 'old' }, { id: '4'.repeat(64), created_at: 1 }),
        kind0(PUBKEY, { name: 'new' }, { id: '5'.repeat(64), created_at: 2 }),
        event('6'.repeat(64), { kind: 0, pubkey: VIEWER, content: 'not json' }),
      ],
      aggregates: {},
    });
    const metadata = profileMetadataByPubkey(envelope);
    expect(metadata[PUBKEY]?.name).toBe('new');
    expect(metadata[VIEWER]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Profile-route extensions — search
// ---------------------------------------------------------------------------

describe('profile route reconstruction', () => {
  test('searchHitsFromEnvelope ranks by pubkeys and joins providers + aggregates', () => {
    const envelope = NaggProfilesEnvelopeSchema.parse({
      order: [`9${PUBKEY.slice(1)}`],
      orderBy: 'rank',
      events: [kind0(PUBKEY, { name: 'alice', nip05: 'alice@example.com' })],
      aggregates: { [PUBKEY]: { k3_p_latest: { actors: 42 }, k3_author_latest: { sources: 7 } } },
      pubkeys: [PUBKEY, VIEWER], // VIEWER matched without a local kind-0
      providers: { [PUBKEY]: { vertex: { rank: 90, score: 90.5 } } },
    });
    const hits = searchHitsFromEnvelope(envelope);
    expect(hits.map((h) => h.pubkey)).toEqual([PUBKEY, VIEWER]);
    expect(hits[0]).toMatchObject({
      metadata: { name: 'alice', nip05: 'alice@example.com' },
      rank: 90,
      score: 90.5,
      followers: 42,
      follows: 7,
    });
    expect(hits[1]).toMatchObject({ metadata: {}, rank: null, followers: null });
  });

  test('falls back to the kind-0 order when pubkeys is absent', () => {
    const envelope = NaggProfilesEnvelopeSchema.parse({
      order: [`9${PUBKEY.slice(1)}`],
      orderBy: 'rank',
      events: [kind0(PUBKEY, { name: 'alice' })],
      aggregates: {},
      providers: {},
    });
    expect(searchHitsFromEnvelope(envelope).map((h) => h.pubkey)).toEqual([PUBKEY]);
  });

});

describe('feed continuation capability', () => {
  test.each([true, false, null, undefined])('preserves hasMore=%s independently of cursor', (hasMore) => {
    const envelope = NaggEnvelopeSchema.parse({ hasMore });
    expect(envelope.hasMore).toBe(hasMore);
    expect(envelope.cursor).toBeUndefined();
  });
  test('rejects malformed continuation hints', () => {
    expect(NaggEnvelopeSchema.safeParse({ hasMore: 'false' }).success).toBe(false);
  });
});

describe('events that arrive from the network are checked one by one', () => {
  const good = {
    id: 'a'.repeat(64),
    kind: 1,
    pubkey: 'b'.repeat(64),
    content: 'hello',
    tags: [['e', 'c'.repeat(64)]],
    created_at: 1_700_000_000,
  };
  const ids = (events: unknown[]) => {
    const parsed = NaggEnvelopeSchema.safeParse({ events });
    expect(parsed.success).toBe(true);
    return parsed.success ? parsed.data.events.map((event) => event.id) : [];
  };

  test('one event that does not parse does not cost the page it came on', () => {
    expect(ids([good, { ...good, id: 'not-an-id' }, 'garbage', null])).toEqual([good.id]);
  });

  test.each([
    ['an id that is not 64 lowercase hex characters', { id: 'A'.repeat(64) }],
    ['a public key that is too short', { pubkey: 'b'.repeat(63) }],
    ['content past the ceiling', { content: 'x'.repeat(1_000_001) }],
    ['more tags than any real event carries', { tags: Array.from({ length: 20_001 }, () => ['t']) }],
    ['a tag with too many elements', { tags: [Array.from({ length: 65 }, () => 'x')] }],
    ['a tag element past the ceiling', { tags: [['imeta', 'x'.repeat(65_537)]] }],
  ])('leaves out an event with %s', (_name, change) => {
    expect(ids([{ ...good, ...change }, good])).toEqual([good.id]);
  });

  test('keeps a large but real event: a follow list of five thousand', () => {
    const follows = Array.from({ length: 5_000 }, (_, i) => ['p', i.toString(16).padStart(64, '0')]);
    expect(ids([{ ...good, kind: 3, tags: follows }])).toEqual([good.id]);
  });
});

// ---------------------------------------------------------------------------
// Bounds on what one response may carry: a field that does not fit costs that
// field or that item, never the page.
// ---------------------------------------------------------------------------

describe('bounded envelope fields', () => {
  test('an order element or a pubkey that cannot be one is left out; the rest stay', () => {
    const envelope = NaggProfilesEnvelopeSchema.parse({
      order: [NOTE_ID, 'x'.repeat(513), 7, ROOT_ID],
      orderBy: 'rank',
      events: [],
      aggregates: {},
      pubkeys: [PUBKEY, 'npub1notHex', PUBKEY.toUpperCase(), VIEWER],
    });
    expect(envelope.order).toEqual([NOTE_ID, ROOT_ID]);
    expect(envelope.pubkeys).toEqual([PUBKEY, VIEWER]);
  });

  test('a cursor too long to be one is read as no cursor', () => {
    const parse = (cursor: unknown) =>
      NaggEnvelopeSchema.parse({ order: [], orderBy: 'created_at', events: [], aggregates: {}, cursor });
    expect(parse('1700000000|20').cursor).toBe('1700000000|20');
    expect(parse('c'.repeat(2049)).cursor).toBeNull();
  });

  test('counts are read one id at a time', () => {
    const envelope = NaggEnvelopeSchema.parse({
      order: [],
      orderBy: 'created_at',
      events: [],
      aggregates: {
        [NOTE_ID]: { k7_e: { count: 3 } },
        [ROOT_ID]: { k7_e: { count: 'three' } },
        ['i'.repeat(129)]: { k7_e: { count: 1 } },
        [QUOTED_ID]: 'not counts',
      },
    });
    expect(envelope.aggregates).toEqual({ [NOTE_ID]: { k7_e: { count: 3 } } });
  });

});
