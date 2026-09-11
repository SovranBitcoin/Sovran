import {
  changeMute,
  isNewerMuteList,
  moderateFeedItems,
  mutedValues,
  normalizeDmWords,
  reconcileBlockedPeople,
  reportTags,
  shouldCensorDm,
  type MuteList,
} from '../features/feed/lib/moderation';
import type { FeedEvent, FeedItem } from '../features/feed/components/nostr/feedTypes';

const person = 'a'.repeat(64);
const other = 'b'.repeat(64);
const post = 'c'.repeat(64);
const list = (tags: string[][] = [], privateTags: string[][] = []): MuteList => ({
  id: 'd'.repeat(64),
  createdAt: 10,
  tags,
  privateTags,
});

describe('Nostr moderation contracts', () => {
  it('adds new people privately without altering unfamiliar tags or exposing existing private entries', () => {
    const original = list(
      [
        ['t', 'topic'],
        ['client', 'another'],
      ],
      [
        ['word', 'phrase'],
        ['p', other, 'relay'],
      ]
    );
    const changed = changeMute(original, person, true);
    expect(changed.tags).toEqual(original.tags);
    expect(changed.privateTags).toEqual([
      ['word', 'phrase'],
      ['p', other, 'relay'],
      ['p', person],
    ]);
    expect(original.privateTags).toHaveLength(2);
  });
  it('unblocks duplicate public and private entries while preserving other list contents', () => {
    const changed = changeMute(
      list(
        [
          ['p', person, 'relay'],
          ['e', post],
        ],
        [
          ['p', person],
          ['p', other],
        ]
      ),
      person,
      false
    );
    expect(changed.tags).toEqual([['e', post]]);
    expect(changed.privateTags).toEqual([['p', other]]);
  });
  it('does not move an already public block into a duplicate private entry', () => {
    const original = list([['p', person]]);
    expect(changeMute(original, person, true)).toBe(original);
  });
  it('selects newest replaceable events and the lowest ID when timestamps tie', () => {
    expect(isNewerMuteList({ ...list(), createdAt: 9 }, list())).toBe(false);
    expect(isNewerMuteList({ ...list(), createdAt: 11 }, list())).toBe(true);
    expect(isNewerMuteList({ ...list(), id: person }, list())).toBe(true);
    expect(isNewerMuteList(list(), list())).toBe(false);
  });
  it('restores both public and encrypted imported-account blocks, ignoring malformed tags', () => {
    expect(
      mutedValues(
        list(
          [
            ['p', person],
            ['p', 'bad'],
          ],
          [
            ['p', other],
            ['p', person],
          ]
        ),
        'p'
      )
    ).toEqual([person, other]);
  });
  it('applies remote unblocks while preserving unsynchronized local decisions', () => {
    const previous = list([['p', person]]);
    expect(reconcileBlockedPeople([person, other], previous, list(), {})).toEqual([other]);
    expect(reconcileBlockedPeople([person], previous, list(), { [person]: true })).toEqual([
      person,
    ]);
    expect(reconcileBlockedPeople([], null, previous, { [person]: false })).toEqual([]);
  });
  it('rejects an oversized update before an invalid persisted projection can replace blocks', () => {
    const previous = [person];
    expect(() => reconcileBlockedPeople(previous, null, list([['p', other]]), {}, 1)).toThrow();
    expect(previous).toEqual([person]);
  });
  it('reports private-message senders without including a private event ID or message', () => {
    expect(reportTags(person, 'spam')).toEqual([['p', person, 'spam']]);
    expect(reportTags(person, 'illegal', post)).toEqual([
      ['p', person, 'illegal'],
      ['e', post, 'illegal'],
    ]);
    expect(() => reportTags('not-a-key', 'spam')).toThrow();
  });
});

describe('optional DM word filter', () => {
  it('is inactive when disabled and ignores an empty dictionary', () => {
    expect(shouldCensorDm('a bad message', false, ['bad'])).toBe(false);
    expect(shouldCensorDm('anything', true, [])).toBe(false);
  });
  it('normalizes case, whitespace and unicode, and treats punctuation literally', () => {
    const words = normalizeDmWords(' BAD\n\nbad\nＢＡＤ\n[a-z]+\nlong phrase');
    expect(words).toEqual(['bad', '[a-z]+', 'long phrase']);
    expect(shouldCensorDm('a ＢＡＤ message', true, words)).toBe(true);
    expect(shouldCensorDm('abc', true, ['[a-z]+'])).toBe(false);
    expect(shouldCensorDm('a LONG PHRASE here', true, words)).toBe(true);
  });
  it('bounds the dictionary without interpreting regular expressions', () => {
    expect(
      normalizeDmWords(Array.from({ length: 150 }, (_, i) => String(i)).join('\n'))
    ).toHaveLength(100);
    expect(normalizeDmWords('a'.repeat(200))[0]).toHaveLength(100);
  });
});

it('removes blocked authors, reposted originals and parent context before video navigation is built', () => {
  const event = (pubkey: string, id: string): FeedEvent => ({
    pubkey,
    id,
    kind: 1,
    created_at: 1,
    tags: [],
    content: 'https://example.com/video.mp4',
  });
  const blocked = event(person, post);
  const allowed = event(other, 'e'.repeat(64));
  const items: FeedItem[] = [
    { type: 'note', event: blocked, timestamp: 1 },
    { type: 'note', event: allowed, rootEvent: blocked, timestamp: 1 },
    {
      type: 'repost',
      repostEvent: allowed,
      originalEvent: blocked,
      originalEventId: post,
      timestamp: 1,
    },
    { type: 'note', event: allowed, replyPreviewEvents: [blocked], timestamp: 1 },
  ];
  expect(moderateFeedItems(items, [person], [])).toEqual([
    { type: 'note', event: allowed, replyPreviewEvents: [], timestamp: 1 },
  ]);
  expect(moderateFeedItems(items, [], [post])).toHaveLength(1);
  expect(moderateFeedItems(items, [], [])).toBe(items);
});
