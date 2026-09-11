import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View as RNView } from 'react-native';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import * as Location from 'expo-location';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { SquircleView } from '@/shared/ui/primitives/SquircleView';
import Icon from 'assets/icons';
import { withAlpha } from '@/shared/lib/color';
import { MapVignette } from '@/shared/ui/composed/MapVignette';
import { useBTCMapStore } from '@/shared/stores/global/btcMapStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { applySafetyOffset } from '@/shared/lib/map/locationPrivacy';
import { useBootMorphCompleted } from '@/shared/lib/qrButtonAnchor';
import { useShallow } from 'zustand/react/shallow';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, Log } from '@/shared/lib/logger';

const DEFAULT_LAT = 51.5074;
const DEFAULT_LON = -0.1278;

const MOCK_LAT = 40.758;
const MOCK_LON = -73.9855;

const MAP_ZOOM = 13;
const MAX_MARKERS = 25;

/** Rough bounding-box radius in degrees (~5 km). */
const NEARBY_RADIUS_DEG = 0.045;

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

// Local type matching the AppleMaps / GoogleMaps `markers` prop shape
// (coordinates as a nested object). Distinct from the clustering-library
// MapMarker in shared/lib/map/mapClustering.ts which uses flat lat/lon.
interface NearbyMapMarker {
  id: string;
  coordinates: { latitude: number; longitude: number };
  tintColor: string;
  title: string;
}

function MapPreview({
  latitude,
  longitude,
  markers,
}: {
  latitude: number;
  longitude: number;
  markers: NearbyMapMarker[];
}) {
  const surfaceSecondary = useThemeColor('surface-secondary');
  const scheme = useColorScheme();
  // iOS gets the saturation / blend / gradient stack on both themes —
  // most layers are already theme-aware (they tint with `surfaceSecondary`,
  // and `overlay`/`color` blends lift dark Apple Maps pixels toward the
  // light surface). Android stays plain (Google Maps doesn't honour the
  // blend stack the same way and the result reads as a muddy smear).
  const useChrome = Platform.OS === 'ios';
  const isDark = scheme === 'dark';

  // Library boundary: expo-maps native views compare props by reference — a
  // fresh cameraPosition each render can re-apply the camera. Kept manual.
  // ast-grep-ignore: no-manual-memo-tsx
  const cameraPosition = useMemo(
    () => ({ coordinates: { latitude, longitude }, zoom: MAP_ZOOM }),
    [latitude, longitude]
  );

  return (
    <RNView className="h-[140px] overflow-hidden" pointerEvents="none">
      {Platform.OS === 'ios' ? (
        <AppleMaps.View
          style={StyleSheet.absoluteFill}
          cameraPosition={cameraPosition}
          properties={{ isMyLocationEnabled: false, pointsOfInterest: { including: [] } }}
          uiSettings={DISABLED_MAP_UI_SETTINGS}
          markers={markers}
        />
      ) : HAS_ANDROID_GOOGLE_MAPS_KEY ? (
        <GoogleMaps.View
          style={StyleSheet.absoluteFill}
          cameraPosition={cameraPosition}
          colorScheme={
            scheme === 'dark' ? GoogleMaps.MapColorScheme.DARK : GoogleMaps.MapColorScheme.LIGHT
          }
          properties={{
            isMyLocationEnabled: false,
            mapStyleOptions: { json: GOOGLE_MAPS_NO_LABELS_STYLE },
          }}
          uiSettings={DISABLED_MAP_UI_SETTINGS}
          markers={markers}
        />
      ) : (
        <RNView style={StyleSheet.absoluteFill} />
      )}

      {useChrome && (
        <>
          <RNView style={overlayStyles.grayscaleOverlay} pointerEvents="none" />
          {isDark ? (
            // Dark veil: a hair of black to deepen the already-dark Apple
            // Maps base before the surface tint kicks in.
            <RNView style={overlayStyles.darkVeilOverlay} pointerEvents="none" />
          ) : (
            // Light lift: `screen` blend with white at 0.55 brightens the
            // (still-dark) Apple Maps base so the `surfaceSecondary`
            // `overlay`+`color` blends below land on a mid-tone map instead
            // of a near-black one. Without this the chrome reads as a dark
            // wash on a light card.
            <RNView style={overlayStyles.lightLiftOverlay} pointerEvents="none" />
          )}
          <RNView
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: withAlpha(surfaceSecondary, 0.35),
                mixBlendMode: 'overlay',
              },
            ]}
            pointerEvents="none"
          />
          <RNView
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: withAlpha(surfaceSecondary, 1),
                mixBlendMode: 'color',
              },
            ]}
            pointerEvents="none"
          />

          <MapVignette color={surfaceSecondary} />
        </>
      )}
    </RNView>
  );
}

// Module-scope because the try/catch (value blocks inside it) would bail the
// React Compiler if it stayed in the effect's render-scoped closure. Verbatim
// former effect IIFE body; `cancelled` reads go through the getter.
async function resolveNearbyCoords(ctx: {
  isCancelled: () => boolean;
  setPermStatus: (status: 'granted' | 'denied') => void;
  setCoords: (coords: { latitude: number; longitude: number }) => void;
}) {
  const { isCancelled, setPermStatus, setCoords } = ctx;
  try {
    // Request (not just check) permission, matching every other location
    // consumer in the app (MapScreen, useTransactionLocation,
    // useLocationTiers). The old check-only call left permission
    // undetermined, so this card never had a fix and stayed on the London
    // default.
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (!isCancelled()) setPermStatus(status === 'granted' ? 'granted' : 'denied');
    if (status !== 'granted') return;

    // Last-known gives an instant first paint, but returns null when the OS
    // has no cached fix (fresh boot, no recent location use) — which was the
    // other path into the London fallback. Fall back to a live fix.
    let loc = await Location.getLastKnownPositionAsync();
    if (!loc && !isCancelled()) {
      loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
    }
    if (loc && !isCancelled()) {
      const safe = applySafetyOffset(loc.coords.latitude, loc.coords.longitude);
      setCoords(safe);
    }
  } catch {
    // keep default
  }
}

// Component-identity memo: the parent's compile state isn't verified, so this
// stays until a pass audits the consumer (removal only shifts re-render cost).
// ast-grep-ignore: no-manual-memo-tsx
export const BitcoinNearYou = React.memo(function BitcoinNearYou() {
  const [muted, foreground] = useThemeColor(['muted', 'foreground'] as const);
  const mockMode = useSettingsStore((s) => s.mockMode);

  const { placesCache, fetchPlaces } = useBTCMapStore(
    useShallow((s) => ({ placesCache: s.placesCache, fetchPlaces: s.fetchPlaces }))
  );

  // Defer the BTCMap places fetch until *after* the boot splash has morphed
  // into the QR button. Parsing the ~40k-place response takes 2–3 seconds of
  // synchronous work on the JS thread, which previously blocked the morph
  // animation from running. Once the morph is done the user is already on
  // the wallet — running the fetch then just populates the map below the
  // fold without affecting first paint.
  const morphCompleted = useBootMorphCompleted();
  useEffect(() => {
    if (!morphCompleted) return;
    fetchPlaces().catch((err) => {
      log.warn('bitcoin.nearby.fetch.error', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    });
  }, [morphCompleted, fetchPlaces]);

  // Privacy: TRUE device coordinates never live in component state. The
  // location effect applies the session-stable safety offset before storing,
  // so both the camera and the marker bounding-box filter read the same
  // offset coords. Earlier this state held TRUE coords with a separate
  // `offsetCoords` derivation feeding only the camera — the markers were
  // filtered around the user's actual position, leaking it on screen.
  const [coords, setCoords] = useState({
    latitude: mockMode ? MOCK_LAT : DEFAULT_LAT,
    longitude: mockMode ? MOCK_LON : DEFAULT_LON,
  });
  // Denial is otherwise silent (the card just keeps the London default), so
  // the outcome of the permission request must be AX-observable for e2e.
  const [permStatus, setPermStatus] = useState<'undetermined' | 'granted' | 'denied'>(
    'undetermined'
  );

  useEffect(() => {
    if (mockMode) {
      setCoords({ latitude: MOCK_LAT, longitude: MOCK_LON });
      return;
    }

    let cancelled = false;

    void resolveNearbyCoords({
      isCancelled: () => cancelled,
      setPermStatus,
      setCoords,
    });

    return () => {
      cancelled = true;
    };
  }, [mockMode]);

  // Feeds expo-maps `markers` (reference-compared at the native boundary) and
  // does real per-place compute. Kept manual; see cameraPosition above.
  // ast-grep-ignore: no-manual-memo-tsx
  const nearbyMarkers = useMemo((): NearbyMapMarker[] => {
    const places = placesCache?.data;
    if (!places?.length) return [];

    const { latitude, longitude } = coords;
    const nearby: NearbyMapMarker[] = [];

    for (const place of places) {
      if (nearby.length >= MAX_MARKERS) break;
      const dLat = Math.abs(place.lat - latitude);
      const dLon = Math.abs(place.lon - longitude);
      if (dLat > NEARBY_RADIUS_DEG || dLon > NEARBY_RADIUS_DEG) continue;

      nearby.push({
        id: String(place.id),
        coordinates: { latitude: place.lat, longitude: place.lon },
        tintColor: '#FFFFFF',
        title: `Place #${place.id}`,
      });
    }

    return nearby;
  }, [placesCache?.data, coords]);

  const nearbyCount = nearbyMarkers.length;
  const totalCount = placesCache?.data.length ?? 0;
  const countLabel =
    nearbyCount > 0
      ? `${nearbyCount} nearby`
      : totalCount > 0
        ? `${totalCount.toLocaleString()} worldwide`
        : '30,000+ locations';

  const titleColor = withAlpha(foreground, 0.66);

  return (
    <Log name="BitcoinNearYou">
      {/* The permission outcome rides the card's aggregated AX element (iOS
            flattens every descendant into this Pressable), so denial — which
            is otherwise silent — stays e2e-observable. */}
      <Pressable
        onPress={() => router.navigate('/(map-flow)')}
        accessibilityRole="link"
        activeOpacity={0.85}
        testID={`wallet-location:${permStatus}`}>
        <SquircleView
          style={{
            overflow: 'hidden',
            borderRadius: 20,
            borderWidth: 1,
            borderCurve: 'continuous',
            borderColor: withAlpha(muted, 0.3),
          }}>
          <BlurCardFrame accentColor={muted}>
            <RNView className="z-[1]">
              <MapPreview
                latitude={coords.latitude}
                longitude={coords.longitude}
                markers={nearbyMarkers}
              />

              <RNView className="absolute left-0 right-0 top-0 z-[2] flex-row items-center justify-between px-4 pt-3.5">
                <Text size={14} semibold color={titleColor}>
                  Bitcoin near you
                </Text>
                <Icon name="mdi:chevron-right" size={18} color={titleColor} />
              </RNView>

              <RNView className="absolute bottom-2.5 left-3 z-[2]">
                <RNView
                  className="flex-row items-center gap-1 rounded-full px-2 py-1"
                  style={{
                    borderCurve: 'continuous',
                    backgroundColor: withAlpha(foreground, 0.1),
                  }}>
                  <Icon name="mdi:map-marker" size={12} color={titleColor} />
                  <Text size={11} semibold color={titleColor}>
                    {countLabel}
                  </Text>
                </RNView>
              </RNView>
            </RNView>
          </BlurCardFrame>
        </SquircleView>
      </Pressable>
    </Log>
  );
});

const overlayStyles = StyleSheet.create({
  grayscaleOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'black',
    opacity: 1,
    mixBlendMode: 'saturation',
  },
  darkVeilOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  lightLiftOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'white',
    opacity: 0.55,
    mixBlendMode: 'screen',
  },
});
