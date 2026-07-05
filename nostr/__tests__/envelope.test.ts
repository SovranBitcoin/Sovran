import { describe, expect, test } from 'vitest';
import {
  NaggEnvelopeSchema,
  NaggNotificationsEnvelopeSchema,
  NaggProfilesEnvelopeSchema,
  NaggFollowStatusEnvelopeSchema,
  aggregateValue,
  noteMetricsFromAggregates,
  noteStatsFromEnvelope,
  profileCountsFromAggregates,
  profileInfoMapFromEnvelope,
  profileMetadataByPubkey,
  resolveAnchors,
  orderedFeedItemsFromEnvelope,
  feedPageFromEnvelope,
  threadFromEnvelope,
  deriveNotificationReason,
  notificationsPageFromEnvelope,
  parseEnvelopeCursor,
  enrichmentFromEnvelope,
  followStatusRowsFromEnvelope,
  ownProfilesFromEnvelope,
  seenUntilFromEnvelope,
  orderedEnvelopeEvents,
} from '../src/envelope';
import { bundleFromDmEnvelope } from '../src/facade/dm';
import { searchHitsFromEnvelope } from '../src/facade/search';
import { bundleFromFeedPage, statsFromMetrics } from '../src/facade/feed';

const NOTE_ID = 'a'.repeat(64);
const ROOT_ID = 'b'.repeat(64);
const REPOST_ID = 'c'.repeat(64);
const ORIGINAL_ID = 'd'.repeat(64);
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

  test('parses the feed cursor "<until>|<offset>" and rejects opaque cursors gracefully', () => {
    expect(parseEnvelopeCursor('1783180778|2')).toEqual({ until: 1_783_180_778, offset: 2 });
    expect(parseEnvelopeCursor('1783180778')).toEqual({ until: 1_783_180_778, offset: 0 });
    expect(parseEnvelopeCursor('2026-07-03T23:21:35Z|abc')).toBeNull();
    expect(parseEnvelopeCursor(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Aggregates → friendly metrics (zero values omitted server-side → default 0)
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

  test('maps rule names to the friendly note metrics', () => {
    expect(noteMetricsFromAggregates(aggregates, NOTE_ID)).toEqual({
      likeCount: 22,
      repostCount: 4,
      replyCount: 12,
      satsZapped: 2514,
      zapCount: 3,
      quoteCount: 1,
    });
  });

  test('zero-omitted rules default to 0 for unknown ids', () => {
    expect(noteMetricsFromAggregates(aggregates, ROOT_ID)).toEqual({
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      satsZapped: 0,
      zapCount: 0,
      quoteCount: 0,
    });
    expect(aggregateValue(aggregates, ROOT_ID, 'likeCount')).toBeUndefined();
  });

  test('maps pubkey-keyed rules to followers/following/postCount', () => {
    expect(profileCountsFromAggregates(aggregates, PUBKEY)).toEqual({
      followers: 163,
      following: 99,
      postCount: 1234,
    });
    expect(profileCountsFromAggregates(aggregates, VIEWER)).toEqual({
      followers: 0,
      following: 0,
      postCount: 0,
    });
  });

  test('noteStatsFromEnvelope rebuilds the per-id stats map (POST /nostr/events/aggregates)', () => {
    const envelope = NaggEnvelopeSchema.parse({
      order: [],
      orderBy: 'created_at',
      events: [],
      aggregates: { [NOTE_ID]: { k7_e: { actors: 5 }, k9735_e: { sources: 2, value_total: 42 } } },
    });
    const stats = noteStatsFromEnvelope(envelope);
    expect(stats[NOTE_ID]).toMatchObject({
      likeCount: 5,
      repostCount: 0,
      replyCount: 0,
      satsZapped: 42,
      zapCount: 2,
    });
    // …and the shared NoteStats bridge now carries the discrete zap count.
    expect(statsFromMetrics(stats)[NOTE_ID]).toEqual({
      likes: 5,
      reposts: 0,
      replies: 0,
      zaps: 2,
      satsZapped: 42,
    });
  });
});

// ---------------------------------------------------------------------------
// Profile extraction from kind-0 hydration
// ---------------------------------------------------------------------------

describe('profile extraction', () => {
  test('builds the {name, picture} side map from kind-0 events (display_name fallback)', () => {
    const envelope = NaggEnvelopeSchema.parse({
      order: [],
      orderBy: 'created_at',
      events: [
        kind0(PUBKEY, { name: 'alice', picture: 'https://example/pic.png' }),
        kind0(REPOSTER, { display_name: 'Bob', about: 'hi' }),
      ],
      aggregates: {},
    });
    expect(profileInfoMapFromEnvelope(envelope)).toEqual({
      [PUBKEY]: { name: 'alice', picture: 'https://example/pic.png' },
      [REPOSTER]: { name: 'Bob' },
    });
  });

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
// Feed reconstruction — repost anchor resolution
// ---------------------------------------------------------------------------

describe('feed reconstruction', () => {
  // The live shape: order anchors the ORIGINAL id; events carry the kind-6
  // repost, the hydrated original, a plain note (with hydrated root + quoted),
  // and the authors' kind-0 profiles.
  const feedEnvelope = NaggEnvelopeSchema.parse({
    order: [NOTE_ID, ORIGINAL_ID],
    orderBy: 'rank',
    events: [
      event(NOTE_ID, {
        tags: [
          ['e', ROOT_ID, '', 'root'],
          ['q', QUOTED_ID],
        ],
      }),
      event(ROOT_ID, { content: 'root', created_at: 1_699_000_000 }),
      event(QUOTED_ID, { content: 'quoted' }),
      event(REPOST_ID, { kind: 6, pubkey: REPOSTER, content: '', tags: [['e', ORIGINAL_ID]] }),
      event(ORIGINAL_ID, { content: 'original' }),
      kind0(PUBKEY, { name: 'alice' }),
    ],
    aggregates: { [ORIGINAL_ID]: { k7_e: { actors: 7 } } },
    cursor: '1699999000|2',
  });

  test('resolves a repost anchor to { repost, original } keyed by the ORIGINAL id', () => {
    const anchors = resolveAnchors(feedEnvelope);
    expect(anchors[0]).toMatchObject({ kind: 'note', anchorId: NOTE_ID });
    const repost = anchors[1];
    expect(repost).toMatchObject({ kind: 'repost', anchorId: ORIGINAL_ID });
    if (repost.kind !== 'repost') throw new Error('expected repost anchor');
    expect(repost.repost.id).toBe(REPOST_ID);
    expect(repost.original?.id).toBe(ORIGINAL_ID);
  });

  test('an unhydrated repost original still yields the item (original undefined)', () => {
    const envelope = NaggEnvelopeSchema.parse({
      order: [ORIGINAL_ID],
      orderBy: 'created_at',
      events: [event(REPOST_ID, { kind: 6, pubkey: REPOSTER, content: '', tags: [['e', ORIGINAL_ID]] })],
      aggregates: {},
    });
    const [item] = orderedFeedItemsFromEnvelope(envelope);
    expect(item).toMatchObject({ type: 'repost', originalEventId: ORIGINAL_ID, originalEvent: null });
  });

  test('a fully missing anchor is skipped from items but kept in the ordering manifest', () => {
    const envelope = NaggEnvelopeSchema.parse({
      order: [NOTE_ID, '7'.repeat(64)],
      orderBy: 'created_at',
      events: [event(NOTE_ID)],
      aggregates: {},
    });
    const page = feedPageFromEnvelope(envelope);
    expect(page.items).toHaveLength(1);
    expect(page.ordering?.elements).toEqual([NOTE_ID, '7'.repeat(64)]);
    // The facade bundle surfaces the unresolvable id via the manifest.
    const bundle = bundleFromFeedPage(page);
    expect(bundle.manifest.elements).toContain('7'.repeat(64));
    expect(bundle.itemsById.has('7'.repeat(64))).toBe(false);
  });

  test('rebuilds the canonical NaggFeedPage (root, quoted, profiles, metrics, pagination)', () => {
    const page = feedPageFromEnvelope(feedEnvelope);
    expect(page.items).toHaveLength(2);
    const note = page.items[0];
    if (note.type !== 'note') throw new Error('expected note');
    expect(note.rootEventId).toBe(ROOT_ID);
    expect(note.rootEvent?.content).toBe('root');
    const repost = page.items[1];
    if (repost.type !== 'repost') throw new Error('expected repost');
    expect(repost.reposters?.map((r) => r.pubkey)).toEqual([REPOSTER]);
    expect(page.quoted[QUOTED_ID]?.content).toBe('quoted');
    expect(page.profiles[PUBKEY]).toEqual({ name: 'alice' });
    // Aggregated + zero-defaulted metrics for the rendered ids.
    expect(page.metrics[ORIGINAL_ID]?.likeCount).toBe(7);
    expect(page.metrics[NOTE_ID]?.likeCount).toBe(0);
    expect(page.metrics[ROOT_ID]?.likeCount).toBe(0);
    expect(page.paginationUntil).toBe(1_699_999_000);
    expect(page.paginationOffset).toBe(2);
    expect(page.ordering).toEqual({ orderBy: 'rank', elements: [NOTE_ID, ORIGINAL_ID] });
  });
});

// ---------------------------------------------------------------------------
// Thread reconstruction — order[0] is the root
// ---------------------------------------------------------------------------

describe('threadFromEnvelope', () => {
  test('splits root (order[0]) from ranked replies and keeps the reply manifest', () => {
    const envelope = NaggEnvelopeSchema.parse({
      order: [ROOT_ID, NOTE_ID, REPOST_ID],
      orderBy: 'rank',
      events: [
        event(ROOT_ID, { content: 'root' }),
        event(NOTE_ID, { tags: [['e', ROOT_ID, '', 'root']] }),
        event(REPOST_ID, { kind: 1, tags: [['e', ROOT_ID, '', 'root']] }),
        kind0(PUBKEY, { name: 'alice' }),
      ],
      aggregates: { [ROOT_ID]: { k1_1111_e_reply: { sources: 2 } } },
    });
    const thread = threadFromEnvelope(envelope);
    expect(thread).not.toBeNull();
    expect(thread!.root.id).toBe(ROOT_ID);
    expect(thread!.events.map((e) => e.id)).toEqual([NOTE_ID, REPOST_ID]);
    expect(thread!.ordering).toEqual({ orderBy: 'rank', elements: [NOTE_ID, REPOST_ID] });
    expect(thread!.metrics[ROOT_ID]?.replyCount).toBe(2);
    expect(thread!.metrics[NOTE_ID]?.replyCount).toBe(0);
    expect(thread!.profiles[PUBKEY]?.name).toBe('alice');
  });

  test('returns null when the root is missing (caller falls through)', () => {
    const empty = NaggEnvelopeSchema.parse({ order: [], orderBy: 'rank', events: [], aggregates: {} });
    expect(threadFromEnvelope(empty)).toBeNull();
    const unhydrated = NaggEnvelopeSchema.parse({
      order: [ROOT_ID],
      orderBy: 'rank',
      events: [],
      aggregates: {},
    });
    expect(threadFromEnvelope(unhydrated)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Notifications — kind → reason derivation (no server reason strings in v2)
// ---------------------------------------------------------------------------

describe('deriveNotificationReason', () => {
  test('maps the fixed kinds', () => {
    expect(deriveNotificationReason({ kind: 3 }, undefined)).toBe('follow');
    expect(deriveNotificationReason({ kind: 6 }, undefined)).toBe('repost');
    expect(deriveNotificationReason({ kind: 16 }, undefined)).toBe('repost');
    expect(deriveNotificationReason({ kind: 7 }, undefined)).toBe('reaction');
    expect(deriveNotificationReason({ kind: 9735 }, undefined)).toBe('zap');
    expect(deriveNotificationReason({ kind: 30023 }, undefined)).toBeUndefined();
  });

  test('kind 1 splits on tags: q → quote, e at the target → reply, else mention', () => {
    expect(
      deriveNotificationReason({ kind: 1, target: NOTE_ID }, { tags: [['q', NOTE_ID]] }),
    ).toBe('quote');
    expect(
      deriveNotificationReason({ kind: 1, target: NOTE_ID }, { tags: [['e', NOTE_ID, '', 'root']] }),
    ).toBe('reply');
    // No target carried: any e tag reads as a reply, a bare p-mention as mention.
    expect(deriveNotificationReason({ kind: 1 }, { tags: [['e', ROOT_ID]] })).toBe('reply');
    expect(deriveNotificationReason({ kind: 1 }, { tags: [['p', VIEWER]] })).toBe('mention');
  });
});

describe('notificationsPageFromEnvelope', () => {
  const notifEnvelope = NaggNotificationsEnvelopeSchema.parse({
    order: [REPOST_ID, NOTE_ID, QUOTED_ID],
    orderBy: 'created_at',
    events: [
      // grouped follow (kind 3)
      event(REPOST_ID, { kind: 3, pubkey: ACTOR, content: '', created_at: 1_700_000_300 }),
      // reaction on a viewer post
      event(NOTE_ID, { kind: 7, pubkey: ACTOR, content: '+', tags: [['e', ROOT_ID]], created_at: 1_700_000_200 }),
      // reply to a viewer post
      event(QUOTED_ID, { kind: 1, pubkey: ACTOR, tags: [['e', ROOT_ID, '', 'root']], created_at: 1_700_000_100 }),
      // the reacted/replied-to viewer post, hydrated
      event(ROOT_ID, { pubkey: VIEWER, content: 'mine' }),
      kind0(ACTOR, { name: 'carol' }),
    ],
    aggregates: {},
    entries: [
      {
        id: REPOST_ID,
        kind: 3,
        actor: ACTOR,
        actors: [
          { pubkey: ACTOR, eventId: REPOST_ID, createdAt: 1_700_000_300, actorVertexScore: 0.9 },
          { pubkey: VIEWER, eventId: '8'.repeat(64), createdAt: 1_700_000_250 },
        ],
      },
      {
        id: NOTE_ID,
        kind: 7,
        actor: ACTOR,
        target: ROOT_ID,
        total: 5,
        totalCapped: true,
        actors: [{ pubkey: ACTOR, eventId: NOTE_ID, createdAt: 1_700_000_200 }],
      },
      { id: QUOTED_ID, kind: 1, actor: ACTOR, target: ROOT_ID },
      // entry whose event was not hydrated → dropped
      { id: '7'.repeat(64), kind: 7, actor: ACTOR },
    ],
    hasNext: true,
  });

  test('maps entries to v1 notification nodes with derived reasons + grouping', () => {
    const page = notificationsPageFromEnvelope(notifEnvelope);
    expect(page.notifications.nodes.map((n) => n.reason)).toEqual(['follow', 'reaction', 'reply']);
    const [follow, reaction, reply] = page.notifications.nodes;
    expect(follow).toMatchObject({ type: 'group', total: 2 });
    expect(follow.sampleActors?.[0]).toMatchObject({ pubkey: ACTOR, actorVertexScore: 0.9 });
    expect(follow.actorVertexScore).toBe(0.9);
    expect(reaction).toMatchObject({
      type: 'group',
      total: 5,
      totalCapped: true,
      targetEventId: ROOT_ID,
    });
    expect(reaction.targetEvent?.content).toBe('mine');
    expect(reply).toMatchObject({ type: 'single', targetEventId: ROOT_ID });
    expect(page.notifications.pageInfo?.hasNextPage).toBe(true);
    expect(page.profiles[ACTOR]?.name).toBe('carol');
    // Target metrics are zero-defaulted even though aggregates were omitted.
    expect(page.metrics[ROOT_ID]?.likeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DM privacy shape — no aggregates, no profiles, raw wraps only
// ---------------------------------------------------------------------------

describe('DM envelopes', () => {
  test('bundles raw wraps and never carries aggregates/profile hydration', () => {
    const wrap = event('8'.repeat(64), { kind: 1059, pubkey: ACTOR, content: 'ciphertext', tags: [['p', VIEWER]] });
    const envelope = NaggEnvelopeSchema.parse({
      order: ['8'.repeat(64)],
      orderBy: 'created_at',
      events: [wrap],
      aggregates: {}, // by design: DM envelopes carry no aggregates
    });
    expect(envelope.aggregates).toEqual({});
    expect(envelope.events.some((e) => e.kind === 0)).toBe(false);

    const bundle = bundleFromDmEnvelope(envelope);
    expect(bundle.envelopes).toHaveLength(1);
    expect(bundle.envelopes[0]).toMatchObject({
      id: '8'.repeat(64),
      kind: 1059,
      content: 'ciphertext',
      createdAt: 1_700_000_000,
    });
    expect(bundle.cursor).toEqual({ createdAt: 1_700_000_000, id: '8'.repeat(64) });
  });

  test('an empty DM envelope (no order, no cursor) yields an empty bundle', () => {
    const envelope = NaggEnvelopeSchema.parse({ order: [], orderBy: 'created_at', events: [], aggregates: {} });
    expect(bundleFromDmEnvelope(envelope)).toEqual({ envelopes: [], cursor: null });
  });
});

// ---------------------------------------------------------------------------
// Profile-route extensions — search / follow-status / own-profiles / seen
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

  test('followStatusRowsFromEnvelope derives mutual = out && in', () => {
    const envelope = NaggFollowStatusEnvelopeSchema.parse({
      order: [],
      orderBy: 'created_at',
      events: [],
      aggregates: {},
      edges: {
        [PUBKEY]: { out: true, in: true },
        [VIEWER]: { out: true, in: false },
        [ACTOR]: { out: false, in: false },
      },
    });
    const byPubkey = Object.fromEntries(followStatusRowsFromEnvelope(envelope).map((r) => [r.pubkey, r]));
    expect(byPubkey[PUBKEY]).toMatchObject({ mutual: true, relationship: 'mutual' });
    expect(byPubkey[VIEWER]).toMatchObject({ following: true, followsYou: false, relationship: 'following' });
    expect(byPubkey[ACTOR]).toMatchObject({ relationship: 'none' });
  });

  test('ownProfilesFromEnvelope joins kind-0 metadata with follower aggregates', () => {
    const envelope = NaggProfilesEnvelopeSchema.parse({
      order: [],
      orderBy: 'created_at',
      events: [kind0(PUBKEY, { name: 'alice' })],
      aggregates: { [PUBKEY]: { k3_p_latest: { actors: 10 }, k3_author_latest: { sources: 20 } } },
    });
    const rows = ownProfilesFromEnvelope(envelope);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pubkey: PUBKEY, name: 'alice', followers: 10, follows: 20 });
  });

  test('seenUntilFromEnvelope parses the kind-30078 marker content', () => {
    const marker = (content: string) =>
      NaggEnvelopeSchema.parse({
        order: [],
        orderBy: 'created_at',
        events: [event('8'.repeat(64), { kind: 30078, pubkey: VIEWER, content })],
        aggregates: {},
      });
    expect(seenUntilFromEnvelope(marker('1700000123'))).toBe(1_700_000_123);
    expect(seenUntilFromEnvelope(marker('{"seenUntil":1700000456}'))).toBe(1_700_000_456);
    expect(seenUntilFromEnvelope(marker('junk'))).toBeNull();
    const empty = NaggEnvelopeSchema.parse({ order: [], orderBy: 'created_at', events: [], aggregates: {} });
    expect(seenUntilFromEnvelope(empty)).toBeNull();
  });

  test('enrichmentFromEnvelope splits profiles from the requested events', () => {
    const envelope = NaggEnvelopeSchema.parse({
      order: [NOTE_ID],
      orderBy: 'created_at',
      events: [event(NOTE_ID), kind0(PUBKEY, { name: 'alice' })],
      aggregates: { [NOTE_ID]: { k7_e: { actors: 2 } } },
    });
    const enrichment = enrichmentFromEnvelope(envelope);
    expect(enrichment.quoted[NOTE_ID]?.id).toBe(NOTE_ID);
    expect(Object.keys(enrichment.quoted)).toHaveLength(1); // no kind-0 leakage
    expect(enrichment.profiles[PUBKEY]?.name).toBe('alice');
    expect(enrichment.metrics[NOTE_ID]?.likeCount).toBe(2);
  });

  test('orderedEnvelopeEvents resolves order, skipping unhydrated ids', () => {
    const envelope = NaggEnvelopeSchema.parse({
      order: [NOTE_ID, ROOT_ID],
      orderBy: 'created_at',
      events: [event(NOTE_ID), kind0(PUBKEY, { name: 'x' })],
      aggregates: {},
    });
    expect(orderedEnvelopeEvents(envelope).map((e) => e.id)).toEqual([NOTE_ID]);
  });
});
