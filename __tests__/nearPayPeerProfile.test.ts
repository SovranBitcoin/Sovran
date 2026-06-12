import type { BLEPeer } from 'bitchat-module';

import { peerAvatarState, peerDisplayName, toLayoutPeer } from '@/features/nearPay/lib/peerProfile';

function blePeer(overrides: Partial<BLEPeer> = {}): BLEPeer {
  return {
    peerID: 'deadbeefdeadbeef',
    nickname: 'mesh-nick',
    isConnected: true,
    hasDirectLink: true,
    lastSeen: 1,
    supportsNutRequests: true,
    autoRedeem: true,
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

  it('falls back to the BLE nickname without a profile (v2 beacon carries no key)', () => {
    expect(peerDisplayName(blePeer())).toBe('mesh-nick');
  });
});

describe('toLayoutPeer', () => {
  it('maps capability-beacon flags onto the layout peer', () => {
    expect(toLayoutPeer(blePeer())).toMatchObject({
      name: 'mesh-nick',
      avatarUrl: null,
      supportsNutRequests: true,
      autoRedeem: true,
      profileLoading: false,
    });
    expect(toLayoutPeer(blePeer({ supportsNutRequests: false, autoRedeem: false }))).toMatchObject({
      supportsNutRequests: false,
      autoRedeem: false,
    });
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
