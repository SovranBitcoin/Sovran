import type { BLEPeer } from 'bitchat-module';

import type { RecentPeopleProfileRow } from '@/features/feed/hooks/useRecentPeopleProfiles';
import { resolveIdentityName } from '@/shared/lib/identity';

import type { NearPayLayoutPeer } from './peerLayout';

/**
 * Resolve the peer's display name. The v2 capability beacon carries no key
 * material, so there is no announced Nostr identity to resolve pre-send —
 * the word-pair fallback seeds from the BLE peer ID, and the recipient's
 * real profile surfaces at send time once the NUT-18 request reveals their
 * lock key.
 */
export function peerDisplayName(peer: BLEPeer, profile?: RecentPeopleProfileRow): string {
  return resolveIdentityName({
    pubkey: peer.peerID,
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
