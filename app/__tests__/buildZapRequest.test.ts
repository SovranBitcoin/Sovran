/**
 * @jest-environment node
 *
 * NIP-57 kind-9734 zap request builder. The two invariants that break interop
 * in the wild: the relays tag must be ONE FLAT tag (["relays", url, url, ...],
 * not nested arrays), and the amount tag must be the millisat string that the
 * LNURL callback's ?amount= param carries. A 9734 is signed but never
 * published — this file also guards that the builder module can't reach the
 * publish seam.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { bech32 } from '@scure/base';
import {
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  type Event as NostrEvent,
} from 'nostr-tools';

import { buildSignedZapRequestJson, lnurlBech32 } from '@/shared/lib/nostr/zap/buildZapRequest';

const RECIPIENT = 'f'.repeat(64);
const EVENT_ID = 'e'.repeat(64);

function buildDefault(overrides: Record<string, unknown> = {}): NostrEvent {
  const privateKey = generateSecretKey();
  const json = buildSignedZapRequestJson({
    privateKey,
    recipientPubkeyHex: RECIPIENT,
    eventId: EVENT_ID,
    eventKind: 1,
    amountMsats: 21_000,
    relays: ['wss://relay.one', 'wss://relay.two'],
    lnurl: 'lnurl1abc',
    content: 'Great post 👍',
    ...overrides,
  });
  return JSON.parse(json) as NostrEvent;
}

describe('buildSignedZapRequestJson', () => {
  it('produces a valid signed kind-9734 event', () => {
    const privateKey = generateSecretKey();
    const event = JSON.parse(
      buildSignedZapRequestJson({
        privateKey,
        recipientPubkeyHex: RECIPIENT,
        eventId: EVENT_ID,
        eventKind: 1,
        amountMsats: 21_000,
        relays: ['wss://relay.one'],
        content: 'Great post 👍',
      })
    ) as NostrEvent;

    expect(event.kind).toBe(9734);
    expect(event.pubkey).toBe(getPublicKey(privateKey));
    expect(event.content).toBe('Great post 👍');
    expect(verifyEvent(event)).toBe(true);
  });

  it('emits ONE FLAT relays tag — the classic interop bug is nesting the urls', () => {
    const event = buildDefault();
    const relayTags = event.tags.filter((t) => t[0] === 'relays');
    expect(relayTags).toEqual([['relays', 'wss://relay.one', 'wss://relay.two']]);
  });

  it('emits exactly one p tag and at most one e tag, plus k and lnurl', () => {
    const event = buildDefault();
    expect(event.tags.filter((t) => t[0] === 'p')).toEqual([['p', RECIPIENT]]);
    expect(event.tags.filter((t) => t[0] === 'e')).toEqual([['e', EVENT_ID]]);
    expect(event.tags.filter((t) => t[0] === 'k')).toEqual([['k', '1']]);
    expect(event.tags.filter((t) => t[0] === 'lnurl')).toEqual([['lnurl', 'lnurl1abc']]);
  });

  it('amount tag is the millisat string matching the callback ?amount= param', () => {
    const event = buildDefault({ amountMsats: 100_000 });
    expect(event.tags.filter((t) => t[0] === 'amount')).toEqual([['amount', '100000']]);
  });

  it('omits e/k/lnurl for a profile zap without an event', () => {
    const event = buildDefault({ eventId: undefined, eventKind: undefined, lnurl: undefined });
    expect(event.tags.some((t) => t[0] === 'e')).toBe(false);
    expect(event.tags.some((t) => t[0] === 'k')).toBe(false);
    expect(event.tags.some((t) => t[0] === 'lnurl')).toBe(false);
  });

  it('caps the relays tag to 10 urls to bound the callback query string', () => {
    const relays = Array.from({ length: 20 }, (_, i) => `wss://relay-${i}.example`);
    const event = buildDefault({ relays });
    const relayTag = event.tags.find((t) => t[0] === 'relays')!;
    expect(relayTag).toHaveLength(11); // 'relays' + 10 urls
  });
});

describe('lnurlBech32', () => {
  it('encodes a pay URL to a decodable lnurl1 string', () => {
    const url = 'https://example.com/.well-known/lnurlp/alice';
    const encoded = lnurlBech32(url);
    expect(encoded).toMatch(/^lnurl1/);
    const decoded = bech32.decode(encoded as `lnurl1${string}`, 2000);
    expect(new TextDecoder().decode(new Uint8Array(bech32.fromWords(decoded.words)))).toBe(url);
  });

  it('returns undefined on empty input (tag is optional per spec)', () => {
    expect(lnurlBech32('')).toBeUndefined();
  });
});

describe('9734 never reaches relays', () => {
  it('buildZapRequest.ts does not import the publishEvent seam', () => {
    const source = readFileSync(
      resolve(__dirname, '../shared/lib/nostr/zap/buildZapRequest.ts'),
      'utf8'
    );
    const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line));
    expect(importLines.some((line) => line.includes('publish'))).toBe(false);
  });
});
