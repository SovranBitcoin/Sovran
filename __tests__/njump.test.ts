/**
 * Share-link builders (NIP-21 nostr: URI + njump.me URL wrapping a NIP-19 nevent).
 */
import { buildNjumpUrl, buildNostrUri, buildShareLinks } from '@/shared/lib/nostr/njump';

const HEX = 'a'.repeat(64);

describe('njump share links', () => {
  it('builds nostr: and njump urls from an nevent', () => {
    expect(buildNostrUri('nevent1xyz')).toBe('nostr:nevent1xyz');
    expect(buildNjumpUrl('nevent1xyz')).toBe('https://njump.me/nevent1xyz');
  });

  it('encodes a real event into share links', () => {
    const links = buildShareLinks({ id: HEX, pubkey: HEX, kind: 1 }, 'wss://relay.example');
    expect(links).not.toBeNull();
    expect(links?.nevent.startsWith('nevent1')).toBe(true);
    expect(links?.nostrUri).toBe(`nostr:${links?.nevent}`);
    expect(links?.njumpUrl).toBe(`https://njump.me/${links?.nevent}`);
  });

  it('returns null for an unencodable event', () => {
    expect(buildShareLinks({ id: 'not-hex', pubkey: 'x' })).toBeNull();
  });
});
