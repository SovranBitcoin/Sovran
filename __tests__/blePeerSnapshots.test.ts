import type { BLEPeer } from 'bitchat-module';

import {
  areBLEPeerSnapshotsEquivalent,
  BLE_PEER_STALE_MS,
  filterFreshBLEPeers,
} from '@/features/bitchat/lib/blePeerSnapshots';

function peer(peerID: string, overrides: Partial<BLEPeer> = {}): BLEPeer {
  return {
    peerID,
    nickname: peerID,
    isConnected: true,
    hasDirectLink: true,
    lastSeen: 1,
    ...overrides,
  };
}

describe('BLE peer snapshot equality', () => {
  it('ignores lastSeen-only churn and order changes', () => {
    const current = [peer('a', { lastSeen: 1 }), peer('b', { lastSeen: 2 })];
    const next = [peer('b', { lastSeen: 99 }), peer('a', { lastSeen: 101 })];

    expect(areBLEPeerSnapshotsEquivalent(current, next)).toBe(true);
  });

  it('updates when peers are added or removed', () => {
    expect(areBLEPeerSnapshotsEquivalent([peer('a')], [peer('a'), peer('b')])).toBe(false);
    expect(areBLEPeerSnapshotsEquivalent([peer('a'), peer('b')], [peer('a')])).toBe(false);
  });

  it('updates on display or reachability changes', () => {
    expect(areBLEPeerSnapshotsEquivalent([peer('a')], [peer('a', { nickname: 'Ada' })])).toBe(
      false
    );
    expect(areBLEPeerSnapshotsEquivalent([peer('a')], [peer('a', { isConnected: false })])).toBe(
      false
    );
    expect(areBLEPeerSnapshotsEquivalent([peer('a')], [peer('a', { hasDirectLink: false })])).toBe(
      false
    );
  });

  it('updates when a peer hands us its Nostr identity (favorites us back)', () => {
    const identified = peer('a', { nostrPubkeyHex: 'ab'.repeat(32) });
    expect(areBLEPeerSnapshotsEquivalent([peer('a')], [identified])).toBe(false);
    expect(
      areBLEPeerSnapshotsEquivalent([identified], [{ ...identified, nostrPubkeyHex: undefined }])
    ).toBe(false);
    expect(areBLEPeerSnapshotsEquivalent([identified], [{ ...identified, lastSeen: 99 }])).toBe(
      true
    );
  });
});

describe('filterFreshBLEPeers', () => {
  const NOW = 10_000_000;

  it('keeps peers with a live direct link regardless of lastSeen age', () => {
    const ancient = peer('a', { hasDirectLink: true, lastSeen: 0 });
    expect(filterFreshBLEPeers([ancient], NOW)).toEqual([ancient]);
  });

  it('keeps linkless peers until their last announce goes stale', () => {
    const fresh = peer('a', { hasDirectLink: false, lastSeen: NOW - BLE_PEER_STALE_MS });
    expect(filterFreshBLEPeers([fresh], NOW)).toEqual([fresh]);
  });

  it('drops ghost identities: no link and a stale announce', () => {
    // The profile-switch ghost: the old peerID's link rebound to the new
    // identity (hasDirectLink false) while isConnected stays cached true —
    // upstream's registry never expires it, so the filter must.
    const ghost = peer('old-profile', {
      hasDirectLink: false,
      isConnected: true,
      lastSeen: NOW - BLE_PEER_STALE_MS - 1,
    });
    const live = peer('current-profile', { hasDirectLink: true, lastSeen: NOW });
    expect(filterFreshBLEPeers([ghost, live], NOW)).toEqual([live]);
  });
});
