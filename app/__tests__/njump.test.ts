/**
 * Share-link builders (NIP-21 nostr: URI + njump.me URL wrapping a NIP-19 nevent).
 */
import { buildNjumpUrl, buildNostrUri, buildShareLinks } from '@/shared/lib/nostr/njump';

const HEX = 'a'.repeat(64);
// NIP-19 nevent for id = pubkey = HEX, kind 1, relay hint wss://relay.example.
const NEVENT =
  'nevent1qvzqqqqqqypzp242424242424242424242424242424242424242424242424242qyfhwumn8ghj7un9d3shjtn90psk6urvv5qzp24242424242424242424242424242424242424242424242424277kzud';

describe('njump share links', () => {
  it('builds nostr: and njump urls from an nevent', () => {
    expect(buildNostrUri('nevent1xyz')).toBe('nostr:nevent1xyz');
    expect(buildNjumpUrl('nevent1xyz')).toBe('https://njump.me/nevent1xyz');
  });

  it('encodes a real event into share links', () => {
    expect(buildShareLinks({ id: HEX, pubkey: HEX, kind: 1 }, 'wss://relay.example')).toEqual({
      nevent: NEVENT,
      nostrUri: `nostr:${NEVENT}`,
      njumpUrl: `https://njump.me/${NEVENT}`,
    });
  });

  it('returns null for an unencodable event', () => {
    expect(buildShareLinks({ id: 'not-hex', pubkey: 'x' })).toBeNull();
  });
});
