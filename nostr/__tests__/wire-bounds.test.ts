import { describe, expect, test } from 'vitest';

import { NaggFollowStatusEnvelopeSchema, NaggProfilesEnvelopeSchema } from '../src/envelope';
import { coerceTags, toFeedEvent } from '../src/facade/event';
import { DiscoverMintsResponseSchema, MintReviewsResponseSchema } from '../src/facade/mint-reviews';
import {
  PrimalFeedRangeContent,
  PrimalNoteStatsContent,
  PrimalNotificationContent,
} from '../src/facade/primal/schemas';
import { NOSTR_EVENT_LIMITS, NaggProfileInfoSchema, NaggServiceInfoSchema } from '../src/schemas';

// What a relay or a cache hands over is held to the same ceilings as what the
// backend hands over: an event that is not one is refused, and a list of names
// loses the name that does not fit instead of the whole response.

const ID = 'a'.repeat(64);
const PUBKEY = 'b'.repeat(64);
const event = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  pubkey: PUBKEY,
  kind: 1,
  content: 'gm',
  tags: [['e', ID]],
  created_at: 1_700_000_000,
  ...overrides,
});

describe('an event off a relay or a cache socket', () => {
  test('is kept as it is when well formed', () => {
    expect(toFeedEvent(event())).toEqual(event());
  });

  test.each([
    ['an id that is not hex', { id: 'note-1' }],
    ['an id in upper case', { id: ID.toUpperCase() }],
    ['a short pubkey', { pubkey: 'b'.repeat(63) }],
    ['a pubkey that is not a string', { pubkey: 7 }],
    ['a kind that is not a number', { kind: '1' }],
    ['content over the ceiling', { content: 'x'.repeat(NOSTR_EVENT_LIMITS.content + 1) }],
  ])('is refused with %s', (_what, overrides) => {
    expect(toFeedEvent(event(overrides) as never)).toBeNull();
  });

  test('keeps content exactly at the ceiling', () => {
    const content = 'x'.repeat(NOSTR_EVENT_LIMITS.content);
    expect(toFeedEvent(event({ content }))?.content).toHaveLength(NOSTR_EVENT_LIMITS.content);
  });

  test('drops a tag that is malformed or over a ceiling and keeps the others', () => {
    const long = 'x'.repeat(NOSTR_EVENT_LIMITS.tagElement + 1);
    const wide = Array.from({ length: NOSTR_EVENT_LIMITS.tagElements + 1 }, () => 'a');
    expect(coerceTags([['e', ID], ['p', 7], ['imeta', long], wide, 'not a tag', ['p', PUBKEY]])).toEqual([
      ['e', ID],
      ['p', PUBKEY],
    ]);
  });

  test('reads no more tags than one event may carry', () => {
    const tags = Array.from({ length: NOSTR_EVENT_LIMITS.tags + 5 }, (_, n) => ['p', String(n)]);
    expect(coerceTags(tags)).toHaveLength(NOSTR_EVENT_LIMITS.tags);
  });
});

describe('the capability probe', () => {
  const info = (overrides: Record<string, unknown> = {}) => ({
    graphqlSchemaVersion: '1',
    appViewVersion: 'v2',
    capabilities: ['graphql.events', 'app.rates'],
    appViews: [{ version: 'v2', routes: ['/nostr/capabilities', '/nostr/profile'] }],
    ...overrides,
  });

  test('reads the live shape unchanged', () => {
    expect(NaggServiceInfoSchema.parse(info())).toEqual(info());
  });

  test('leaves out a name that is not a short string and keeps the rest', () => {
    const parsed = NaggServiceInfoSchema.parse(
      info({
        capabilities: ['graphql.events', 7, 'c'.repeat(257), 'app.rates'],
        appViews: [{ version: 'v2', routes: ['/nostr/profile', null, 'r'.repeat(257)] }],
      }),
    );
    expect(parsed.capabilities).toEqual(['graphql.events', 'app.rates']);
    expect(parsed.appViews[0]?.routes).toEqual(['/nostr/profile']);
  });

  test('reads no more names than the ceiling', () => {
    const capabilities = Array.from({ length: 5000 }, (_, n) => `capability.${n}`);
    expect(NaggServiceInfoSchema.parse(info({ capabilities })).capabilities).toHaveLength(4096);
  });
});

test('an oversized profile name or picture is dropped on its own', () => {
  expect(NaggProfileInfoSchema.parse({ name: 'n'.repeat(257), picture: 'https://x/p.png' })).toEqual({
    name: '',
    picture: 'https://x/p.png',
  });
  expect(NaggProfileInfoSchema.parse({ name: 'alice', picture: 'p'.repeat(2049) })).toEqual({
    name: 'alice',
  });
});

describe('mint directory and reviews from the backend', () => {
  const mint = { mintUrl: 'https://mint.example', averageScore: 4, reviewCount: 2 };

  test('one mint row that does not parse is left out of the directory', () => {
    const parsed = DiscoverMintsResponseSchema.parse({
      mints: [
        mint,
        { ...mint, mintUrl: 'https://two.example', operatorPubkey: 'npub1notHex', name: 'n'.repeat(257) },
        { ...mint, mintUrl: 7 },
        'not a mint',
      ],
      profiles: { [PUBKEY]: { name: 'Operator' }, other: 'not a profile' },
    });
    expect(parsed.mints.map((each) => each.mintUrl)).toEqual([
      'https://mint.example',
      'https://two.example',
    ]);
    // The row is kept; only the fields that did not fit are gone.
    expect(parsed.mints[1]?.operatorPubkey).toBeUndefined();
    expect(parsed.mints[1]?.name).toBeUndefined();
    expect(parsed.profiles).toEqual({ [PUBKEY]: { name: 'Operator' } });
  });

  test('one review without hex ids is left out', () => {
    const review = { eventId: ID, reviewerPubkey: PUBKEY, mintUrl: mint.mintUrl, score: 5, content: 'ok', createdAt: 1 };
    const parsed = MintReviewsResponseSchema.parse({
      summary: mint,
      reviews: [review, { ...review, eventId: 'e1' }, { ...review, reviewerPubkey: 'someone' }],
    });
    expect(parsed.reviews).toEqual([review]);
  });
});

describe('what Primal names in passing', () => {
  test('an ordering element that is not an event id is left out of the order', () => {
    expect(PrimalFeedRangeContent.parse({ elements: [ID, 'not-an-id', 7, PUBKEY] }).elements).toEqual([
      ID,
      PUBKEY,
    ]);
  });

  test('counts need an event id; a notification keeps going without a bad reference', () => {
    expect(PrimalNoteStatsContent.safeParse({ event_id: 'note-1', likes: 3 }).success).toBe(false);
    const parsed = PrimalNotificationContent.parse({
      pubkey: PUBKEY,
      created_at: 1,
      type: 1,
      follower: 'not-a-key',
      your_post: ID,
    });
    expect(parsed.follower).toBeUndefined();
    expect(parsed.your_post).toBe(ID);
  });
});

test('provider figures and follow edges are read one pubkey at a time', () => {
  const base = { order: [], orderBy: 'rank', events: [], aggregates: {} };
  const profiles = NaggProfilesEnvelopeSchema.parse({
    ...base,
    providers: { [PUBKEY]: { vertex: { rank: 1 } }, 'not-a-key': { vertex: { rank: 2 } }, [ID]: 'nope' },
  });
  expect(profiles.providers).toEqual({ [PUBKEY]: { vertex: { rank: 1 } } });
  const follows = NaggFollowStatusEnvelopeSchema.parse({
    ...base,
    edges: { [PUBKEY]: { out: true, in: false }, 'not-a-key': { out: true, in: true }, [ID]: { out: 'yes' } },
  });
  expect(follows.edges).toEqual({ [PUBKEY]: { out: true, in: false } });
});
