/**
 * Pure NIP-65 outbox logic: relay-list parse/serialize,
 * over the real relay url normalizer (lowercase host, canonical trailing slash).
 */
import {
  parseRelayList,
  serializeRelayList,
  readRelays,
  writeRelays,
} from '@/shared/lib/nostr/outbox/nip65';

describe('nip65 parse/serialize', () => {
  it('parses bare r-tags as read+write', () => {
    const entries = parseRelayList({ tags: [['r', 'wss://A.com/']] });
    expect(entries).toEqual([{ url: 'wss://a.com/', read: true, write: true }]);
  });

  it('parses read/write markers', () => {
    const entries = parseRelayList({
      tags: [
        ['r', 'wss://read.com/', 'read'],
        ['r', 'wss://write.com/', 'write'],
      ],
    });
    expect(readRelays(entries)).toEqual(['wss://read.com/']);
    expect(writeRelays(entries)).toEqual(['wss://write.com/']);
  });

  it('drops unparseable urls and ignores non-r tags', () => {
    const entries = parseRelayList({
      tags: [
        ['r', 'http-not-relay'],
        ['p', 'wss://nope.com/'],
        ['r', 'wss://ok.com/'],
      ],
    });
    expect(entries.map((e) => e.url)).toEqual(['wss://ok.com/']);
  });

  it('last tag wins for a duplicate url', () => {
    const entries = parseRelayList({
      tags: [
        ['r', 'wss://dup.com/', 'read'],
        ['r', 'wss://dup.com/', 'write'],
      ],
    });
    expect(entries).toEqual([{ url: 'wss://dup.com/', read: false, write: true }]);
  });

  it('serialize round-trips: bare for both, marker otherwise', () => {
    const tags = serializeRelayList([
      { url: 'wss://both.com/', read: true, write: true },
      { url: 'wss://r.com/', read: true, write: false },
      { url: 'wss://w.com/', read: false, write: true },
      { url: 'wss://none.com/', read: false, write: false },
    ]);
    expect(tags).toEqual([
      ['r', 'wss://both.com/'],
      ['r', 'wss://r.com/', 'read'],
      ['r', 'wss://w.com/', 'write'],
    ]);
  });
});
