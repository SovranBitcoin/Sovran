import * as nip19 from 'nostr-tools/nip19';

import {
  formatMintInfoNostrFallback,
  getMintInfoNostrContactPubkey,
  getMintInfoNostrCopyValue,
  getMintInfoNostrDisplayName,
  getSortedMintInfoContacts,
  resolveMintInfoContactIdentity,
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
      `${NPUB.slice(0, 8)}…${NPUB.slice(-8)}`
    );
    expect(formatMintInfoNostrFallback(NPUB, PUBKEY)).toBe(`${NPUB.slice(0, 8)}…${NPUB.slice(-8)}`);
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

    it('rejects a placeholder or malformed discovered operator and decodes valid npub', () => {
      const rows = getSortedMintInfoContacts([{ method: 'nostr', info: 'npub\u2026' }]);
      expect(resolveMintInfoNostrContactPubkey(rows, 'npub\u2026')).toBeUndefined();
      expect(resolveMintInfoNostrContactPubkey(rows, '12345')).toBeUndefined();
      expect(resolveMintInfoNostrContactPubkey(rows, NPUB)).toBe(PUBKEY);
    });
  });

  it('never throws when formatMintInfoNostrFallback receives a non-hex pubkey like "npub…"', () => {
    expect(() => formatMintInfoNostrFallback('npub\u2026', 'npub\u2026')).not.toThrow();
    expect(formatMintInfoNostrFallback('npub\u2026', 'npub\u2026')).toBe('npub\u2026');
    expect(formatMintInfoNostrFallback('custom', '12345')).toBe('custom');
  });

  it('returns the full npub to copy from hex or npub contacts without throwing on placeholders', () => {
    expect(getMintInfoNostrCopyValue(PUBKEY, PUBKEY)).toBe(NPUB);
    expect(getMintInfoNostrCopyValue(NPUB, PUBKEY)).toBe(NPUB);
    expect(getMintInfoNostrCopyValue('npub\u2026', 'npub\u2026')).toBe('npub\u2026');
  });
});

describe('mint info operator contact identity', () => {
  const mint = { name: 'Cool Mint', iconUrl: 'https://mint.example/icon.png' };

  it('prefers the operator Nostr name and picture', () => {
    expect(
      resolveMintInfoContactIdentity({
        profile: { displayName: 'Op', picture: 'https://op.example/p.png' },
        fallbackTitle: 'npub1…',
        loading: false,
        mint,
      })
    ).toEqual({ title: 'Op', picture: 'https://op.example/p.png' });
  });

  it('falls back to the mint name and icon when Nostr metadata is missing', () => {
    expect(
      resolveMintInfoContactIdentity({
        profile: null,
        fallbackTitle: 'npub1…',
        loading: false,
        mint,
      })
    ).toEqual({ title: 'Cool Mint', picture: 'https://mint.example/icon.png' });
  });

  it('mixes sources per field: Nostr name, mint icon', () => {
    expect(
      resolveMintInfoContactIdentity({
        profile: { name: 'op' },
        fallbackTitle: 'npub1…',
        loading: false,
        mint,
      })
    ).toEqual({ title: 'op', picture: 'https://mint.example/icon.png' });
  });

  it('does not flash the mint identity while the profile is still loading', () => {
    expect(
      resolveMintInfoContactIdentity({
        profile: null,
        fallbackTitle: 'npub1…',
        loading: true,
        mint,
      })
    ).toEqual({ title: 'npub1…', picture: undefined });
  });

  it('keeps the npub title when there is no mint to borrow from', () => {
    expect(
      resolveMintInfoContactIdentity({ profile: null, fallbackTitle: 'npub1…', loading: false })
    ).toEqual({ title: 'npub1…', picture: undefined });
  });
});
