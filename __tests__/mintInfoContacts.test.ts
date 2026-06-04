import { nip19 } from 'nostr-tools';

import {
  formatMintInfoNostrFallback,
  getMintInfoNostrContactPubkey,
  getMintInfoNostrDisplayName,
  getSortedMintInfoContacts,
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
});
