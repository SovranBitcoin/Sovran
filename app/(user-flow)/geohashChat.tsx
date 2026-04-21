/**
 * @fileoverview Geohash Chat route in User Flow
 *
 * Displays a BitChat-powered location chat screen.
 * Supports both Nostr relay and BLE mesh transports.
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { GeohashChatScreen } from '@/features/bitchat/screens/GeohashChatScreen';

function GeohashChatRoute() {
  const { geohash, tierLabel, transport } = useLocalSearchParams<{
    geohash: string;
    tierLabel?: string;
    transport?: 'nostr' | 'ble';
  }>();

  if (!geohash) return null;

  return (
    <GeohashChatScreen
      geohash={geohash}
      tierLabel={tierLabel}
      transport={transport ?? 'nostr'}
      onBack={() => router.back()}
    />
  );
}

export default GeohashChatRoute;
