import * as nip19 from 'nostr-tools/nip19';

import {
  formatMintInfoNostrFallback,
  getMintInfoNostrContactPubkey,
  getMintInfoNostrDisplayName,
  getSortedMintInfoContacts,
  resolveMintInfoNostrContactPubkey,
} from '@/features/mint/lib/mintInfoContacts';

const PUBKEY = 'deadbeef'.repeat(8);
const NPUB = nip19.npubEncode(PUBKEY);

describe('mint info contacts', () => {
  it('sorts Nostr contacts first while preserving order within groups', () => {
    const contacts = getSortedMintInfoContacts([
      { method: 'email', info: 'op@example.com' },
      { method: 'NOSTR', info: NPUB },
      { method: 'twitter', info: '@operator' },
    ]);

    expect(contacts.map((contact) => contact.method)).toEqual(['NOSTR', 'email', 'twitter']);
  });

  it('extracts the first trusted Nostr pubkey from sorted contact rows', () => {
    const contacts = getSortedMintInfoContacts([
      { method: 'email', info: 'op@example.com' },
      { method: 'nostr', info: NPUB },
    ]);

    expect(getMintInfoNostrContactPubkey(contacts)).toBe(PUBKEY);
  });

  it('falls back to a displayable npub for hex or npub Nostr contacts', () => {
    expect(formatMintInfoNostrFallback(PUBKEY, PUBKEY)).toBe(
      `${NPUB.slice(0, 10)}...${NPUB.slice(-10)}`
    );
    expect(formatMintInfoNostrFallback(NPUB, PUBKEY)).toBe(
      `${NPUB.slice(0, 10)}...${NPUB.slice(-10)}`
    );
  });

  it('prefers profile display names before fallback text', () => {
    expect(getMintInfoNostrDisplayName({ displayName: 'Operator' }, 'npub1...abc')).toBe(
      'Operator'
    );
    expect(getMintInfoNostrDisplayName({ name: 'operator' }, 'npub1...abc')).toBe('operator');
    expect(getMintInfoNostrDisplayName(null, 'npub1...abc')).toBe('npub1...abc');
  });

  describe('resolveMintInfoNostrContactPubkey', () => {
    const OPERATOR = 'ab'.repeat(32);

    it('prefers the NUT-06 contact over the discovered operator', () => {
      const rows = getSortedMintInfoContacts([{ method: 'nostr', info: NPUB }]);
      expect(resolveMintInfoNostrContactPubkey(rows, OPERATOR)).toBe(PUBKEY);
    });

    it('falls back to the discovered operator when the contact is a placeholder', () => {
      // minibits ships the literal `npub…` in its NUT-06 contact.
      const rows = getSortedMintInfoContacts([
        { method: 'nostr', info: 'npub\u2026' },
        { method: 'email', info: 'support@example.com' },
      ]);
      expect(resolveMintInfoNostrContactPubkey(rows, OPERATOR)).toBe(OPERATOR);
      expect(resolveMintInfoNostrContactPubkey(rows, undefined)).toBeUndefined();
    });

    it('never invents a Nostr contact for a mint that publishes none', () => {
      const rows = getSortedMintInfoContacts([{ method: 'email', info: 'support@example.com' }]);
      expect(resolveMintInfoNostrContactPubkey(rows, OPERATOR)).toBeUndefined();
    });
  });
});
