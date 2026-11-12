import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useIsFocused } from 'expo-router';
import { useBTCMapStore } from '@/shared/stores/global/btcMapStore';
import { ClusterManager, cameraToBbox, MapMarker, GeoPoint } from '@/shared/lib/map/mapClustering';
import {
  getCachedBTCMapClusterManager,
  getOrBuildBTCMapClusterManager,
} from '@/shared/lib/map/btcMapClusterCache';
import { getIconsForCategory } from '@/shared/lib/map/categories';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { deferWork, mapLog } from '@/shared/lib/logger';
import type { CategoryFilter } from '../components/StatsCard';
import { useMapCamera } from './useMapCamera';

type MapCamera = { lat: number; lon: number; zoom: number };

type RenderedMarker = {
  id: string;
  coordinates: { latitude: number; longitude: number };
  tintColor: string;
  title: string;
};

type UseMerchantMapOptions = {
  category: CategoryFilter;
  aspectRatio: number;
  isMapReady: boolean;
  initial: MapCamera;
};

type UseMerchantMap = Pick<ReturnType<typeof useMapCamera>, 'mapRef' | 'handleCameraChange'> & {
  markers: RenderedMarker[];
  visibleCount: number;
  totalCount: number;
  /** The places are loading, or the first index for them is being built. */
  loading: boolean;
  error: string | null;
  /** Clear the error and load the places again. */
  retry: () => void;
  /** Move the camera and show the pins for it at once. */
  moveTo: (camera: MapCamera) => void;
  /** Zoom in (`delta` > 0, up to 20) or out (down to 1) from the current camera. */
  zoomBy: (delta: number) => void;
  /** A cluster zooms in until its children separate; a merchant gives its place id. */
  pressMarker: (id: string) => number | undefined;
};

/**
 * The merchant map: the BTC Map places loaded once on open, their cluster
 * index, the camera, and the pins for it. Every camera move, the user's or a
 * programmatic one, recomputes the pins.
 */
export function useMerchantMap({
  category,
  aspectRatio,
  isMapReady,
  initial,
}: UseMerchantMapOptions): UseMerchantMap {
  const isFocused = useIsFocused();
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

  const [isClusteringReady, setIsClusteringReady] = useState(false);
  const [markers, setMarkers] = useState<RenderedMarker[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);

  const lastRenderedMarkersRef = useRef<RenderedMarker[]>([]);
  const lastRenderedVisibleCountRef = useRef<number>(0);
  const clusterManagerRef = useRef<ClusterManager | null>(null);
  const markersRef = useRef<MapMarker[]>([]);

  const clearMarkers = useCallback(() => {
    markersRef.current = [];
    lastRenderedMarkersRef.current = [];
    lastRenderedVisibleCountRef.current = 0;
    setMarkers((current) => (current.length === 0 ? current : []));
    setVisibleCount(0);
  }, []);

  const clusterCacheKey = useMemo(() => {
    // Persisted cache timestamp keeps the cluster index stable across modal opens.
    const ts = placesCache?.timestamp ?? 'no-cache';
    return `btcmap:${ts}:${category}`;
  }, [placesCache?.timestamp, category]);

  const filteredPoints = useMemo((): GeoPoint[] => {
    // BtcMapPlace is a structural superset of GeoPoint — for 'all' pass the
    // parsed array through instead of reshaping ~40k objects per tab switch.
    if (category === 'all') return places;
    const icons = getIconsForCategory(category);
    return places.filter((p) => icons.includes(p.icon));
  }, [places, category]);

  const updateMarkersForCamera = useCallback(
    (lat: number, lon: number, z: number) => {
      const manager = clusterManagerRef.current;
      if (!manager || !manager.isLoaded()) {
        clearMarkers();
        return;
      }

      // Avoid querying a padded bbox that's too large at high zoom (lots of pins)
      const padding = z >= 14 ? 0.25 : z >= 10 ? 0.5 : 0.75;
      const bbox = cameraToBbox(lat, lon, z, aspectRatio, padding);
      const queryStart = performance.now();
      const clustered = manager.getClusters(bbox, z);
      const queryMs = performance.now() - queryStart;
      if (queryMs > 16) {
        mapLog.debug('map.cluster.query_slow', {
          duration_ms: queryMs,
          zoom: z,
          markers: clustered.length,
        });
      }
      markersRef.current = clustered;

      let count = 0;
      for (const m of clustered) {
        count += m.count;
      }

      const mapMarkers: RenderedMarker[] = clustered.map((m) => ({
        id: m.id,
        coordinates: { latitude: m.latitude, longitude: m.longitude },
        tintColor: m.tintColor,
        title: m.type === 'cluster' ? `📍 ${m.count} merchants` : m.title,
      }));

      // Skip re-setting state if markers/count didn't actually change (saves JS + native work)
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
    },
    [aspectRatio, clearMarkers]
  );

  // A settle queued before the aspect ratio changed still queries with the latest one.
  const latestUpdate = useLatestRef(updateMarkersForCamera);
  const onCameraSettle = useCallback(
    (lat: number, lon: number, zoom: number) => latestUpdate.current(lat, lon, zoom),
    [latestUpdate]
  );
  const { mapRef, getCamera, setCamera, handleCameraChange } = useMapCamera({
    initial,
    aspectRatio,
    onCameraSettle,
  });

  // Fetch places on mount — DEFERRED
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchPlaces().catch((err) => mapLog.error('map.places.fetch_failed', { error: err }));
    });

    return () => task.cancel();
  }, [fetchPlaces]);

  // Initialize/update cluster manager when points change — DEFERRED.
  // On category switches, keep old markers visible while rebuilding; only mark
  // loading on initial load (no markers yet).
  useEffect(() => {
    if (!isMapReady) return;

    if (filteredPoints.length === 0) {
      clusterManagerRef.current = null;
      clearMarkers();
      setIsClusteringReady(true);
      return;
    }

    // A covered or preloaded map must not begin a synchronous cold build.
    // Cleanup below also cancels queued work if navigation wins the race.
    if (!isFocused) return;

    const cached = getCachedBTCMapClusterManager(clusterCacheKey, filteredPoints.length);
    if (cached) {
      clusterManagerRef.current = cached;
      const { lat, lon, zoom } = getCamera();
      updateMarkersForCamera(lat, lon, zoom);
      setIsClusteringReady(true);
      return;
    }

    const isInitialLoad = lastRenderedMarkersRef.current.length === 0;
    if (isInitialLoad) {
      setIsClusteringReady(false);
    }

    // Yield to the event loop so the map + loading state paint before
    // Supercluster's synchronous k-d tree build blocks the JS thread.
    const handle = deferWork(
      'map.cluster_build',
      () => {
        const manager = getOrBuildBTCMapClusterManager(clusterCacheKey, filteredPoints, {
          radius: 50,
          maxZoom: 17,
          minPoints: 2,
        });
        clusterManagerRef.current = manager;

        // Render markers with current camera in the same deferred frame so the
        // first paint after a category switch already shows the new pins.
        const { lat, lon, zoom } = getCamera();
        updateMarkersForCamera(lat, lon, zoom);
        setIsClusteringReady(true);
      },
      100
    );

    return () => handle.cancel();
  }, [
    isMapReady,
    isFocused,
    filteredPoints,
    clusterCacheKey,
    getCamera,
    updateMarkersForCamera,
    clearMarkers,
  ]);

  const moveTo = useCallback(
    (camera: MapCamera) => {
      setCamera(camera);
      updateMarkersForCamera(camera.lat, camera.lon, camera.zoom);
    },
    [setCamera, updateMarkersForCamera]
  );

  const zoomBy = useCallback(
    (delta: number) => {
      const { lat, lon, zoom } = getCamera();
      moveTo({
        lat,
        lon,
        zoom: delta > 0 ? Math.min(zoom + delta, 20) : Math.max(zoom + delta, 1),
      });
    },
    [getCamera, moveTo]
  );

  const pressMarker = useCallback(
    (id: string) => {
      const marker = markersRef.current.find((m) => m.id === id);
      if (marker?.type !== 'cluster' || marker.clusterId === undefined) return marker?.placeId;
      const manager = clusterManagerRef.current;
      if (manager) {
        // Supercluster's getClusterExpansionZoom returns the zoom at which
        // this cluster's children become individually visible. We zoom one
        // step past that so the children actually separate in the viewport
        // instead of re-clustering at the threshold; capped at 18 to stay
        // within Supercluster's maxZoom + 1.
        const expansionZoom = manager.getClusterExpansionZoom(marker.clusterId);
        moveTo({
          lat: marker.latitude,
          lon: marker.longitude,
          zoom: Math.min(expansionZoom + 1, 18),
        });
      }
      return undefined;
    },
    [moveTo]
  );

  // Retry loads the places again; hiding the error alone would leave an empty map.
  const retry = useCallback(() => {
    setError(null);
    fetchPlaces().catch((err) => mapLog.error('map.places.fetch_failed', { error: err }));
  }, [setError, fetchPlaces]);

  return {
    mapRef,
    handleCameraChange,
    markers,
    visibleCount,
    totalCount: filteredPoints.length,
    loading: storeLoading || !isClusteringReady,
    error,
    retry,
    moveTo,
    zoomBy,
    pressMarker,
  };
}
