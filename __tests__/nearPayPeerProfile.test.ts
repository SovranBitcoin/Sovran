import type { BLEPeer } from 'bitchat-module';

import { peerAvatarState, peerDisplayName, toLayoutPeer } from '@/features/nearPay/lib/peerProfile';
import { buildStandingCreq } from '@/shared/lib/nutCreq';

const NOSTR_HEX = 'ab'.repeat(32);
const CREQ = buildStandingCreq({
  mints: ['https://mint.example'],
  pubkey33: `02${NOSTR_HEX}`,
})!;

function blePeer(overrides: Partial<BLEPeer> = {}): BLEPeer {
  return {
    peerID: 'deadbeefdeadbeef',
    nickname: 'mesh-nick',
    isConnected: true,
    hasDirectLink: true,
    lastSeen: 1,
    ...overrides,
  };
}

describe('peerDisplayName', () => {
  it('prefers a known Nostr profile name over the BLE nickname', () => {
    expect(
      peerDisplayName(blePeer(), {
        pubkey: 'ab'.repeat(32),
        metadata: { displayName: 'Alice', fetchedAt: 1 },
        isLoading: false,
      })
    ).toBe('Alice');
  });

  it('falls back to the BLE nickname without a profile (no identity exchanged yet)', () => {
    expect(peerDisplayName(blePeer())).toBe('mesh-nick');
  });
});

describe('toLayoutPeer', () => {
  it('marks a peer that advertised identity + a creq as lockable', () => {
    expect(toLayoutPeer(blePeer({ nostrPubkeyHex: NOSTR_HEX, creq: CREQ }))).toMatchObject({
      name: 'mesh-nick',
      avatarUrl: null,
      lockable: true,
      nostrPubkeyHex: NOSTR_HEX,
      creq: CREQ,
      profileLoading: false,
    });
    // Identity but no creq → not lockable (we don't know their accepted mints).
    expect(toLayoutPeer(blePeer({ nostrPubkeyHex: 'ab'.repeat(32) }))).toMatchObject({
      lockable: false,
    });
    // No identity exchanged → not eligible for token DMs yet.
    expect(toLayoutPeer(blePeer())).toMatchObject({ lockable: false });
  });
});

describe('peerAvatarState', () => {
  it('never flashes the identicon while the profile fetch is in flight', () => {
    expect(peerAvatarState({ avatarUrl: null, profileLoading: true })).toBe('loading');
    expect(peerAvatarState({ avatarUrl: 'https://x/p.png', profileLoading: false })).toBe('image');
    // Image wins even mid-refetch — never regress a known picture to a bar.
    expect(peerAvatarState({ avatarUrl: 'https://x/p.png', profileLoading: true })).toBe('image');
    expect(peerAvatarState({ avatarUrl: null, profileLoading: false })).toBe('fallback');
  });
});
