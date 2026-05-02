/**
 * @fileoverview Geohash Chat route in User Flow
 *
 * Displays a BitChat-powered location chat screen. Supports both Nostr
 * relay and BLE mesh transports.
 *
 * Deep-link params are validated with Zod at the route boundary per
 * AUDIT.md dim-5 — `geohash` is constrained to the base32 geohash
 * alphabet so a malformed link cannot reach the native bitchat module.
 */

import React from 'react';
import { router } from 'expo-router';
import { z } from 'zod';
import { GeohashChatScreen } from '@/features/bitchat/screens/GeohashChatScreen';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const GEOHASH = /^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/;

const ParamsSchema = z.object({
  geohash: z.string().regex(GEOHASH, 'invalid geohash'),
  tierLabel: z.string().max(64).optional(),
  transport: z.enum(['nostr', 'ble']).optional(),
});

function GeohashChatRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'user-flow.geohashChat' });
  if (!params) return null;

  return (
    <GeohashChatScreen
      geohash={params.geohash}
      tierLabel={params.tierLabel}
      transport={params.transport ?? 'nostr'}
      onBack={() => router.back()}
    />
  );
}

export default GeohashChatRoute;
