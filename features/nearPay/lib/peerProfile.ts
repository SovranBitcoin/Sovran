import type { BLEPeer } from 'bitchat-module';

import type { RecentPeopleProfileRow } from '@/features/feed/hooks/useRecentPeopleProfiles';
import { resolveIdentityName } from '@/shared/lib/identity';

import type { NearPayLayoutPeer } from './peerLayout';

/**
 * Identity seed for identicons/word-pair names. Every bitchat announce
 * (stock clients included) carries the peer's Curve25519 noise static key —
 * a stable pseudonym across nickname changes. NOT a Nostr pubkey (wrong
 * curve, and for Sovran peers it is one-way derived from the Nostr key):
 * the recipient's REAL profile surfaces at send time, when the NUT-18
 * request's nostr transport reveals their nprofile.
 */
export function peerIdentitySeed(peer: Pick<BLEPeer, 'noisePublicKeyHex' | 'peerID'>): string {
  return peer.noisePublicKeyHex ?? peer.peerID;
}

export function peerDisplayName(peer: BLEPeer, profile?: RecentPeopleProfileRow): string {
  return resolveIdentityName({
    pubkey: peerIdentitySeed(peer),
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
    supportsNutRequests: peer.supportsNutRequests,
    autoRedeem: peer.autoRedeem,
    identitySeed: peerIdentitySeed(peer),
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
