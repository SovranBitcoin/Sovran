import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View as RNView } from 'react-native';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useBTCMapStore } from '@/shared/stores/global/btcMapStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { applySafetyOffset } from '@/shared/lib/map/locationPrivacy';
import { useBootMorphCompleted } from '@/shared/lib/qrButtonAnchor';
import { useShallow } from 'zustand/react/shallow';
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

interface MapMarker {
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
  markers: MapMarker[];
}) {
  const surfaceSecondary = useThemeColor('surface-secondary');

  const cameraPosition = useMemo(
    () => ({ coordinates: { latitude, longitude }, zoom: MAP_ZOOM }),
    [latitude, longitude]
  );

  return (
    <RNView className="h-[140px] overflow-hidden" pointerEvents="none">
      {Platform.OS === 'ios' ? (
        <AppleMaps.View
          style={StyleSheet.absoluteFillObject}
          cameraPosition={cameraPosition}
          properties={{ isMyLocationEnabled: false, pointsOfInterest: { including: [] } }}
          uiSettings={DISABLED_MAP_UI_SETTINGS}
          markers={markers}
        />
      ) : HAS_ANDROID_GOOGLE_MAPS_KEY ? (
        <GoogleMaps.View
          style={StyleSheet.absoluteFillObject}
          cameraPosition={cameraPosition}
          colorScheme={GoogleMaps.MapColorScheme.DARK}
          properties={{
            isMyLocationEnabled: false,
            mapStyleOptions: { json: GOOGLE_MAPS_NO_LABELS_STYLE },
          }}
          uiSettings={DISABLED_MAP_UI_SETTINGS}
          markers={markers}
        />
      ) : (
        <RNView style={StyleSheet.absoluteFillObject} />
      )}

      <RNView style={overlayStyles.grayscaleOverlay} pointerEvents="none" />
      <RNView style={overlayStyles.desaturationOverlay} pointerEvents="none" />
      <RNView
        style={[
          StyleSheet.absoluteFillObject,
          {
            backgroundColor: opacity(surfaceSecondary, 0.35),
            // @ts-ignore - mixBlendMode works on iOS
            mixBlendMode: 'overlay',
          },
        ]}
        pointerEvents="none"
      />
      <RNView
        style={[
          StyleSheet.absoluteFillObject,
          {
            backgroundColor: opacity(surfaceSecondary, 1),
            // @ts-ignore - mixBlendMode works on iOS
            mixBlendMode: 'color',
          },
        ]}
        pointerEvents="none"
      />

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
    </RNView>
  );
}

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

  const [coords, setCoords] = useState({
    latitude: mockMode ? MOCK_LAT : DEFAULT_LAT,
    longitude: mockMode ? MOCK_LON : DEFAULT_LON,
  });

  useEffect(() => {
    if (mockMode) {
      setCoords({ latitude: MOCK_LAT, longitude: MOCK_LON });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getLastKnownPositionAsync();
        if (loc && !cancelled) {
          setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        }
      } catch {
        // keep default
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mockMode]);

  const nearbyMarkers = useMemo((): MapMarker[] => {
    const places = placesCache?.data;
    if (!places?.length) return [];

    const { latitude, longitude } = coords;
    const nearby: MapMarker[] = [];

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

  const offsetCoords = useMemo(
    () => applySafetyOffset(coords.latitude, coords.longitude),
    [coords]
  );

  const titleColor = opacity(foreground, 0.66);

  return (
    <Log name="BitcoinNearYou">
      <Link href="/(map-flow)" asChild>
        <Pressable activeOpacity={0.85}>
          <RNView
            className="overflow-hidden rounded-[20px] border"
            style={{ borderCurve: 'continuous', borderColor: opacity(muted, 0.3) }}>
            <BlurCardFrame accentColor={muted}>
              <RNView className="relative z-[1]">
                <MapPreview
                  latitude={offsetCoords.latitude}
                  longitude={offsetCoords.longitude}
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
                      backgroundColor: opacity(foreground, 0.1),
                    }}>
                    <Icon name="mdi:map-marker" size={12} color={titleColor} />
                    <Text size={11} semibold color={titleColor}>
                      {countLabel}
                    </Text>
                  </RNView>
                </RNView>
              </RNView>
            </BlurCardFrame>
          </RNView>
        </Pressable>
      </Link>
    </Log>
  );
});

const overlayStyles = StyleSheet.create({
  grayscaleOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'black',
    opacity: 1,
    // @ts-ignore - mixBlendMode supported on iOS
    mixBlendMode: 'saturation',
  },
  desaturationOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
});
