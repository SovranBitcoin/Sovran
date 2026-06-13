import type { BLEPeer } from 'bitchat-module';

import type { RecentPeopleProfileRow } from '@/features/feed/hooks/useRecentPeopleProfiles';
import { resolveIdentityName } from '@/shared/lib/identity';

import type { NearPayLayoutPeer } from './peerLayout';

/**
 * The peer's x-only Nostr pubkey when the v3 beacon announced its 33-byte
 * "02"-prefixed P2PK key — THIS is the peer's real Nostr identity, usable for
 * kind-0 profile lookups (real face/name pre-tap). Returns null for stock
 * peers with no announced key.
 */
export function peerNostrPubkey(peer: Pick<BLEPeer, 'p2pkPubkeyHex'>): string | null {
  return peer.p2pkPubkeyHex ? peer.p2pkPubkeyHex.slice(2) : null;
}

/**
 * Identity seed for identicons/word-pair names. For Sovran v3 peers it is the
 * real x-only Nostr pubkey (so the identicon/name match the resolved profile);
 * for stock peers the announced Curve25519 noise key (a stable pseudonym
 * across nickname changes, never a Nostr pubkey); the 16-hex peerID is the
 * final fallback.
 */
export function peerIdentitySeed(
  peer: Pick<BLEPeer, 'p2pkPubkeyHex' | 'noisePublicKeyHex' | 'peerID'>
): string {
  return peerNostrPubkey(peer) ?? peer.noisePublicKeyHex ?? peer.peerID;
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
    p2pkPubkeyHex: peer.p2pkPubkeyHex,
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
