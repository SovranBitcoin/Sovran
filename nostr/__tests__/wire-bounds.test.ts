import { describe, expect, test } from 'vitest';

import {
  NaggEnvelopeSchema,
  NaggProfilesEnvelopeSchema,
  latestKind0ByPubkey,
} from '../src/envelope';
import { supersedes } from '../src/replaceable';
import { coerceTags, toFeedEvent } from '../src/facade/event';
import { PrimalUserProfileContent } from '../src/facade/primal/schemas';
import { NOSTR_EVENT_LIMITS } from '../src/schemas';

// What a relay or a cache hands over is held to the same ceilings as what the
// backend hands over: an event that is not one is refused, and an entry that does
// not fit is left out instead of the whole response.

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

describe('what Primal names in passing', () => {
  test('a profile-stats pubkey that is not a key is read as absent; the counts stay', () => {
    const parsed = PrimalUserProfileContent.parse({ pubkey: 'not-a-key', followers_count: 3 });
    expect(parsed.pubkey).toBeUndefined();
    expect(parsed.followers_count).toBe(3);
  });
});

test('provider figures are read one pubkey at a time', () => {
  const base = { order: [], orderBy: 'rank', events: [], aggregates: {} };
  const profiles = NaggProfilesEnvelopeSchema.parse({
    ...base,
    providers: { [PUBKEY]: { vertex: { rank: 1 } }, 'not-a-key': { vertex: { rank: 2 } }, [ID]: 'nope' },
  });
  expect(profiles.providers).toEqual({ [PUBKEY]: { vertex: { rank: 1 } } });
});

describe('which of two replaceable events stands', () => {
  const older = { id: 'b'.repeat(64), created_at: 100 };
  const newer = { id: 'c'.repeat(64), created_at: 101 };
  const sameSecondLowerId = { id: 'a'.repeat(64), created_at: 100 };

  test('the newer one, and at the same second the lower id, whatever order they arrive in', () => {
    expect(supersedes(newer, older)).toBe(true);
    expect(supersedes(older, newer)).toBe(false);
    expect(supersedes(sameSecondLowerId, older)).toBe(true);
    expect(supersedes(older, sameSecondLowerId)).toBe(false);
    expect(supersedes(older, older)).toBe(false);
  });

  test('the latest profile in an envelope does not depend on arrival order', () => {
    const profile = (id: string) => ({ ...event({ id, kind: 0, created_at: 100 }) });
    const low = profile('1'.repeat(64));
    const high = profile('2'.repeat(64));
    for (const events of [
      [low, high],
      [high, low],
    ]) {
      const envelope = NaggEnvelopeSchema.parse({ order: [], orderBy: 'rank', events, aggregates: {} });
      expect(latestKind0ByPubkey(envelope).get(PUBKEY)?.id).toBe('1'.repeat(64));
    }
  });
});
