import {
  clearProfileFeedSeeds,
  peekProfileFeedSeed,
  seedProfileFeed,
} from '@/features/feed/lib/profileFeedSeedCache';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const ev = (id: string, pubkey: string, kind: number, created_at: number): FeedEvent => ({
  id,
  pubkey,
  kind,
  content: '',
  tags: [],
  created_at,
});

beforeEach(() => clearProfileFeedSeeds());

it("seeds only the author's kind-1 notes, newest first, as a partial page", () => {
  seedProfileFeed(A, {
    allEvents: new Map([
      ['1', ev('1', A, 1, 10)],
      ['2', ev('2', B, 1, 20)],
      ['3', ev('3', A, 1, 30)],
      ['4', ev('4', A, 6, 40)], // repost event: not a note
    ]),
    profiles: new Map([[A, { name: 'alice' }]]),
    metrics: new Map(),
    quotedEvents: new Map(),
  });
  const seed = peekProfileFeedSeed(A);
  expect(seed?.orderedFeedItems.map((i) => (i.type === 'note' ? i.event.id : ''))).toEqual([
    '3',
    '1',
  ]);
  expect(seed?.paginationUntil).toBe(0);
  expect(seed?.profilesMap.get(A)?.name).toBe('alice');
  // Peeked, not consumed: a second render still sees it.
  expect(peekProfileFeedSeed(A)).toBe(seed);
});

it('stores nothing when the context has no note by the author', () => {
  seedProfileFeed(A, {
    allEvents: new Map([['2', ev('2', B, 1, 20)]]),
    profiles: new Map(),
    metrics: new Map(),
    quotedEvents: new Map(),
  });
  expect(peekProfileFeedSeed(A)).toBeUndefined();
  seedProfileFeed(A, null);
  expect(peekProfileFeedSeed(A)).toBeUndefined();
});
