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
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import * as Location from 'expo-location';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import {
  Host,
  Button as SwiftUIButton,
  ContextMenu,
  HStack as SwiftUIHStack,
  VStack as SwiftUIVStack,
  Image as SwiftUIImage,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  InteractionManager,
  Platform,
  StyleSheet,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useBTCMapStore } from '@/shared/stores/global/btcMapStore';
import { ClusterManager, cameraToBbox, MapMarker, GeoPoint } from '@/shared/lib/map/mapClustering';
import { useShallow } from 'zustand/react/shallow';
import { getOrBuildBTCMapClusterManager } from '@/shared/lib/map/btcMapClusterCache';
import { applySafetyOffset } from '@/shared/lib/map/locationPrivacy';

// ============================================================================
// Types & Constants
// ============================================================================

type CategoryFilter = 'all' | 'food' | 'retail' | 'atm' | 'accommodation' | 'services';

const CATEGORIES: Record<CategoryFilter, { label: string; icons: string[] }> = {
  all: { label: 'All Merchants', icons: [] },
  food: {
    label: 'Food & Drink',
    icons: ['local_cafe', 'lunch_dining', 'restaurant', 'bakery_dining'],
  },
  retail: {
    label: 'Retail & Shopping',
    icons: ['storefront', 'local_grocery_store', 'computer', 'diamond'],
  },
  atm: {
    label: 'ATMs & Exchange',
    icons: ['local_atm', 'currency_exchange'],
  },
  accommodation: {
    label: 'Accommodation',
    icons: ['hotel', 'spa'],
  },
  services: {
    label: 'Services',
    icons: [
      'medical_services',
      'local_pharmacy',
      'content_cut',
      'car_repair',
      'fitness_center',
      'business',
    ],
  },
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ASPECT_RATIO = SCREEN_WIDTH / SCREEN_HEIGHT;

// Default to Europe (most BTC merchants)
const DEFAULT_LAT = 48;
const DEFAULT_LON = 10;
const DEFAULT_ZOOM = 4;

// Track if we're ready to render the map (after transition completes)
const DEFER_MAP_RENDER_MS = 50; // Small delay to let modal animation start

// Numeric width for the stats card Host (percentage widths don't work with SwiftUI Host)
const STATS_CARD_WIDTH = SCREEN_WIDTH - 32; // matches left: 16 + right: 16
const HAS_ANDROID_GOOGLE_MAPS_KEY = !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

// ============================================================================
// Components
// ============================================================================

type StatsCardProps = {
  visibleCount: number;
  totalCount: number;
  loading: boolean;
  category: CategoryFilter;
  onCategoryChange: (cat: CategoryFilter) => void;
};

const StatsCard = memo(function StatsCard({
  visibleCount,
  totalCount,
  loading,
  category,
  onCategoryChange,
}: StatsCardProps) {
  const foreground = useThemeColor('foreground');

  const visibleText = loading ? '...' : `${visibleCount.toLocaleString()} visible`;
  const totalText = loading
    ? 'Loading...'
    : `${totalCount.toLocaleString()} total • ${CATEGORIES[category].label}`;

  return (
    <View style={styles.statsContainer}>
      <Host style={{ zIndex: 10, height: 60, width: STATS_CARD_WIDTH }} matchContents>
        <ContextMenu>
          <ContextMenu.Items>
            {(Object.keys(CATEGORIES) as CategoryFilter[]).map((cat) => (
              <SwiftUIButton
                key={cat}
                label={`${CATEGORIES[cat].label}${cat === category ? ' ✓' : ''}`}
                onPress={() => onCategoryChange(cat)}
              />
            ))}
          </ContextMenu.Items>
          <ContextMenu.Trigger>
            <SwiftUIHStack>
              <SwiftUIButton
                modifiers={[
                  // buttonStyle('glass'),
                  frame({ width: STATS_CARD_WIDTH, height: 60, alignment: 'center' }),
                  glassEffect({
                    shape: 'capsule',
                    glass: { variant: 'regular', interactive: true },
                  }),
                ]}>
                <SwiftUIHStack
                  alignment="center"
                  spacing={12}
                  modifiers={[
                    frame({ maxWidth: Infinity, height: 60, alignment: 'leading' }),
                    padding({ horizontal: 16 }),
                  ]}>
                  <SwiftUIImage systemName="bitcoinsign.circle.fill" size={24} color="#F7931A" />
                  <SwiftUIVStack alignment="leading" spacing={2}>
                    <SwiftUIText
                      modifiers={[font({ size: 18, weight: 'bold' }), foregroundStyle(foreground)]}>
                      {visibleText}
                    </SwiftUIText>
                    <SwiftUIHStack alignment="center" spacing={4}>
                      <SwiftUIText modifiers={[font({ size: 12 }), foregroundStyle(foreground)]}>
                        {totalText}
                      </SwiftUIText>
                      <SwiftUIImage systemName="chevron.down" size={10} color={foreground} />
                    </SwiftUIHStack>
                  </SwiftUIVStack>
                </SwiftUIHStack>
              </SwiftUIButton>
            </SwiftUIHStack>
          </ContextMenu.Trigger>
        </ContextMenu>
      </Host>
    </View>
  );
});

type FloatingActionButtonsProps = {
  onMyLocation: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

const FloatingActionButtons = memo(function FloatingActionButtons({
  onMyLocation,
  onZoomIn,
  onZoomOut,
}: FloatingActionButtonsProps) {
  const foreground = useThemeColor('foreground');

  if (Platform.OS === 'ios') {
    return (
      <VStack style={styles.floatingButtons} spacing={8}>
        {/* Location Button */}
        <Host style={{ height: 48, width: 48 }} matchContents={false}>
          <SwiftUIButton
            modifiers={[
              buttonStyle('glass'),
              frame({ height: 48, width: 48 }),
              glassEffect({
                shape: 'circle',
                glass: { variant: 'regular', interactive: true },
              }),
            ]}
            onPress={onMyLocation}>
            <SwiftUIHStack
              alignment="center"
              modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' })]}>
              <SwiftUIImage systemName="location.fill" size={20} color={foreground} />
            </SwiftUIHStack>
          </SwiftUIButton>
        </Host>

        {/* Zoom In Button */}
        <Host style={{ height: 48, width: 48 }} matchContents={false}>
          <SwiftUIButton
            modifiers={[
              buttonStyle('glass'),
              frame({ height: 48, width: 48 }),
              glassEffect({
                shape: 'circle',
                glass: { variant: 'regular', interactive: true },
              }),
            ]}
            onPress={onZoomIn}>
            <SwiftUIHStack
              alignment="center"
              modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' })]}>
              <SwiftUIImage systemName="plus" size={20} color={foreground} />
            </SwiftUIHStack>
          </SwiftUIButton>
        </Host>

        {/* Zoom Out Button */}
        <Host style={{ height: 48, width: 48 }} matchContents={false}>
          <SwiftUIButton
            modifiers={[
              buttonStyle('glass'),
              frame({ height: 48, width: 48 }),
              glassEffect({
                shape: 'circle',
                glass: { variant: 'regular', interactive: true },
              }),
            ]}
            onPress={onZoomOut}>
            <SwiftUIHStack
              alignment="center"
              modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' })]}>
              <SwiftUIImage systemName="minus" size={20} color={foreground} />
            </SwiftUIHStack>
          </SwiftUIButton>
        </Host>
      </VStack>
    );
  }

  // Android fallback
  return (
    <VStack style={styles.floatingButtons} spacing={8}>
      <TouchableOpacity onPress={onMyLocation} style={styles.androidCircleButton}>
        <Icon name="mdi:crosshairs-gps" size={22} color={foreground} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onZoomIn} style={styles.androidCircleButton}>
        <Icon name="mdi:plus" size={22} color={foreground} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onZoomOut} style={styles.androidCircleButton}>
        <Icon name="mdi:minus" size={22} color={foreground} />
      </TouchableOpacity>
    </VStack>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export function MapScreen() {
  const [foreground, accent, background] = useThemeColor([
    'foreground',
    'accent',
    'background',
  ] as const);

  // BTCMap store
  const { placesCache, storeLoading, error, fetchPlaces, setError } = useBTCMapStore(
    useShallow((s) => ({
      placesCache: s.placesCache,
      storeLoading: s.isLoading,
      error: s.error,
      fetchPlaces: s.fetchPlaces,
      setError: s.setError,
    }))
  );
  const places = useMemo(() => placesCache?.data ?? [], [placesCache]);

  // Track initialization stages for progressive loading
  const [isMapReady, setIsMapReady] = useState(false);
  const [isClusteringReady, setIsClusteringReady] = useState(false);

  // Combined loading state
  const loading = storeLoading || !isClusteringReady;

  // Category filter
  const [category, setCategory] = useState<CategoryFilter>('all');

  // Map ref allows "uncontrolled" camera updates (keeps dragging smooth)
  const mapRef = useRef<any>(null);

  // Camera refs (do not store in React state — avoids rerenders while panning)
  const cameraRef = useRef({ lat: DEFAULT_LAT, lon: DEFAULT_LON, zoom: DEFAULT_ZOOM });

  const setMapCamera = useCallback((next: { lat: number; lon: number; zoom: number }) => {
    cameraRef.current = next;

    const config: any =
      Platform.OS === 'android'
        ? {
            coordinates: { latitude: next.lat, longitude: next.lon },
            zoom: next.zoom,
            duration: 250,
          }
        : { coordinates: { latitude: next.lat, longitude: next.lon }, zoom: next.zoom };

    mapRef.current?.setCameraPosition?.(config);
  }, []);

  // Debounce marker updates (markers prop updates are expensive for native maps)
  const markerUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMarkerQueryRef = useRef<{ lat: number; lon: number; zoomFloor: number } | null>(null);
  const markerUpdateTaskRef = useRef<{ cancel: () => void } | null>(null);

  // Cleanup pending timers on unmount
  useEffect(() => {
    return () => {
      if (markerUpdateTimerRef.current) {
        clearTimeout(markerUpdateTimerRef.current);
        markerUpdateTimerRef.current = null;
      }
      if (markerUpdateTaskRef.current) {
        markerUpdateTaskRef.current.cancel();
        markerUpdateTaskRef.current = null;
      }
    };
  }, []);

  // Markers state
  const [markers, setMarkers] = useState<
    {
      id: string;
      coordinates: { latitude: number; longitude: number };
      tintColor: string;
      title: string;
    }[]
  >([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const lastRenderedMarkersRef = useRef<typeof markers>([]);
  const lastRenderedVisibleCountRef = useRef<number>(0);

  // Cluster manager ref
  const clusterManagerRef = useRef<ClusterManager | null>(null);
  const markersRef = useRef<MapMarker[]>([]);

  const clusterCacheKey = useMemo(() => {
    // Use the persisted cache timestamp to keep cluster index stable across modal opens.
    const ts = placesCache?.timestamp ?? 'no-cache';
    return `btcmap:${ts}:${category}`;
  }, [placesCache?.timestamp, category]);

  // Filter points by category
  const filteredPoints = useMemo((): GeoPoint[] => {
    if (category === 'all') {
      return places.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, icon: p.icon }));
    }
    const icons = CATEGORIES[category].icons;
    return places
      .filter((p) => icons.includes(p.icon))
      .map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, icon: p.icon }));
  }, [places, category]);

  // Update markers for given camera position
  const updateMarkersForCamera = useCallback((lat: number, lon: number, z: number) => {
    const manager = clusterManagerRef.current;
    if (!manager || !manager.isLoaded()) {
      setMarkers([]);
      setVisibleCount(0);
      lastRenderedMarkersRef.current = [];
      lastRenderedVisibleCountRef.current = 0;
      return;
    }

    // Avoid querying a padded bbox that's too large at high zoom (lots of pins)
    const padding = z >= 14 ? 0.25 : z >= 10 ? 0.5 : 0.75;
    const bbox = cameraToBbox(lat, lon, z, ASPECT_RATIO, padding);
    const clustered = manager.getClusters(bbox, z);
    markersRef.current = clustered;

    let count = 0;
    for (const m of clustered) {
      count += m.count;
    }

    const mapMarkers = clustered.map((m) => ({
      id: m.id,
      coordinates: { latitude: m.latitude, longitude: m.longitude },
      tintColor: m.tintColor,
      title: m.type === 'cluster' ? `📍 ${m.count} merchants` : m.title,
    }));

    // Avoid re-setting state if markers/count didn't actually change (saves JS + native work)
    const prevMarkers = lastRenderedMarkersRef.current;
    const sameCount = lastRenderedVisibleCountRef.current === count;
    let sameMarkers = prevMarkers.length === mapMarkers.length;
    if (sameMarkers) {
      for (let i = 0; i < mapMarkers.length; i++) {
        const a = prevMarkers[i];
        const b = mapMarkers[i];
        if (
          a.id !== b.id ||
          a.coordinates.latitude !== b.coordinates.latitude ||
          a.coordinates.longitude !== b.coordinates.longitude ||
          a.tintColor !== b.tintColor ||
          a.title !== b.title
        ) {
          sameMarkers = false;
          break;
        }
      }
    }

    if (sameMarkers && sameCount) return;

    lastRenderedMarkersRef.current = mapMarkers;
    lastRenderedVisibleCountRef.current = count;
    setMarkers(mapMarkers);
    setVisibleCount(count);
  }, []);

  // Defer map rendering until after navigation transition
  useEffect(() => {
    // Small delay to let the modal open animation start
    const timer = setTimeout(() => {
      setIsMapReady(true);
    }, DEFER_MAP_RENDER_MS);

    return () => clearTimeout(timer);
  }, []);

  // Initialize/update cluster manager when points change - DEFERRED
  // Performance: on category switches, keep old markers visible while rebuilding.
  // Only show loading overlay on initial load (no markers yet).
  useEffect(() => {
    if (filteredPoints.length === 0) {
      clusterManagerRef.current = null;
      setMarkers([]);
      setVisibleCount(0);
      setIsClusteringReady(true);
      return;
    }

    // Only show loading overlay on initial load, not on category switches
    const isInitialLoad = lastRenderedMarkersRef.current.length === 0;
    if (isInitialLoad) {
      setIsClusteringReady(false);
    }

    // Defer clustering work until after interactions complete
    const task = InteractionManager.runAfterInteractions(() => {
      const manager = getOrBuildBTCMapClusterManager(clusterCacheKey, filteredPoints, {
        radius: 50,
        maxZoom: 17,
        minPoints: 2,
      });
      clusterManagerRef.current = manager;

      // Update markers with current camera
      const { lat, lon, zoom } = cameraRef.current;
      updateMarkersForCamera(lat, lon, zoom);
      setIsClusteringReady(true);
    });

    return () => task.cancel();
  }, [filteredPoints, clusterCacheKey, updateMarkersForCamera]);

  // Fetch places on mount - DEFERRED
  useEffect(() => {
    // Defer fetch until after modal transition completes
    const task = InteractionManager.runAfterInteractions(() => {
      fetchPlaces().catch(console.error);
    });

    return () => task.cancel();
  }, [fetchPlaces]);

  // Handle marker click
  const handleMarkerClick = useCallback(
    async (marker: { id?: string }) => {
      if (!marker.id) return;

      const clusterMarker = markersRef.current.find((m) => m.id === marker.id);
      if (!clusterMarker) return;

      if (clusterMarker.type === 'cluster' && clusterMarker.clusterId !== undefined) {
        const manager = clusterManagerRef.current;
        if (manager) {
          const expansionZoom = manager.getClusterExpansionZoom(clusterMarker.clusterId);
          const newZoom = Math.min(expansionZoom + 1, 18);
          setMapCamera({
            lat: clusterMarker.latitude,
            lon: clusterMarker.longitude,
            zoom: newZoom,
          });
          updateMarkersForCamera(clusterMarker.latitude, clusterMarker.longitude, newZoom);
        }
      } else if (clusterMarker.placeId) {
        // Navigate to the detail screen within the flow
        router.navigate({
          pathname: '/(map-flow)/detail',
          params: { placeId: clusterMarker.placeId.toString() },
        });
      }
    },
    [setMapCamera, updateMarkersForCamera]
  );

  // Get user location on mount - DEFERRED and non-blocking
  useEffect(() => {
    // Defer location request until after interactions complete
    const task = InteractionManager.runAfterInteractions(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          return;
        }

        const loc = await Location.getCurrentPositionAsync({});
        // Privacy: offset camera so it doesn't centre on exact position
        const safe = applySafetyOffset(loc.coords.latitude, loc.coords.longitude);
        setMapCamera({ lat: safe.latitude, lon: safe.longitude, zoom: 12 });
        updateMarkersForCamera(safe.latitude, safe.longitude, 12);
      } catch (err) {
        console.error('Location error:', err);
      }
    });

    return () => task.cancel();
  }, [setMapCamera, updateMarkersForCamera]);

  // My location button — applies safety offset so camera doesn't centre on exact position
  const handleMyLocation = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({});
      const safe = applySafetyOffset(loc.coords.latitude, loc.coords.longitude);
      setMapCamera({ lat: safe.latitude, lon: safe.longitude, zoom: 15 });
      updateMarkersForCamera(safe.latitude, safe.longitude, 15);
    } catch (err) {
      console.error('Location error:', err);
    }
  }, [setMapCamera, updateMarkersForCamera]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    const { lat, lon, zoom } = cameraRef.current;
    const newZoom = Math.min(zoom + 2, 20);
    setMapCamera({ lat, lon, zoom: newZoom });
    updateMarkersForCamera(lat, lon, newZoom);
  }, [setMapCamera, updateMarkersForCamera]);

  const handleZoomOut = useCallback(() => {
    const { lat, lon, zoom } = cameraRef.current;
    const newZoom = Math.max(zoom - 2, 1);
    setMapCamera({ lat, lon, zoom: newZoom });
    updateMarkersForCamera(lat, lon, newZoom);
  }, [setMapCamera, updateMarkersForCamera]);

  // Handle camera change from user gestures
  const handleCameraChange = useCallback(
    (event: { coordinates: { latitude?: number; longitude?: number }; zoom: number }) => {
      const prev = cameraRef.current;
      const newLat = event.coordinates.latitude ?? prev.lat;
      const newLon = event.coordinates.longitude ?? prev.lon;
      const newZoom = event.zoom;

      // Track latest camera without triggering React rerenders
      cameraRef.current = { lat: newLat, lon: newLon, zoom: newZoom };

      // Debounce marker queries and skip tiny movements within the current zoom bucket
      const zoomFloor = Math.floor(newZoom);
      const last = lastMarkerQueryRef.current;
      const span = 360 / Math.pow(2, Math.max(newZoom, 0));
      const latThreshold = span * 0.12;
      const lonThreshold = span * ASPECT_RATIO * 0.12;
      const shouldSkip =
        last &&
        last.zoomFloor === zoomFloor &&
        Math.abs(newLat - last.lat) < latThreshold &&
        Math.abs(newLon - last.lon) < lonThreshold;

      if (shouldSkip) return;

      if (markerUpdateTimerRef.current) {
        clearTimeout(markerUpdateTimerRef.current);
      }

      markerUpdateTimerRef.current = setTimeout(() => {
        lastMarkerQueryRef.current = { lat: newLat, lon: newLon, zoomFloor };
        // Ensure marker recalculation doesn't compete with gestures/animations
        if (markerUpdateTaskRef.current) markerUpdateTaskRef.current.cancel();
        markerUpdateTaskRef.current = InteractionManager.runAfterInteractions(() => {
          updateMarkersForCamera(newLat, newLon, newZoom);
        });
      }, 250);
    },
    [updateMarkersForCamera]
  );

  const MapComponent = Platform.OS === 'ios' ? AppleMaps : GoogleMaps;
  const mapUnavailableOnAndroid = Platform.OS === 'android' && !HAS_ANDROID_GOOGLE_MAPS_KEY;

  if (error || mapUnavailableOnAndroid) {
    return (
      <View style={[styles.container, { backgroundColor: background }]}>
        <View style={styles.errorContainer}>
          <Icon name="mdi:alert-circle" size={48} color={opacity(foreground, 0.4)} />
          <Text size={16} style={{ color: opacity(foreground, 0.5), marginTop: 16 }}>
            {mapUnavailableOnAndroid
              ? 'Google Maps is not configured for Android. Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY and rebuild.'
              : error}
          </Text>
          <TouchableOpacity
            onPress={mapUnavailableOnAndroid ? () => router.back() : () => setError(null)}
            style={[styles.retryButton, { backgroundColor: accent }]}>
            <Text size={14} heavy style={{ color: '#fff' }}>
              {mapUnavailableOnAndroid ? 'Go back' : 'Retry'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Show a placeholder background immediately while map loads */}
      {!isMapReady && (
        <View style={[StyleSheet.absoluteFillObject, styles.mapSkeleton]}>
          <ActivityIndicator size="large" color="#F7931A" />
          <Text size={14} style={{ color: '#fff', marginTop: 16, opacity: 0.8 }}>
            Loading map...
          </Text>
        </View>
      )}

      {/* Render map only after initial transition */}
      {isMapReady && (
        <MapComponent.View
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          cameraPosition={{
            coordinates: { latitude: DEFAULT_LAT, longitude: DEFAULT_LON },
            zoom: DEFAULT_ZOOM,
          }}
          properties={{ isMyLocationEnabled: false }}
          uiSettings={{ compassEnabled: true, myLocationButtonEnabled: false }}
          markers={markers}
          onMarkerClick={handleMarkerClick}
          onCameraMove={handleCameraChange}
        />
      )}

      {/* Show loading overlay while fetching data (after map is visible) */}
      {isMapReady && loading && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#F7931A" />
            <Text size={14} style={{ color: '#fff', marginTop: 12 }}>
              Loading merchants...
            </Text>
          </View>
        </Animated.View>
      )}

      <StatsCard
        visibleCount={visibleCount}
        totalCount={filteredPoints.length}
        loading={loading}
        category={category}
        onCategoryChange={setCategory}
      />

      <FloatingActionButtons
        onMyLocation={handleMyLocation}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
      />
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapSkeleton: {
    backgroundColor: '#1a1a2e',
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
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  loadingCard: {
    padding: 24,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
  },
  statsContainer: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
  },
  floatingButtons: {
    position: 'absolute',
    right: 16,
    bottom: 110,
  },
  circleButtonContent: {
    width: 24,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidCircleButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
