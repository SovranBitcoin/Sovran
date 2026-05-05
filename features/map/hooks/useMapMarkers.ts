import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useBTCMapStore } from '@/shared/stores/global/btcMapStore';
import { ClusterManager, cameraToBbox, MapMarker, GeoPoint } from '@/shared/lib/map/mapClustering';
import { getOrBuildBTCMapClusterManager } from '@/shared/lib/map/btcMapClusterCache';
import { getIconsForCategory } from '@/shared/lib/map/categories';
import { deferWork } from '@/shared/lib/logger';
import type { CategoryFilter } from '../components/StatsCard';

type RenderedMarker = {
  id: string;
  coordinates: { latitude: number; longitude: number };
  tintColor: string;
  title: string;
};

type UseMapMarkersOptions = {
  category: CategoryFilter;
  aspectRatio: number;
  isMapReady: boolean;
  getCamera: () => { lat: number; lon: number; zoom: number };
};

type UseMapMarkers = {
  markers: RenderedMarker[];
  visibleCount: number;
  totalCount: number;
  isClusteringReady: boolean;
  storeLoading: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  fetchPlaces: () => Promise<unknown>;
  updateMarkersForCamera: (lat: number, lon: number, zoom: number) => void;
  resolveMarker: (id: string) => MapMarker | undefined;
  clusterManagerRef: React.MutableRefObject<ClusterManager | null>;
};

export function useMapMarkers({
  category,
  aspectRatio,
  isMapReady,
  getCamera,
}: UseMapMarkersOptions): UseMapMarkers {
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

  const clusterCacheKey = useMemo(() => {
    // Persisted cache timestamp keeps the cluster index stable across modal opens.
    const ts = placesCache?.timestamp ?? 'no-cache';
    return `btcmap:${ts}:${category}`;
  }, [placesCache?.timestamp, category]);

  const filteredPoints = useMemo((): GeoPoint[] => {
    if (category === 'all') {
      return places.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, icon: p.icon }));
    }
    const icons = getIconsForCategory(category);
    return places
      .filter((p) => icons.includes(p.icon))
      .map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, icon: p.icon }));
  }, [places, category]);

  const updateMarkersForCamera = useCallback(
    (lat: number, lon: number, z: number) => {
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
      const bbox = cameraToBbox(lat, lon, z, aspectRatio, padding);
      const clustered = manager.getClusters(bbox, z);
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
    [aspectRatio]
  );

  // Initialize/update cluster manager when points change — DEFERRED.
  // On category switches, keep old markers visible while rebuilding; only show
  // the loading overlay on initial load (no markers yet).
  useEffect(() => {
    if (!isMapReady) return;

    if (filteredPoints.length === 0) {
      clusterManagerRef.current = null;
      setMarkers([]);
      setVisibleCount(0);
      setIsClusteringReady(true);
      return;
    }

    const isInitialLoad = lastRenderedMarkersRef.current.length === 0;
    if (isInitialLoad) {
      setIsClusteringReady(false);
    }

    // Yield to the event loop so the map + loading overlay paint before
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
  }, [isMapReady, filteredPoints, clusterCacheKey, getCamera, updateMarkersForCamera]);

  const resolveMarker = useCallback(
    (id: string) => markersRef.current.find((m) => m.id === id),
    []
  );

  return {
    markers,
    visibleCount,
    totalCount: filteredPoints.length,
    isClusteringReady,
    storeLoading,
    error,
    setError,
    fetchPlaces,
    updateMarkersForCamera,
    resolveMarker,
    clusterManagerRef,
  };
}
