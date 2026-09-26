/**
 * @jest-environment node
 *
 * NIP-17 `kind:10050` DM relay-list parse. The distinction that matters here is
 * that an empty result means "do not send" — every caller treats it that way,
 * so the cases that produce one are worth pinning down.
 */

import {
  DM_RELAY_LIST_KIND,
  MAX_DM_RELAYS,
  readDmRelays,
  serializeDmRelayList,
} from '@/shared/lib/nostr/outbox/nip17DmRelays';

describe('readDmRelays', () => {
  it('reads the relay tags of a kind:10050', () => {
    expect(
      readDmRelays({
        tags: [
          ['relay', 'wss://inbox.nostr.wine'],
          ['relay', 'wss://myrelay.nostr1.com'],
        ],
      })
    ).toEqual(['wss://inbox.nostr.wine/', 'wss://myrelay.nostr1.com/']);
  });

  it('uses the NIP-17 `relay` tag, not NIP-65’s `r`', () => {
    expect(readDmRelays({ tags: [['r', 'wss://a.example']] })).toEqual([]);
  });

  it('normalizes and dedupes', () => {
    expect(
      readDmRelays({
        tags: [
          ['relay', 'wss://A.example'],
          ['relay', 'wss://a.example/'],
        ],
      })
    ).toEqual(['wss://a.example/']);
  });

  it('drops unparseable urls rather than passing them to a pool', () => {
    expect(
      readDmRelays({
        tags: [
          ['relay', 'not a url'],
          ['relay', 'wss://ok.example'],
        ],
      })
    ).toEqual(['wss://ok.example/']);
  });

  it('never addresses a gift wrap at a non-websocket scheme', () => {
    expect(readDmRelays({ tags: [['relay', 'javascript:alert(1)']] })).toEqual([]);
    // nostr-tools maps http(s) onto ws(s) rather than rejecting it.
    expect(readDmRelays({ tags: [['relay', 'https://ok.example']] })).toEqual([
      'wss://ok.example/',
    ]);
  });

  it('accepts a schemeless host, as relay lists in the wild are written', () => {
    expect(readDmRelays({ tags: [['relay', 'ok.example']] })).toEqual(['wss://ok.example/']);
  });

  it('caps a bloated list so one DM cannot become a broadcast', () => {
    const tags = Array.from({ length: MAX_DM_RELAYS + 3 }, (_, i) => [
      'relay',
      `wss://r${i}.example`,
    ]);
    expect(readDmRelays({ tags })).toHaveLength(MAX_DM_RELAYS);
  });

  describe('returns [] — which callers must read as "do not send"', () => {
    it.each([
      ['a missing event', null],
      ['an undefined event', undefined],
      ['an event with no tags', {}],
      ['an empty tag list', { tags: [] }],
      ['a list of only unparseable urls', { tags: [['relay', 'not a url']] }],
      ['a relay tag with no value', { tags: [['relay']] }],
      ['non-array tags', { tags: 'wss://a.example' }],
    ])('%s', (_label, event) => {
      expect(readDmRelays(event as never)).toEqual([]);
    });
  });
});

describe('serializeDmRelayList', () => {
  it('round-trips through readDmRelays', () => {
    const urls = ['wss://a.example/', 'wss://b.example/'];
    expect(readDmRelays({ tags: serializeDmRelayList(urls) })).toEqual(urls);
  });

  it('emits NIP-17 `relay` tags', () => {
    expect(serializeDmRelayList(['wss://a.example'])).toEqual([['relay', 'wss://a.example/']]);
  });

  it('drops duplicates and unparseable urls', () => {
    expect(serializeDmRelayList(['wss://a.example', 'wss://A.example/', 'not a url'])).toEqual([
      ['relay', 'wss://a.example/'],
    ]);
  });
});

it('is kind 10050', () => {
  expect(DM_RELAY_LIST_KIND).toBe(10050);
});
