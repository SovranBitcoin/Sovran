/**
 * Pure NIP-65 outbox logic: relay-list parse/serialize and write-relay routing.
 * The NDK url normalizer is mocked to a deterministic lowercase identity so the
 * routing assertions are stable.
 */
/* eslint-disable import/first */

jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    normalizeRelayUrl: (url: string) => {
      const trimmed = url.trim().toLowerCase();
      if (!/^wss?:\/\//.test(trimmed)) throw new Error('invalid');
      return trimmed.replace(/\/+$/, '');
    },
  }),
  { virtual: true }
);

import {
  parseRelayList,
  serializeRelayList,
  readRelays,
  writeRelays,
} from '@/shared/lib/nostr/outbox/nip65';
import { resolveWriteRelays } from '@/shared/lib/nostr/outbox/resolveWriteRelays';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';

describe('nip65 parse/serialize', () => {
  it('parses bare r-tags as read+write', () => {
    const entries = parseRelayList({ tags: [['r', 'wss://A.com']] });
    expect(entries).toEqual([{ url: 'wss://a.com', read: true, write: true }]);
  });

  it('parses read/write markers', () => {
    const entries = parseRelayList({
      tags: [
        ['r', 'wss://read.com', 'read'],
        ['r', 'wss://write.com', 'write'],
      ],
    });
    expect(readRelays(entries)).toEqual(['wss://read.com']);
    expect(writeRelays(entries)).toEqual(['wss://write.com']);
  });

  it('drops unparseable urls and ignores non-r tags', () => {
    const entries = parseRelayList({
      tags: [
        ['r', 'http-not-relay'],
        ['p', 'wss://nope.com'],
        ['r', 'wss://ok.com'],
      ],
    });
    expect(entries.map((e) => e.url)).toEqual(['wss://ok.com']);
  });

  it('last tag wins for a duplicate url', () => {
    const entries = parseRelayList({
      tags: [
        ['r', 'wss://dup.com', 'read'],
        ['r', 'wss://dup.com', 'write'],
      ],
    });
    expect(entries).toEqual([{ url: 'wss://dup.com', read: false, write: true }]);
  });

  it('serialize round-trips: bare for both, marker otherwise', () => {
    const tags = serializeRelayList([
      { url: 'wss://both.com', read: true, write: true },
      { url: 'wss://r.com', read: true, write: false },
      { url: 'wss://w.com', read: false, write: true },
      { url: 'wss://none.com', read: false, write: false },
    ]);
    expect(tags).toEqual([
      ['r', 'wss://both.com'],
      ['r', 'wss://r.com', 'read'],
      ['r', 'wss://w.com', 'write'],
    ]);
  });
});

describe('resolveWriteRelays', () => {
  it('uses own write relays when present', () => {
    const out = resolveWriteRelays({ ownWriteRelays: ['wss://mine.com'] });
    expect(out).toEqual(['wss://mine.com']);
  });

  it('falls back to defaults when own is empty', () => {
    const out = resolveWriteRelays({ ownWriteRelays: [] });
    expect(out).toEqual(DEFAULT_RELAYS.map((r) => r.toLowerCase()));
  });

  it('adds recipient read relays (mention fan-out)', () => {
    const out = resolveWriteRelays({
      ownWriteRelays: ['wss://mine.com'],
      recipients: [{ pubkey: 'p1', readRelays: ['wss://their-inbox.com'] }],
    });
    expect(out).toEqual(expect.arrayContaining(['wss://mine.com', 'wss://their-inbox.com']));
  });

  it('falls back to defaults for a recipient with no known relays', () => {
    const out = resolveWriteRelays({
      ownWriteRelays: ['wss://mine.com'],
      recipients: [{ pubkey: 'p1', readRelays: [] }],
    });
    expect(out).toEqual(expect.arrayContaining(['wss://mine.com', 'wss://relay.damus.io']));
  });

  it('dedupes and caps the fan-out, keeping own relays first', () => {
    const out = resolveWriteRelays({
      ownWriteRelays: ['wss://a.com', 'wss://b.com'],
      recipients: [
        { pubkey: 'p1', readRelays: ['wss://a.com', 'wss://c.com'] },
        { pubkey: 'p2', readRelays: ['wss://d.com', 'wss://e.com', 'wss://f.com'] },
      ],
      hintRelays: ['wss://g.com', 'wss://h.com', 'wss://i.com'],
      maxRelays: 4,
    });
    expect(out).toHaveLength(4);
    expect(out.slice(0, 2)).toEqual(['wss://a.com', 'wss://b.com']);
    expect(new Set(out).size).toBe(4); // no dupes
  });
});
