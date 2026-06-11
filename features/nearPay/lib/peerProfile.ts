import type { BLEPeer } from 'bitchat-module';

import type { RecentPeopleProfileRow } from '@/features/feed/hooks/useRecentPeopleProfiles';
import { resolveIdentityName } from '@/shared/lib/identity';

import type { NearPayLayoutPeer } from './peerLayout';

/** The peer's Nostr pubkey: the announced lock key minus its "02" parity prefix. */
export function peerNostrPubkey(peer: Pick<BLEPeer, 'p2pkPubkeyHex'>): string {
  return (peer.p2pkPubkeyHex ?? '').slice(2);
}

/**
 * Resolve the peer's display name: Nostr profile name (via nagg) wins over
 * the BLE nickname; the word-pair fallback seeds from the Nostr pubkey so
 * this peer reads as the same identity here as on every other Nostr surface.
 */
export function peerDisplayName(peer: BLEPeer, profile?: RecentPeopleProfileRow): string {
  return resolveIdentityName({
    pubkey: peerNostrPubkey(peer) || peer.peerID,
    nostrProfile: profile?.metadata,
    bleNickname: peer.nickname,
  });
}

export function toLayoutPeer(peer: BLEPeer, profile?: RecentPeopleProfileRow): NearPayLayoutPeer {
  return {
    peerID: peer.peerID,
    nickname: peer.nickname,
    isConnected: peer.isConnected,
    hasDirectLink: peer.hasDirectLink,
    lastSeen: peer.lastSeen,
    name: peerDisplayName(peer, profile),
    avatarUrl: profile?.metadata?.picture ?? null,
    supportsP2pkEcash: peer.supportsP2pkEcash,
    p2pkPubkeyHex: peer.p2pkPubkeyHex ?? '',
    nostrPubkey: peerNostrPubkey(peer),
    profileLoading: profile?.isLoading ?? false,
  };
}

/** Avatar state that never flashes the identicon while the profile fetch is in flight. */
export function peerAvatarState(
  peer: Pick<NearPayLayoutPeer, 'avatarUrl' | 'profileLoading'>
): 'loading' | 'image' | 'fallback' {
  if (peer.avatarUrl) return 'image';
  return peer.profileLoading ? 'loading' : 'fallback';
}
