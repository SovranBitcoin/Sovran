/**
 * @fileoverview 1:1 private chat route for BitChat DMs.
 *
 * Handles both transports via a single `transport` param:
 *   - `ble-dm`    → Noise-encrypted mesh DM. `peerID` is the 16-hex bitchat
 *                   PeerID.
 *   - `nostr-dm`  → NIP-17 gift-wrapped DM over Nostr. `peerID` is the
 *                   per-geohash derived hex pubkey. `geohash` must be passed
 *                   so native knows which geohash subscription to ride.
 *
 * This is a thin wrapper around `GeohashChatScreen`'s DM mode — the screen
 * component does all the real work, matching the public-chat UI so DMs and
 * public chats feel identical.
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { GeohashChatScreen } from '@/features/bitchat/screens/GeohashChatScreen';

function BitchatDMRoute() {
  const { transport, peerID, nickname, geohash } = useLocalSearchParams<{
    transport: 'ble-dm' | 'nostr-dm';
    peerID: string;
    nickname?: string;
    /** Only required for nostr-dm; ble-dm ignores it. */
    geohash?: string;
  }>();

  if (!transport || !peerID) return null;

  return (
    <GeohashChatScreen
      geohash={geohash ?? 'mesh'}
      transport={transport}
      dmPeerID={peerID}
      dmNickname={nickname}
      onBack={() => router.back()}
    />
  );
}

export default BitchatDMRoute;
