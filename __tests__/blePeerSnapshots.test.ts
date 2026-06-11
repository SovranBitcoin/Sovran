import type { BLEPeer } from 'bitchat-module';

import { areBLEPeerSnapshotsEquivalent } from '@/features/bitchat/lib/blePeerSnapshots';

function peer(peerID: string, overrides: Partial<BLEPeer> = {}): BLEPeer {
  return {
    peerID,
    nickname: peerID,
    isConnected: true,
    hasDirectLink: true,
    lastSeen: 1,
    isSovranPeer: false,
    capabilities: 0,
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

  it('updates when the SVRN extension appears or its lock key changes', () => {
    const sovran = peer('a', {
      isSovranPeer: true,
      capabilities: 1,
      p2pkPubkeyHex: `02${'ab'.repeat(32)}`,
    });
    expect(areBLEPeerSnapshotsEquivalent([peer('a')], [sovran])).toBe(false);
    expect(
      areBLEPeerSnapshotsEquivalent(
        [sovran],
        [{ ...sovran, p2pkPubkeyHex: `02${'cd'.repeat(32)}` }]
      )
    ).toBe(false);
    expect(areBLEPeerSnapshotsEquivalent([sovran], [{ ...sovran, lastSeen: 99 }])).toBe(true);
  });
});
