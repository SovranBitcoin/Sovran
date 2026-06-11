import type { BLEPeer } from 'bitchat-module';

import {
  peerAvatarState,
  peerDisplayName,
  peerNostrPubkey,
  toLayoutPeer,
} from '@/features/nearPay/lib/peerProfile';

const NOSTR_PUBKEY = 'ab'.repeat(32);

function blePeer(overrides: Partial<BLEPeer> = {}): BLEPeer {
  return {
    peerID: 'deadbeefdeadbeef',
    nickname: 'mesh-nick',
    isConnected: true,
    hasDirectLink: true,
    lastSeen: 1,
    isSovranPeer: true,
    capabilities: 1,
    p2pkPubkeyHex: `02${NOSTR_PUBKEY}`,
    ...overrides,
  };
}

function profileRow(
  metadata?: { displayName?: string; name?: string; picture?: string },
  isLoading = false
) {
  return {
    pubkey: NOSTR_PUBKEY,
    metadata: metadata ? { ...metadata, fetchedAt: 1 } : undefined,
    isLoading,
  };
}

describe('peerNostrPubkey', () => {
  it('strips the 02 parity prefix from the SVRN lock key', () => {
    expect(peerNostrPubkey(blePeer())).toBe(NOSTR_PUBKEY);
    expect(peerNostrPubkey(blePeer({ p2pkPubkeyHex: undefined }))).toBe('');
  });
});

describe('peerDisplayName', () => {
  it('prefers the Nostr profile name over the BLE nickname', () => {
    expect(peerDisplayName(blePeer(), profileRow({ displayName: 'Alice' }))).toBe('Alice');
    expect(peerDisplayName(blePeer(), profileRow({ name: 'alice' }))).toBe('alice');
  });

  it('falls back to the BLE nickname while no profile is known', () => {
    expect(peerDisplayName(blePeer(), profileRow(undefined, true))).toBe('mesh-nick');
    expect(peerDisplayName(blePeer())).toBe('mesh-nick');
  });
});

describe('toLayoutPeer', () => {
  it('carries profile picture, pubkey, and loading state into the layout peer', () => {
    const loaded = toLayoutPeer(
      blePeer(),
      profileRow({ displayName: 'Alice', picture: 'https://x/p.png' })
    );
    expect(loaded).toMatchObject({
      name: 'Alice',
      avatarUrl: 'https://x/p.png',
      nostrPubkey: NOSTR_PUBKEY,
      profileLoading: false,
    });

    const loading = toLayoutPeer(blePeer(), profileRow(undefined, true));
    expect(loading).toMatchObject({ avatarUrl: null, profileLoading: true, name: 'mesh-nick' });
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
