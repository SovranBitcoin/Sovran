/**
 * Pins the parser at the trust boundary between a mint's NUT-06 `contact`
 * array and the wallet's Nostr-profile fetch (audit 60#F-001 / F-002).
 *
 * Two prior implementations had drifted: `shared/lib/getMintCatalog.ts`
 * required canonical 64-char hex, silently dropping pills for any operator
 * publishing `npub1…`; `features/mint/hooks/useMintProfiles.ts` accepted
 * any non-empty string, leaving an impersonation surface on the search
 * screen. The shared helper now accepts hex *or* checksum-validated npub
 * and rejects everything else.
 */

import { nip19 } from 'nostr-tools';

import { extractMintNostrPubkey } from '@/shared/lib/nostr/extractMintNostrPubkey';

const HEX_LOWER = 'deadbeef'.repeat(8);
const HEX_UPPER = HEX_LOWER.toUpperCase();
const NPUB = nip19.npubEncode(HEX_LOWER);

function withNostrContact(info: string) {
  return { contact: [{ method: 'nostr', info }] };
}

describe('extractMintNostrPubkey', () => {
  it('accepts canonical 64-char hex and lowercases it', () => {
    expect(extractMintNostrPubkey(withNostrContact(HEX_LOWER))).toBe(HEX_LOWER);
    expect(extractMintNostrPubkey(withNostrContact(HEX_UPPER))).toBe(HEX_LOWER);
  });

  it('accepts npub1… and decodes to hex (audit 60#F-001 regression case)', () => {
    expect(extractMintNostrPubkey(withNostrContact(NPUB))).toBe(HEX_LOWER);
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(extractMintNostrPubkey(withNostrContact(`  ${HEX_LOWER}  `))).toBe(HEX_LOWER);
    expect(extractMintNostrPubkey(withNostrContact(`\n${NPUB}\n`))).toBe(HEX_LOWER);
  });

  it('rejects npub with bad checksum', () => {
    const bad = NPUB.slice(0, -1) + (NPUB.endsWith('a') ? 'b' : 'a');
    expect(extractMintNostrPubkey(withNostrContact(bad))).toBeUndefined();
  });

  it('rejects wrong-type bech32 prefixes (nsec / note)', () => {
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(1));
    expect(extractMintNostrPubkey(withNostrContact(nsec))).toBeUndefined();
    const note = nip19.noteEncode(HEX_LOWER);
    expect(extractMintNostrPubkey(withNostrContact(note))).toBeUndefined();
  });

  it('rejects 64-char strings with non-hex characters', () => {
    // The same attack shape the secureStorage predicate guards against:
    // length passes, charset does not.
    expect(extractMintNostrPubkey(withNostrContact('z'.repeat(64)))).toBeUndefined();
    const malicious = ('01javascript:alert(1)01' + 'x'.repeat(64)).slice(0, 64);
    expect(malicious).toHaveLength(64);
    expect(extractMintNostrPubkey(withNostrContact(malicious))).toBeUndefined();
  });

  it('rejects LN addresses and URLs', () => {
    expect(extractMintNostrPubkey(withNostrContact('alice@getalby.com'))).toBeUndefined();
    expect(extractMintNostrPubkey(withNostrContact('https://example.com'))).toBeUndefined();
  });

  it('rejects empty and non-string values', () => {
    expect(extractMintNostrPubkey(withNostrContact(''))).toBeUndefined();
    expect(
      extractMintNostrPubkey({ contact: [{ method: 'nostr', info: 123 as unknown as string }] })
    ).toBeUndefined();
  });

  it('returns undefined when contact is missing or wrong-shaped', () => {
    expect(extractMintNostrPubkey(undefined)).toBeUndefined();
    expect(extractMintNostrPubkey(null)).toBeUndefined();
    expect(extractMintNostrPubkey({})).toBeUndefined();
    expect(
      extractMintNostrPubkey({ contact: 'not-an-array' as unknown as MintContactArray })
    ).toBeUndefined();
  });

  it('skips non-nostr methods and returns the first valid nostr contact', () => {
    const second = nip19.npubEncode('a'.repeat(64));
    const info = {
      contact: [
        { method: 'email', info: 'op@example.com' },
        { method: 'nostr', info: NPUB },
        { method: 'nostr', info: second },
      ],
    };
    expect(extractMintNostrPubkey(info)).toBe(HEX_LOWER);
  });
});

type MintContactArray = readonly { method: string; info: string }[];
