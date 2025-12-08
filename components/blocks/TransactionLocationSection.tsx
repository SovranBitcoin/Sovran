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
import { View } from 'components/ui/View/View';
import { VStack } from 'components/ui/View/VStack';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from 'providers/ThemeProvider';
import {
  useTransactionLocationSection,
  UseTransactionLocationSectionResult,
} from '@/hooks/useTransactionLocationSection';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';

// Re-export hook for convenience
export { useTransactionLocationSection };
export type { UseTransactionLocationSectionResult };

interface TransactionLocationSectionProps {
  /** The transaction's history entry ID */
  transactionId: string | undefined;
}

// Shared map UI settings (no gestures, no controls)
const DISABLED_MAP_UI_SETTINGS = {
  compassEnabled: false,
  myLocationButtonEnabled: false,
  zoomControlsEnabled: false,
  scrollGesturesEnabled: false,
  zoomGesturesEnabled: false,
  tiltGesturesEnabled: false,
  rotationGesturesEnabled: false,
};

// Google Maps style JSON to hide all labels
const GOOGLE_MAPS_NO_LABELS_STYLE = JSON.stringify([
  { featureType: 'all', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]);

/**
 * Reusable grayscale + vignette overlay for maps
 */
function MapGrayscaleOverlay({ withBlur = false }: { withBlur?: boolean }) {
  const { getPrimaryColor } = useTheme();

  return (
    <>
      {/* Base grayscale layers */}
      <View style={mapStyles.grayscaleOverlay} pointerEvents="none" />
      <View style={mapStyles.grayscaleOverlaySecondary} pointerEvents="none" />

      {/* Optional blur for privacy placeholder */}
      {withBlur && <BlurView intensity={10} tint="dark" style={StyleSheet.absoluteFillObject} />}

      {/* Color blend overlays */}
      <View
        style={[
          StyleSheet.absoluteFillObject,
          {
            backgroundColor: opacity(getPrimaryColor('800'), 0.35),
            // @ts-ignore - mixBlendMode works on iOS
            mixBlendMode: 'overlay',
          },
        ]}
        pointerEvents="none"
      />
      <View
        style={[
          StyleSheet.absoluteFillObject,
          {
            backgroundColor: opacity(getPrimaryColor('800'), 1),
            // @ts-ignore - mixBlendMode works on iOS
            mixBlendMode: 'color',
          },
        ]}
        pointerEvents="none"
      />

      {/* Vignette gradients - edges opaque, center transparent */}
      <LinearGradient
        colors={[
          getPrimaryColor('800'),
          opacity(getPrimaryColor('800'), 0.1),
          opacity(getPrimaryColor('800'), 0.1),
          getPrimaryColor('800'),
        ]}
        locations={[0, 0.3, 0.7, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[
          getPrimaryColor('800'),
          opacity(getPrimaryColor('800'), 0.1),
          opacity(getPrimaryColor('800'), 0.1),
          getPrimaryColor('800'),
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
 * Privacy placeholder that hides the map until user taps to reveal
 * Shows a blurred, grayscale preview of a fake location to hint it's a map
 */
function LocationPrivacyPlaceholder({ onReveal }: { onReveal: () => void }) {
  const { getPrimaryColor } = useTheme();
  const isIOS = Platform.OS === 'ios';

  // Fake location (somewhere generic) for the blurred preview
  const previewCameraPosition = {
    coordinates: { latitude: 51.5074, longitude: -0.1278 }, // London
    zoom: 14,
  };

  return (
    <TouchableOpacity onPress={onReveal} activeOpacity={0.7}>
      <View style={mapStyles.container}>
        {/* Grayscale map preview - labels hidden for cleaner blur effect */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {isIOS ? (
            <AppleMaps.View
              style={StyleSheet.absoluteFillObject}
              cameraPosition={previewCameraPosition}
              properties={{ isMyLocationEnabled: false, pointsOfInterest: { including: [] } }}
              uiSettings={DISABLED_MAP_UI_SETTINGS}
            />
          ) : (
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
          )}
          <MapGrayscaleOverlay withBlur />
        </View>

        {/* Content - centered overlay */}
        <View style={StyleSheet.absoluteFill}>
          <VStack align="center" justify="center" gap={6} style={{ flex: 1 }}>
            <Icon name="mdi:map-marker" size={24} color={opacity(getPrimaryColor('0'), 0.75)} />
            <Text heavy size={13} style={{ color: opacity(getPrimaryColor('0'), 0.75) }}>
              Tap to reveal location
            </Text>
          </VStack>
        </View>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Small map showing where the transaction was created
 * Uses a grayscale overlay for a muted appearance
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
  const { getShadeColor } = useTheme();
  const isIOS = Platform.OS === 'ios';

  const markerConfig = [
    {
      id: 'transaction-location',
      coordinates: { latitude, longitude },
      tintColor: grayscale ? '#FFFFFF' : getShadeColor('300'),
      title: 'Transaction location',
    },
  ];

  const cameraPosition = {
    coordinates: { latitude, longitude },
    zoom: 14,
  };

  return (
    <View style={mapStyles.container} pointerEvents="none">
      {isIOS ? (
        <AppleMaps.View
          style={StyleSheet.absoluteFillObject}
          cameraPosition={cameraPosition}
          properties={{ isMyLocationEnabled: false }}
          uiSettings={DISABLED_MAP_UI_SETTINGS}
          markers={markerConfig}
        />
      ) : (
        <GoogleMaps.View
          style={StyleSheet.absoluteFillObject}
          cameraPosition={cameraPosition}
          colorScheme={GoogleMaps.MapColorScheme.DARK}
          properties={{ isMyLocationEnabled: false }}
          uiSettings={DISABLED_MAP_UI_SETTINGS}
          markers={markerConfig}
        />
      )}
      {grayscale && <MapGrayscaleOverlay />}
    </View>
  );
}

/**
 * Main component that decides what to render based on location data availability
 * Returns null if no location data exists (setting disabled or not captured)
 */
export function TransactionLocationSection({ transactionId }: TransactionLocationSectionProps) {
  const { location, isRevealed, reveal } = useTransactionLocationSection(transactionId);

  // No location data - render nothing
  if (!transactionId || !location) {
    return null;
  }

  // Show privacy placeholder until user taps to reveal
  if (!isRevealed) {
    return <LocationPrivacyPlaceholder onReveal={reveal} />;
  }

  // Show the map after reveal with grayscale effect
  return (
    <TransactionLocationMap latitude={location.latitude} longitude={location.longitude} grayscale />
  );
}

const mapStyles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
    height: 150,
  },
  grayscaleOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'black',
    opacity: 1,
    // @ts-ignore - mixBlendMode supported on iOS
    mixBlendMode: 'saturation',
  },
  grayscaleOverlaySecondary: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
});
