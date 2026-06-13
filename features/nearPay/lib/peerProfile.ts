import type { BLEPeer } from 'bitchat-module';

import type { RecentPeopleProfileRow } from '@/features/feed/hooks/useRecentPeopleProfiles';
import { resolveIdentityName } from '@/shared/lib/identity';

import type { NearPayLayoutPeer } from './peerLayout';

/**
 * The peer's x-only Nostr pubkey, learned via bitchat's native favorite
 * exchange (`[FAVORITED]:npub`) — THIS is the peer's real Nostr identity,
 * usable for kind-0 profile lookups (real face/name pre-tap). Returns null
 * until the peer has favorited us back (stock peers never do).
 */
export function peerNostrPubkey(peer: Pick<BLEPeer, 'nostrPubkeyHex'>): string | null {
  return peer.nostrPubkeyHex ?? null;
}

/**
 * Identity seed for identicons/word-pair names. Once we've exchanged identity
 * it is the real x-only Nostr pubkey (so the identicon/name match the resolved
 * profile); otherwise the announced Curve25519 noise key (a stable pseudonym
 * across nickname changes, never a Nostr pubkey); the 16-hex peerID is the
 * final fallback.
 */
export function peerIdentitySeed(
  peer: Pick<BLEPeer, 'nostrPubkeyHex' | 'noisePublicKeyHex' | 'peerID'>
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
    lockable: !!peer.nostrPubkeyHex,
    nostrPubkeyHex: peer.nostrPubkeyHex,
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
