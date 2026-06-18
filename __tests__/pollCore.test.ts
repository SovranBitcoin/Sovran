/**
 * NIP-88 poll core: parse kind:1068, tally kind:1018 (latest-per-pubkey,
 * endsAt cutoff, single vs multi, unknown-option filtering), and event builders.
 */
import {
  parsePoll,
  tallyPoll,
  isPollClosed,
  POLL_KIND,
  POLL_VOTE_KIND,
} from '@/features/feed/components/nostr/poll/pollParse';
import {
  buildPollEvent,
  buildVoteEvent,
} from '@/features/feed/components/nostr/poll/buildPollEvents';

const pollEvent = {
  id: 'poll1',
  pubkey: 'author',
  content: 'Best color?',
  tags: [
    ['option', 'r', 'Red'],
    ['option', 'g', 'Green'],
    ['option', 'b', 'Blue'],
    ['polltype', 'singlechoice'],
    ['endsAt', '2000'],
    ['relay', 'wss://relay.example'],
  ],
};

const vote = (pubkey: string, createdAt: number, ...responses: string[]) => ({
  pubkey,
  created_at: createdAt,
  tags: [['e', 'poll1'], ...responses.map((r) => ['response', r])],
});

describe('parsePoll', () => {
  it('parses options, type, endsAt, relays', () => {
    const poll = parsePoll(pollEvent);
    expect(poll.options).toEqual([
      { id: 'r', label: 'Red' },
      { id: 'g', label: 'Green' },
      { id: 'b', label: 'Blue' },
    ]);
    expect(poll.pollType).toBe('singlechoice');
    expect(poll.endsAt).toBe(2000);
    expect(poll.relays).toEqual(['wss://relay.example']);
    expect(poll.question).toBe('Best color?');
  });

  it('defaults to singlechoice and no expiry', () => {
    const poll = parsePoll({ id: 'p', tags: [['option', 'a', 'A']] });
    expect(poll.pollType).toBe('singlechoice');
    expect(poll.endsAt).toBeUndefined();
  });
});

describe('tallyPoll', () => {
  it('counts the latest vote per pubkey', () => {
    const poll = parsePoll(pollEvent);
    const tally = tallyPoll(
      poll,
      [vote('alice', 100, 'r'), vote('alice', 200, 'g'), vote('bob', 150, 'g')],
      'alice'
    );
    expect(tally.counts).toEqual({ r: 0, g: 2, b: 0 });
    expect(tally.total).toBe(2);
    expect(tally.myVote).toEqual(['g']);
  });

  it('drops votes after endsAt', () => {
    const poll = parsePoll(pollEvent); // endsAt 2000
    const tally = tallyPoll(poll, [vote('alice', 3000, 'r')]);
    expect(tally.total).toBe(0);
  });

  it('keeps only the first response for single-choice', () => {
    const poll = parsePoll(pollEvent);
    const tally = tallyPoll(poll, [vote('alice', 100, 'r', 'g')]);
    expect(tally.counts.r).toBe(1);
    expect(tally.counts.g).toBe(0);
  });

  it('counts all responses for multiple-choice and ignores unknown options', () => {
    const poll = parsePoll({
      ...pollEvent,
      tags: [...pollEvent.tags.slice(0, 3), ['polltype', 'multiplechoice']],
    });
    const tally = tallyPoll(poll, [vote('alice', 100, 'r', 'g', 'unknown')]);
    expect(tally.counts.r).toBe(1);
    expect(tally.counts.g).toBe(1);
    expect(tally.total).toBe(1);
  });

  it('isPollClosed reflects endsAt', () => {
    const poll = parsePoll(pollEvent);
    expect(isPollClosed(poll, 1999)).toBe(false);
    expect(isPollClosed(poll, 2001)).toBe(true);
  });
});

describe('poll event builders', () => {
  it('builds a kind:1068 poll', () => {
    const event = buildPollEvent({
      question: 'Q?',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      pollType: 'singlechoice',
      endsAt: 1234,
      relays: ['wss://r'],
      createdAt: 1,
    });
    expect(event.kind).toBe(POLL_KIND);
    expect(event.content).toBe('Q?');
    expect(event.tags).toEqual([
      ['option', 'a', 'A'],
      ['option', 'b', 'B'],
      ['polltype', 'singlechoice'],
      ['endsAt', '1234'],
      ['relay', 'wss://r'],
    ]);
  });

  it('builds a quoted poll with q and p tags', () => {
    const event = buildPollEvent({
      question: 'Q?',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      pollType: 'singlechoice',
      relays: ['wss://r'],
      quote: {
        eventId: 'quoted-event',
        relayHint: 'wss://quote.example',
        pubkey: 'quote-author',
      },
      createdAt: 1,
    });

    expect(event.tags).toEqual(
      expect.arrayContaining([
        ['q', 'quoted-event', 'wss://quote.example', 'quote-author'],
        ['p', 'quote-author'],
      ])
    );
  });

  it('builds a kind:1018 vote', () => {
    const event = buildVoteEvent({ pollId: 'poll1', optionIds: ['a', 'b'], createdAt: 1 });
    expect(event.kind).toBe(POLL_VOTE_KIND);
    expect(event.tags).toEqual([
      ['e', 'poll1', ''],
      ['response', 'a'],
      ['response', 'b'],
    ]);
  });
});
