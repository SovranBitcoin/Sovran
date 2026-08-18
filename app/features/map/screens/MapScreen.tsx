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
import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { BITCOIN_ACCENT } from '@/shared/lib/brandColors';
import { applySafetyOffset } from '@/shared/lib/map/locationPrivacy';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Log, log, useLifecycleLogger } from '@/shared/lib/logger';
import { StatsCard, type CategoryFilter } from '../components/StatsCard';
import { useMapCamera } from '../hooks/useMapCamera';
import { useMapMarkers } from '../hooks/useMapMarkers';

// Default to Europe (most BTC merchants)
const DEFAULT_LAT = 48;
const DEFAULT_LON = 10;
const DEFAULT_ZOOM = 4;

// Track if we're ready to render the map (after transition completes)
const DEFER_MAP_RENDER_MS = 50; // Small delay to let modal animation start

const HAS_ANDROID_GOOGLE_MAPS_KEY = !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export function MapScreen() {
  useLifecycleLogger('MapScreen');
  const [foreground, accent, background, skeleton] = useThemeColor([
    'foreground',
    'accent',
    'background',
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

  // Camera and markers form a callback cycle (camera-settle → marker update,
  // marker click → camera move). Wire useMapCamera first via a ref-forwarder
  // for onCameraSettle, then update the ref to point at useMapMarkers'
  // updateMarkersForCamera during render. The ref mutation is safe because
  // no settle callback fires before the first paint.
  const onCameraSettleRef = useRef<(lat: number, lon: number, zoom: number) => void>(() => {});
  const onCameraSettle = useCallback((lat: number, lon: number, zoom: number) => {
    onCameraSettleRef.current(lat, lon, zoom);
  }, []);

  const mapCamera = useMapCamera({
    initial: { lat: DEFAULT_LAT, lon: DEFAULT_LON, zoom: DEFAULT_ZOOM },
    aspectRatio,
    onCameraSettle,
  });

  const {
    markers,
    visibleCount,
    totalCount,
    isClusteringReady,
    storeLoading,
    error,
    setError,
    fetchPlaces,
    updateMarkersForCamera,
    resolveMarker,
    clusterManagerRef,
  } = useMapMarkers({
    category,
    aspectRatio,
    isMapReady,
    getCamera: mapCamera.getCamera,
  });

  onCameraSettleRef.current = updateMarkersForCamera;

  const loading = storeLoading || !isClusteringReady;

  // Defer map rendering until after navigation transition
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsMapReady(true);
    }, DEFER_MAP_RENDER_MS);

    return () => clearTimeout(timer);
  }, []);

  // Fetch places on mount — DEFERRED
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchPlaces().catch((err) => log.error('map.places.fetch_failed', { error: err }));
    });

    return () => task.cancel();
  }, [fetchPlaces]);

  // Get user location on mount — DEFERRED and non-blocking
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const loc = await Location.getCurrentPositionAsync({});
        // Privacy: offset camera so it doesn't centre on exact position
        const safe = applySafetyOffset(loc.coords.latitude, loc.coords.longitude);
        mapCamera.setCamera({ lat: safe.latitude, lon: safe.longitude, zoom: 12 });
        updateMarkersForCamera(safe.latitude, safe.longitude, 12);
      } catch (err) {
        log.error('map.location.error', { error: err });
      }
    });

    return () => task.cancel();
  }, [mapCamera, updateMarkersForCamera]);

  const handleMyLocation = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({});
      const safe = applySafetyOffset(loc.coords.latitude, loc.coords.longitude);
      mapCamera.setCamera({ lat: safe.latitude, lon: safe.longitude, zoom: 15 });
      updateMarkersForCamera(safe.latitude, safe.longitude, 15);
    } catch (err) {
      log.error('map.location.error', { error: err });
    }
  }, [mapCamera, updateMarkersForCamera]);

  const handleZoomIn = useCallback(() => {
    const { lat, lon, zoom } = mapCamera.getCamera();
    const newZoom = Math.min(zoom + 2, 20);
    mapCamera.setCamera({ lat, lon, zoom: newZoom });
    updateMarkersForCamera(lat, lon, newZoom);
  }, [mapCamera, updateMarkersForCamera]);

  const handleZoomOut = useCallback(() => {
    const { lat, lon, zoom } = mapCamera.getCamera();
    const newZoom = Math.max(zoom - 2, 1);
    mapCamera.setCamera({ lat, lon, zoom: newZoom });
    updateMarkersForCamera(lat, lon, newZoom);
  }, [mapCamera, updateMarkersForCamera]);

  const handleMarkerClick = useCallback(
    async (marker: { id?: string }) => {
      if (!marker.id) return;

      const clusterMarker = resolveMarker(marker.id);
      if (!clusterMarker) return;

      if (clusterMarker.type === 'cluster' && clusterMarker.clusterId !== undefined) {
        const manager = clusterManagerRef.current;
        if (manager) {
          // Supercluster's getClusterExpansionZoom returns the zoom at which
          // this cluster's children become individually visible. We zoom one
          // step past that so the children actually separate in the viewport
          // instead of re-clustering at the threshold; capped at 18 to stay
          // within Supercluster's maxZoom + 1.
          const expansionZoom = manager.getClusterExpansionZoom(clusterMarker.clusterId);
          const newZoom = Math.min(expansionZoom + 1, 18);
          mapCamera.setCamera({
            lat: clusterMarker.latitude,
            lon: clusterMarker.longitude,
            zoom: newZoom,
          });
          updateMarkersForCamera(clusterMarker.latitude, clusterMarker.longitude, newZoom);
        }
      } else if (clusterMarker.placeId) {
        router.navigate({
          pathname: '/(map-flow)/detail',
          params: { placeId: clusterMarker.placeId.toString() },
        });
      }
    },
    [resolveMarker, clusterManagerRef, mapCamera, updateMarkersForCamera]
  );

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
            onPress={mapUnavailableOnAndroid ? () => router.back() : () => setError(null)}
            style={[styles.retryButton, { backgroundColor: accent }]}>
            <Text size={14} heavy style={{ color: '#fff' }}>
              {mapUnavailableOnAndroid ? 'Go back' : 'Retry'}
            </Text>
          </Pressable>
        </View>
      </Log>
    );
  }

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
          an `any` cast at the union seam. */}
      {isMapReady && Platform.OS === 'ios' && (
        <AppleMaps.View
          ref={(instance) => {
            mapCamera.mapRef.current = instance;
          }}
          style={StyleSheet.absoluteFill}
          cameraPosition={{
            coordinates: { latitude: DEFAULT_LAT, longitude: DEFAULT_LON },
            zoom: DEFAULT_ZOOM,
          }}
          properties={{ isMyLocationEnabled: false }}
          uiSettings={{ compassEnabled: true, myLocationButtonEnabled: false }}
          markers={markers}
          onMarkerClick={handleMarkerClick}
          onCameraMove={mapCamera.handleCameraChange}
        />
      )}
      {isMapReady && Platform.OS === 'android' && (
        <GoogleMaps.View
          ref={(instance) => {
            mapCamera.mapRef.current = instance;
          }}
          style={StyleSheet.absoluteFill}
          cameraPosition={{
            coordinates: { latitude: DEFAULT_LAT, longitude: DEFAULT_LON },
            zoom: DEFAULT_ZOOM,
          }}
          properties={{ isMyLocationEnabled: false }}
          uiSettings={{ compassEnabled: true, myLocationButtonEnabled: false }}
          markers={markers}
          onMarkerClick={handleMarkerClick}
          onCameraMove={mapCamera.handleCameraChange}
        />
      )}

      <StatsCard
        visibleCount={visibleCount}
        totalCount={totalCount}
        loading={loading}
        category={category}
        onCategoryChange={setCategory}
        cardWidth={statsCardWidth}
      />

      <VStack style={styles.floatingButtons} gap={8}>
        <CircleActionButton
          icon="mdi:crosshairs-gps"
          systemIcon="location.fill"
          onPress={handleMyLocation}
          testID="map-locate"
        />
        <CircleActionButton
          icon="mdi:plus"
          systemIcon="plus"
          onPress={handleZoomIn}
          testID="map-zoom-in"
        />
        <CircleActionButton
          icon="mdi:minus"
          systemIcon="minus"
          onPress={handleZoomOut}
          testID="map-zoom-out"
        />
      </VStack>
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
  floatingButtons: {
    position: 'absolute',
    right: 16,
    bottom: 110,
  },
});
