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
 * Deep-link params are validated with Zod at the route boundary per
 * AUDIT.md dim-5 — `peerID` must match the transport's expected shape so
 * an attacker-crafted link cannot funnel arbitrary pubkeys into the DM
 * cipher path.
 */

import React from 'react';
import { router } from 'expo-router';
import { z } from 'zod';
import { Hex64 } from '@sovranbitcoin/schemas';
import { GeohashChatScreen } from '@/features/bitchat/screens/GeohashChatScreen';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const HEX_16 = /^[0-9a-f]{16}$/;
const GEOHASH = /^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/;

const ParamsSchema = z
  .object({
    transport: z.enum(['ble-dm', 'nostr-dm']),
    peerID: z.string().min(1),
    nickname: z.string().max(64).optional(),
    geohash: z.string().regex(GEOHASH).optional(),
  })
  .refine(
    (v) => (v.transport === 'ble-dm' ? HEX_16.test(v.peerID) : Hex64.safeParse(v.peerID).success),
    {
      message: 'peerID shape does not match transport',
      path: ['peerID'],
    }
  )
  .refine((v) => v.transport === 'ble-dm' || typeof v.geohash === 'string', {
    message: 'nostr-dm requires geohash',
    path: ['geohash'],
  });

function BitchatDMRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'user-flow.bitchatDM' });
  if (!params) return null;

  return (
    <GeohashChatScreen
      geohash={params.geohash ?? 'mesh'}
      transport={params.transport}
      dmPeerID={params.peerID}
      dmNickname={params.nickname}
      onBack={() => router.back()}
    />
  );
}

export default BitchatDMRoute;
