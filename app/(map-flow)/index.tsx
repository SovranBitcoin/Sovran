/**
 * @fileoverview Bitcoin Map Screen
 *
 * Uses Mapbox's Supercluster for high-performance clustering:
 * - O(log n) spatial queries via k-d tree
 * - Battle-tested (used by Mapbox GL, Google Maps, etc.)
 * - Automatic zoom-level adaptation
 */

import Icon from 'assets/icons';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack, VStack, View } from 'components/ui/View';
import * as Location from 'expo-location';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import { Host, Button as SwiftUIButton, ContextMenu } from '@expo/ui/swift-ui';
import { frame, cornerRadius } from '@expo/ui/swift-ui/modifiers';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useTheme } from 'providers/ThemeProvider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Platform, StyleSheet } from 'react-native';
import { SheetManager } from 'react-native-actions-sheet';
import { useBTCMapStore } from 'stores/btcMapStore';
import { ClusterManager, cameraToBbox, MapMarker, GeoPoint } from 'utils/mapClustering';

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

// ============================================================================
// Components
// ============================================================================

const StatsCard = ({
  visibleCount,
  totalCount,
  loading,
  category,
  onCategoryChange,
}: {
  visibleCount: number;
  totalCount: number;
  loading: boolean;
  category: CategoryFilter;
  onCategoryChange: (cat: CategoryFilter) => void;
}) => {
  const { getPrimaryColor } = useTheme();

  return (
    <View style={styles.statsContainer}>
      <Host style={{ height: 60, width: '100%' }} matchContents fixedSize={true}>
        <ContextMenu activationMethod="singlePress">
          <ContextMenu.Items>
            {(Object.keys(CATEGORIES) as CategoryFilter[]).map((cat) => (
              <SwiftUIButton key={cat} onPress={() => onCategoryChange(cat)}>
                {CATEGORIES[cat].label}
                {cat === category ? ' ✓' : ''}
              </SwiftUIButton>
            ))}
          </ContextMenu.Items>
          <ContextMenu.Trigger>
            <SwiftUIButton variant="glass" modifiers={[frame({ height: 60 })]}>
              <HStack align="center" style={{ paddingHorizontal: 16, width: '100%' }}>
                <Icon name="mdi:bitcoin" size={24} color="#F7931A" />
                <VStack style={{ marginLeft: 12, flex: 1 }}>
                  <Text size={18} heavy style={{ color: getPrimaryColor('0') }}>
                    {loading ? '...' : `${visibleCount.toLocaleString()} visible`}
                  </Text>
                  <HStack align="center" spacing={4}>
                    <Text size={12} style={{ color: getPrimaryColor('400') }}>
                      {loading
                        ? 'Loading...'
                        : `${totalCount.toLocaleString()} total • ${CATEGORIES[category].label}`}
                    </Text>
                    <Icon name="mdi:chevron-down" size={14} color={getPrimaryColor('400')} />
                  </HStack>
                </VStack>
              </HStack>
            </SwiftUIButton>
          </ContextMenu.Trigger>
        </ContextMenu>
      </Host>
    </View>
  );
};

const FloatingActionButtons = ({
  onMyLocation,
  onZoomIn,
  onZoomOut,
}: {
  onMyLocation: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) => {
  const { getPrimaryColor } = useTheme();

  if (Platform.OS === 'ios') {
    return (
      <VStack style={styles.floatingButtons} spacing={8}>
        {/* Location Button */}
        <Host style={{ height: 48, width: 48 }} matchContents fixedSize>
          <SwiftUIButton
            variant="glass"
            modifiers={[frame({ height: 48, width: 48 }), cornerRadius(24)]}
            onPress={onMyLocation}>
            <View style={styles.circleButtonContent}>
              <Icon name="mdi:crosshairs-gps" size={22} color={getPrimaryColor('0')} />
            </View>
          </SwiftUIButton>
        </Host>

        {/* Zoom In Button */}
        <Host style={{ height: 48, width: 48 }} matchContents fixedSize>
          <SwiftUIButton
            variant="glass"
            modifiers={[frame({ height: 48, width: 48 }), cornerRadius(24)]}
            onPress={onZoomIn}>
            <View style={styles.circleButtonContent}>
              <Icon name="mdi:plus" size={22} color={getPrimaryColor('0')} />
            </View>
          </SwiftUIButton>
        </Host>

        {/* Zoom Out Button */}
        <Host style={{ height: 48, width: 48 }} matchContents fixedSize>
          <SwiftUIButton
            variant="glass"
            modifiers={[frame({ height: 48, width: 48 }), cornerRadius(24)]}
            onPress={onZoomOut}>
            <View style={styles.circleButtonContent}>
              <Icon name="mdi:minus" size={22} color={getPrimaryColor('0')} />
            </View>
          </SwiftUIButton>
        </Host>
      </VStack>
    );
  }

  // Android fallback
  return (
    <VStack style={styles.floatingButtons} spacing={8}>
      <TouchableOpacity onPress={onMyLocation} style={styles.androidCircleButton}>
        <Icon name="mdi:crosshairs-gps" size={22} color={getPrimaryColor('0')} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onZoomIn} style={styles.androidCircleButton}>
        <Icon name="mdi:plus" size={22} color={getPrimaryColor('0')} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onZoomOut} style={styles.androidCircleButton}>
        <Icon name="mdi:minus" size={22} color={getPrimaryColor('0')} />
      </TouchableOpacity>
    </VStack>
  );
};

// ============================================================================
// Main Component
// ============================================================================

function MapScreen() {
  const { getPrimaryColor } = useTheme();

  // BTCMap store
  const {
    placesCache,
    isLoading: loading,
    error,
    fetchPlaces,
    fetchPlaceDetails,
    setError,
  } = useBTCMapStore();
  const places = useMemo(() => placesCache?.data ?? [], [placesCache]);

  // Category filter
  const [category, setCategory] = useState<CategoryFilter>('all');

  // Camera state - always controlled
  const [camLat, setCamLat] = useState(DEFAULT_LAT);
  const [camLon, setCamLon] = useState(DEFAULT_LON);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  // Track last camera update time to debounce
  const lastUpdateRef = useRef(0);

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

  // Cluster manager ref
  const clusterManagerRef = useRef<ClusterManager | null>(null);
  const markersRef = useRef<MapMarker[]>([]);

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
      return;
    }

    const bbox = cameraToBbox(lat, lon, z, ASPECT_RATIO);
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

    setMarkers(mapMarkers);
    setVisibleCount(count);
  }, []);

  // Initialize/update cluster manager when points change
  useEffect(() => {
    if (filteredPoints.length === 0) {
      clusterManagerRef.current = null;
      setMarkers([]);
      setVisibleCount(0);
      return;
    }

    const manager = new ClusterManager({
      radius: 50,
      maxZoom: 17,
      minPoints: 2,
    });
    manager.load(filteredPoints);
    clusterManagerRef.current = manager;

    // Update markers with current camera
    updateMarkersForCamera(camLat, camLon, zoom);
  }, [filteredPoints]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch places on mount
  useEffect(() => {
    fetchPlaces().catch(console.error);
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
          setCamLat(clusterMarker.latitude);
          setCamLon(clusterMarker.longitude);
          setZoom(newZoom);
          updateMarkersForCamera(clusterMarker.latitude, clusterMarker.longitude, newZoom);
        }
      } else if (clusterMarker.placeId) {
        try {
          const details = await fetchPlaceDetails(clusterMarker.placeId);
          await SheetManager.show('merchant-detail', {
            payload: { place: details, isLoading: false },
          });
        } catch (err) {
          console.error('Failed to fetch place details:', err);
        }
      }
    },
    [fetchPlaceDetails, updateMarkersForCamera]
  );

  // Get user location on mount
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const loc = await Location.getCurrentPositionAsync({});
        setCamLat(loc.coords.latitude);
        setCamLon(loc.coords.longitude);
        setZoom(12);
        updateMarkersForCamera(loc.coords.latitude, loc.coords.longitude, 12);
      } catch (err) {
        console.error('Location error:', err);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // My location button
  const handleMyLocation = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({});
      setCamLat(loc.coords.latitude);
      setCamLon(loc.coords.longitude);
      setZoom(15);
      updateMarkersForCamera(loc.coords.latitude, loc.coords.longitude, 15);
    } catch (err) {
      console.error('Location error:', err);
    }
  }, [updateMarkersForCamera]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(zoom + 2, 20);
    setZoom(newZoom);
    updateMarkersForCamera(camLat, camLon, newZoom);
  }, [zoom, camLat, camLon, updateMarkersForCamera]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(zoom - 2, 1);
    setZoom(newZoom);
    updateMarkersForCamera(camLat, camLon, newZoom);
  }, [zoom, camLat, camLon, updateMarkersForCamera]);

  // Handle camera change from user gestures
  const handleCameraChange = useCallback(
    (event: { coordinates: { latitude?: number; longitude?: number }; zoom: number }) => {
      const newLat = event.coordinates.latitude ?? camLat;
      const newLon = event.coordinates.longitude ?? camLon;
      const newZoom = event.zoom;

      // Throttle updates to 100ms
      const now = Date.now();
      if (now - lastUpdateRef.current < 100) {
        return;
      }
      lastUpdateRef.current = now;

      // Update state
      setCamLat(newLat);
      setCamLon(newLon);
      setZoom(newZoom);

      // Update markers
      updateMarkersForCamera(newLat, newLon, newZoom);
    },
    [camLat, camLon, updateMarkersForCamera]
  );

  const MapComponent = Platform.OS === 'ios' ? AppleMaps : GoogleMaps;

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: getPrimaryColor('950') }]}>
        <View style={styles.errorContainer}>
          <Icon name="mdi:alert-circle" size={48} color={getPrimaryColor('400')} />
          <Text size={16} style={{ color: getPrimaryColor('300'), marginTop: 16 }}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => setError(null)}
            style={[styles.retryButton, { backgroundColor: getPrimaryColor('500') }]}>
            <Text size={14} heavy style={{ color: '#fff' }}>
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapComponent.View
        style={StyleSheet.absoluteFillObject}
        cameraPosition={{
          coordinates: { latitude: camLat, longitude: camLon },
          zoom,
        }}
        properties={{ isMyLocationEnabled: true }}
        uiSettings={{ compassEnabled: true, myLocationButtonEnabled: false }}
        markers={markers}
        onMarkerClick={handleMarkerClick}
        onCameraMove={handleCameraChange}
      />

      {loading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#F7931A" />
            <Text size={14} style={{ color: '#fff', marginTop: 12 }}>
              Loading merchants...
            </Text>
          </View>
        </View>
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

export default withSheetProvider(MapScreen);
