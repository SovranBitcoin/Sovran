/**
 * @fileoverview Transaction Location Section Component
 *
 * Shows a map of where a transaction was created (if location was captured).
 * Returns null if no location data exists.
 *
 * Features:
 * - Privacy placeholder: Blurred map preview with "Tap to reveal" until user taps
 * - Grayscale styling: Map uses desaturated colors to blend with UI
 * - Cross-platform: Supports both Apple Maps (iOS) and Google Maps (Android)
 *
 * Used across SendTokenScreen, ReceiveTokenScreen, MintQuoteScreen, MeltQuoteScreen.
 */

import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTransactionLocationSection } from '@/shared/hooks/useTransactionLocationSection';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

interface TransactionLocationSectionProps {
  /** The transaction's history entry ID */
  transactionId: string | undefined;
}

const DISABLED_MAP_UI_SETTINGS = {
  compassEnabled: false,
  myLocationButtonEnabled: false,
  zoomControlsEnabled: false,
  scrollGesturesEnabled: false,
  zoomGesturesEnabled: false,
  tiltGesturesEnabled: false,
  rotationGesturesEnabled: false,
};

const GOOGLE_MAPS_NO_LABELS_STYLE = JSON.stringify([
  { featureType: 'all', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]);
const HAS_ANDROID_GOOGLE_MAPS_KEY = !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

const MAP_CONTAINER_CN = 'mx-4 rounded-xl overflow-hidden h-[150px]';

/**
 * Reusable grayscale + vignette overlay for maps
 */
function MapGrayscaleOverlay({ withBlur = false }: { withBlur?: boolean }) {
  const surfaceSecondary = useThemeColor('surface-secondary');

  return (
    <>
      <View
        className="absolute inset-0"
        style={{
          backgroundColor: 'black',
          // @ts-ignore - mixBlendMode supported on iOS
          mixBlendMode: 'saturation',
        }}
        pointerEvents="none"
      />
      <View
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.15)' }}
        pointerEvents="none"
      />

      {withBlur && <BlurView intensity={10} tint="dark" style={StyleSheet.absoluteFillObject} />}

      <View
        className="absolute inset-0"
        style={{
          backgroundColor: opacity(surfaceSecondary, 0.35),
          // @ts-ignore - mixBlendMode works on iOS
          mixBlendMode: 'overlay',
        }}
        pointerEvents="none"
      />
      <View
        className="absolute inset-0"
        style={{
          backgroundColor: opacity(surfaceSecondary, 1),
          // @ts-ignore - mixBlendMode works on iOS
          mixBlendMode: 'color',
        }}
        pointerEvents="none"
      />

      {/* Vignette gradients - edges opaque, center transparent */}
      <LinearGradient
        colors={[
          surfaceSecondary,
          opacity(surfaceSecondary, 0.1),
          opacity(surfaceSecondary, 0.1),
          surfaceSecondary,
        ]}
        locations={[0, 0.3, 0.7, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[
          surfaceSecondary,
          opacity(surfaceSecondary, 0.1),
          opacity(surfaceSecondary, 0.1),
          surfaceSecondary,
        ]}
        locations={[0, 0.25, 0.75, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
    </>
  );
}

/**
 * Privacy placeholder that hides the map until user taps to reveal.
 * Shows a blurred, grayscale preview of a fake location to hint it's a map.
 */
function LocationPrivacyPlaceholder({ onReveal }: { onReveal: () => void }) {
  const foreground = useThemeColor('foreground');
  const isIOS = Platform.OS === 'ios';

  const previewCameraPosition = {
    coordinates: { latitude: 51.5074, longitude: -0.1278 },
    zoom: 14,
  };

  return (
    <Pressable onPress={onReveal} activeOpacity={0.7}>
      <View className={MAP_CONTAINER_CN}>
        <View className="absolute inset-0" pointerEvents="none">
          {isIOS ? (
            <AppleMaps.View
              style={StyleSheet.absoluteFillObject}
              cameraPosition={previewCameraPosition}
              properties={{ isMyLocationEnabled: false, pointsOfInterest: { including: [] } }}
              uiSettings={DISABLED_MAP_UI_SETTINGS}
            />
          ) : HAS_ANDROID_GOOGLE_MAPS_KEY ? (
            <GoogleMaps.View
              style={StyleSheet.absoluteFillObject}
              cameraPosition={previewCameraPosition}
              colorScheme={GoogleMaps.MapColorScheme.DARK}
              properties={{
                isMyLocationEnabled: false,
                mapStyleOptions: { json: GOOGLE_MAPS_NO_LABELS_STYLE },
              }}
              uiSettings={DISABLED_MAP_UI_SETTINGS}
            />
          ) : (
            <View className="absolute inset-0" />
          )}
          <MapGrayscaleOverlay withBlur />
        </View>

        <View className="absolute inset-0 items-center justify-center">
          <VStack align="center" gap={6}>
            <Icon name="mdi:map-marker" size={24} color={opacity(foreground, 0.75)} />
            <Text heavy size={13} style={{ color: opacity(foreground, 0.75) }}>
              Tap to reveal location
            </Text>
          </VStack>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Small map showing where the transaction was created.
 * Uses a grayscale overlay for a muted appearance.
 */
function TransactionLocationMap({
  latitude,
  longitude,
  grayscale = false,
}: {
  latitude: number;
  longitude: number;
  grayscale?: boolean;
}) {
  const isIOS = Platform.OS === 'ios';
  const shade300 = useThemeColor('shade-300');

  const markerConfig = [
    {
      id: 'transaction-location',
      coordinates: { latitude, longitude },
      tintColor: grayscale ? '#FFFFFF' : shade300,
      title: 'Transaction location',
    },
  ];

  const cameraPosition = {
    coordinates: { latitude, longitude },
    zoom: 14,
  };

  return (
    <View className={MAP_CONTAINER_CN} pointerEvents="none">
      {isIOS ? (
        <AppleMaps.View
          style={StyleSheet.absoluteFillObject}
          cameraPosition={cameraPosition}
          properties={{ isMyLocationEnabled: false }}
          uiSettings={DISABLED_MAP_UI_SETTINGS}
          markers={markerConfig}
        />
      ) : HAS_ANDROID_GOOGLE_MAPS_KEY ? (
        <GoogleMaps.View
          style={StyleSheet.absoluteFillObject}
          cameraPosition={cameraPosition}
          colorScheme={GoogleMaps.MapColorScheme.DARK}
          properties={{ isMyLocationEnabled: false }}
          uiSettings={DISABLED_MAP_UI_SETTINGS}
          markers={markerConfig}
        />
      ) : (
        <View className="absolute inset-0" />
      )}
      {grayscale && <MapGrayscaleOverlay />}
    </View>
  );
}

/**
 * Main component that decides what to render based on location data availability.
 * Returns null if no location data exists (setting disabled or not captured).
 */
export function TransactionLocationSection({ transactionId }: TransactionLocationSectionProps) {
  const { location, isRevealed, reveal } = useTransactionLocationSection(transactionId);

  if (!transactionId || !location) {
    return null;
  }

  if (!isRevealed) {
    return <LocationPrivacyPlaceholder onReveal={reveal} />;
  }

  return (
    <Log name="TransactionLocationSection">
      <TransactionLocationMap
        latitude={location.latitude}
        longitude={location.longitude}
        grayscale
      />
    </Log>
  );
}
