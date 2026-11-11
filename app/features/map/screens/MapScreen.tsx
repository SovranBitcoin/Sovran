/**
 * @fileoverview Bitcoin Map Screen
 *
 * Uses Mapbox's Supercluster for high-performance clustering:
 * - O(log n) spatial queries via k-d tree
 * - Battle-tested (used by Mapbox GL, Google Maps, etc.)
 * - Automatic zoom-level adaptation
 *
 * Performance optimizations:
 * - Shows screen immediately with skeleton/loading state
 * - Defers heavy operations using InteractionManager
 * - Location fetch runs in parallel, doesn't block UI
 */

import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import * as Location from 'expo-location';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { withAlpha } from '@/shared/lib/color';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { useScreenInsets } from '@/shared/hooks/useScreenInsets';
import { spacing } from '@/shared/styles/tokens';
import { useEffect, useState } from 'react';
import { InteractionManager, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { BITCOIN_ACCENT } from '@/shared/lib/brandColors';
import { applySafetyOffset } from '@/shared/lib/map/locationPrivacy';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Log, mapLog, useLifecycleLogger } from '@/shared/lib/logger';
import { StatsCard, type CategoryFilter } from '../components/StatsCard';
import { useMerchantMap } from '../hooks/useMerchantMap';

// Default to Europe (most BTC merchants)
const DEFAULT_LAT = 48;
const DEFAULT_LON = 10;
const DEFAULT_ZOOM = 4;

// Track if we're ready to render the map (after transition completes)
const DEFER_MAP_RENDER_MS = 50; // Small delay to let modal animation start

const HAS_ANDROID_GOOGLE_MAPS_KEY = !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export function MapScreen() {
  const { bottom } = useScreenInsets();
  const bottomOverlayStyle = { bottom: bottom + spacing.lg };
  useLifecycleLogger('MapScreen');
  const [foreground, accent, background, skeleton] = useThemeColor([
    'foreground',
    'accent',
    'surface',
    'skeleton',
  ] as const);

  // Reactive viewport dimensions — bbox math and the stats card both depend on
  // the live aspect ratio so rotation, foldables, and split-screen reflow.
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const aspectRatio = viewportWidth / viewportHeight;
  const statsCardWidth = viewportWidth - 32; // matches stats container padding

  // Track initialization stages for progressive loading
  const [isMapReady, setIsMapReady] = useState(false);
  const [category, setCategory] = useState<CategoryFilter>('all');

  const {
    mapRef,
    handleCameraChange,
    markers,
    visibleCount,
    totalCount,
    loading,
    error,
    retry,
    moveTo,
    zoomBy,
    pressMarker,
  } = useMerchantMap({
    category,
    aspectRatio,
    isMapReady,
    initial: { lat: DEFAULT_LAT, lon: DEFAULT_LON, zoom: DEFAULT_ZOOM },
  });

  // Defer map rendering until after navigation transition
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsMapReady(true);
    }, DEFER_MAP_RENDER_MS);

    return () => clearTimeout(timer);
  }, []);

  // Get user location on mount — DEFERRED and non-blocking. Once: `moveTo`
  // changes with the window's aspect ratio, and a resize must not send the
  // camera back to the person's position.
  const latestMoveTo = useLatestRef(moveTo);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const loc = await Location.getCurrentPositionAsync({});
        // Privacy: offset camera so it doesn't centre on exact position
        const safe = applySafetyOffset(loc.coords);
        latestMoveTo.current({ lat: safe.latitude, lon: safe.longitude, zoom: 12 });
      } catch (err) {
        mapLog.error('map.location.error', { error: err });
      }
    });

    return () => task.cancel();
  }, [latestMoveTo]);

  const handleMyLocation = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({});
      const safe = applySafetyOffset(loc.coords);
      moveTo({ lat: safe.latitude, lon: safe.longitude, zoom: 15 });
    } catch (err) {
      mapLog.error('map.location.error', { error: err });
    }
  };

  const handleMarkerClick = (marker: { id?: string }) => {
    const placeId = marker.id ? pressMarker(marker.id) : undefined;
    if (placeId) {
      router.navigate({ pathname: '/(map-flow)/detail', params: { placeId: placeId.toString() } });
    }
  };

  const mapUnavailableOnAndroid = Platform.OS === 'android' && !HAS_ANDROID_GOOGLE_MAPS_KEY;

  if (error || mapUnavailableOnAndroid) {
    return (
      <Log name="MapScreen" style={{ flex: 1, backgroundColor: background }}>
        <View style={styles.errorContainer}>
          <Icon name="mdi:alert-circle" size={48} color={withAlpha(foreground, 0.4)} />
          <Text size={16} style={{ color: withAlpha(foreground, 0.5), marginTop: 16 }}>
            {mapUnavailableOnAndroid
              ? 'Google Maps is not configured for Android. Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY and rebuild.'
              : error}
          </Text>
          <Pressable
            onPress={mapUnavailableOnAndroid ? () => router.back() : retry}
            style={[styles.retryButton, { backgroundColor: accent }]}>
            <Text size={14} heavy style={{ color: '#fff' }}>
              {mapUnavailableOnAndroid ? 'Go back' : 'Retry'}
            </Text>
          </Pressable>
        </View>
      </Log>
    );
  }

  // Identical prop bag for both platform map views (the ref is the only
  // per-platform piece — see the comment at the render site).
  const sharedMapViewProps = {
    style: StyleSheet.absoluteFill,
    cameraPosition: {
      coordinates: { latitude: DEFAULT_LAT, longitude: DEFAULT_LON },
      zoom: DEFAULT_ZOOM,
    },
    properties: { isMyLocationEnabled: false },
    uiSettings: { compassEnabled: true, myLocationButtonEnabled: false },
    markers,
    onMarkerClick: handleMarkerClick,
    onCameraMove: handleCameraChange,
  };

  return (
    <Log name="MapScreen" style={styles.container}>
      {/* Show a placeholder background immediately while map loads */}
      {!isMapReady && (
        <View style={[StyleSheet.absoluteFill, styles.mapSkeleton, { backgroundColor: skeleton }]}>
          <Spinner size={32} color={BITCOIN_ACCENT} />
          <Text size={14} style={{ color: withAlpha(foreground, 0.8), marginTop: 16 }}>
            Loading map...
          </Text>
        </View>
      )}

      {/* Render map only after initial transition. Platform-branched so the
          ref typechecks against each view's concrete type instead of forcing
          an `any` cast at the union seam; everything but the element type is
          the shared prop bag below. */}
      {isMapReady && Platform.OS === 'ios' && (
        <AppleMaps.View
          ref={(instance) => {
            mapRef.current = instance;
          }}
          {...sharedMapViewProps}
        />
      )}
      {isMapReady && Platform.OS === 'android' && (
        <GoogleMaps.View
          ref={(instance) => {
            mapRef.current = instance;
          }}
          {...sharedMapViewProps}
        />
      )}

      {/* Keep controls and the category card in normal flow within one safe-area
          anchor so different card heights cannot overlap the zoom buttons. */}
      <View
        pointerEvents="box-none"
        className="absolute left-4 right-4 gap-4"
        style={bottomOverlayStyle}>
        <VStack pointerEvents="box-none" className="gap-2 self-end">
          <CircleActionButton
            icon="mdi:crosshairs-gps"
            systemIcon="location.fill"
            onPress={handleMyLocation}
            testID="map-locate"
          />
          <CircleActionButton
            icon="mdi:plus"
            systemIcon="plus"
            onPress={() => zoomBy(2)}
            testID="map-zoom-in"
          />
          <CircleActionButton
            icon="mdi:minus"
            systemIcon="minus"
            onPress={() => zoomBy(-2)}
            testID="map-zoom-out"
          />
        </VStack>
        <StatsCard
          visibleCount={visibleCount}
          totalCount={totalCount}
          loading={loading}
          category={category}
          onCategoryChange={setCategory}
          cardWidth={statsCardWidth}
        />
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapSkeleton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
});
