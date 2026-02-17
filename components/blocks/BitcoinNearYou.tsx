import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View as RNView } from 'react-native';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { BlurCardFrame } from 'components/ui/BlurCardFrame';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useBTCMapStore } from 'stores/btcMapStore';
import { useSettingsStore } from 'stores/settingsStore';
import { applySafetyOffset } from 'utils/locationPrivacy';
import { useShallow } from 'zustand/react/shallow';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Default fallback (London)
const DEFAULT_LAT = 51.5074;
const DEFAULT_LON = -0.1278;

// Mock mode location (NYC — matches mockDataStore)
const MOCK_LAT = 40.758;
const MOCK_LON = -73.9855;

const MAP_ZOOM = 13;

/** Max nearby markers to show on the preview map. */
const MAX_MARKERS = 25;

/** Rough bounding-box radius in degrees (~5 km). */
const NEARBY_RADIUS_DEG = 0.045;

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
const HAS_ANDROID_GOOGLE_MAPS_KEY = !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

// ---------------------------------------------------------------------------
// Marker type
// ---------------------------------------------------------------------------

interface MapMarker {
  id: string;
  coordinates: { latitude: number; longitude: number };
  tintColor: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Map preview sub-component
// ---------------------------------------------------------------------------

function MapPreview({
  latitude,
  longitude,
  markers,
}: {
  latitude: number;
  longitude: number;
  markers: MapMarker[];
}) {
  const { getPrimaryColor } = useTheme();
  const isIOS = Platform.OS === 'ios';

  const cameraPosition = useMemo(
    () => ({ coordinates: { latitude, longitude }, zoom: MAP_ZOOM }),
    [latitude, longitude]
  );

  return (
    <RNView style={styles.mapContainer} pointerEvents="none">
      {isIOS ? (
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

      {/* Grayscale + desaturation overlays */}
      <RNView style={mapOverlayStyles.grayscaleOverlay} pointerEvents="none" />
      <RNView style={mapOverlayStyles.grayscaleOverlaySecondary} pointerEvents="none" />
      <RNView
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
      <RNView
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

      {/* Vignette gradients — edges opaque, centre transparent */}
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
    </RNView>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const BitcoinNearYou = React.memo(function BitcoinNearYou() {
  const { getPrimaryColor } = useTheme();

  // Card frame colors — match Transactions / SpentThisMonth
  const accentColor = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
  const borderColor = useMemo(() => opacity(accentColor, 0.3), [accentColor]);
  const primary0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);

  const mockMode = useSettingsStore((s) => s.mockMode);

  // BTC Map store — places data
  const { placesCache, fetchPlaces } = useBTCMapStore(
    useShallow((s) => ({ placesCache: s.placesCache, fetchPlaces: s.fetchPlaces }))
  );

  useEffect(() => {
    fetchPlaces().catch(() => {
      // Silently fail — we'll show fallback count
    });
  }, [fetchPlaces]);

  // User location (best-effort, non-blocking) — mock mode uses NYC
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
        // Silently fail — keep default
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mockMode]);

  // Nearby places as map markers
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

  // Privacy: offset the camera centre so the preview never reveals exact location.
  // Marker filtering above still uses real coords for accurate "nearby" counts.
  const offsetCoords = useMemo(
    () => applySafetyOffset(coords.latitude, coords.longitude),
    [coords]
  );

  return (
    <Link href="/(map-flow)" asChild>
      <TouchableOpacity activeOpacity={0.85}>
        <RNView style={[styles.card, { borderColor }]}>
          <BlurCardFrame accentColor={accentColor}>
            <RNView style={styles.container}>
              {/* Map with markers — camera uses safety offset */}
              <MapPreview
                latitude={offsetCoords.latitude}
                longitude={offsetCoords.longitude}
                markers={nearbyMarkers}
              />

              {/* Title overlaid on the map — top */}
              <RNView style={styles.titleRow}>
                <Text size={14} semibold color={opacity(primary0, 0.66)}>
                  Bitcoin near you
                </Text>
                <Icon name="mdi:chevron-right" size={18} color={opacity(primary0, 0.66)} />
              </RNView>

              {/* Count pill overlaid on the map — bottom-left */}
              <RNView style={styles.countPillContainer}>
                <RNView style={[styles.countPill, { backgroundColor: opacity(primary0, 0.1) }]}>
                  <Icon name="mdi:map-marker" size={12} color={opacity(primary0, 0.66)} />
                  <Text size={11} semibold color={opacity(primary0, 0.66)}>
                    {countLabel}
                  </Text>
                </RNView>
              </RNView>
            </RNView>
          </BlurCardFrame>
        </RNView>
      </TouchableOpacity>
    </Link>
  );
});

BitcoinNearYou.displayName = 'BitcoinNearYou';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  container: {
    zIndex: 1,
    position: 'relative',
  },
  titleRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    zIndex: 2,
  },
  mapContainer: {
    height: 140,
    overflow: 'hidden',
  },
  countPillContainer: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    zIndex: 2,
  },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 100,
    borderCurve: 'continuous',
  },
});

const mapOverlayStyles = StyleSheet.create({
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
