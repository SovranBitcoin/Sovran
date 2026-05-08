import { useCallback, useEffect, useRef } from 'react';
import { InteractionManager, Platform } from 'react-native';
import type { CameraPosition } from 'expo-maps';

type MapCamera = { lat: number; lon: number; zoom: number };

type MapViewRef = {
  setCameraPosition: (config?: CameraPosition & { duration?: number }) => void;
};

type UseMapCameraOptions = {
  initial: MapCamera;
  aspectRatio: number;
  onCameraSettle: (lat: number, lon: number, zoom: number) => void;
};

type UseMapCamera = {
  mapRef: React.MutableRefObject<MapViewRef | null>;
  getCamera: () => MapCamera;
  setCamera: (next: MapCamera) => void;
  handleCameraChange: (event: {
    coordinates: { latitude?: number; longitude?: number };
    zoom: number;
  }) => void;
};

export function useMapCamera({
  initial,
  aspectRatio,
  onCameraSettle,
}: UseMapCameraOptions): UseMapCamera {
  const mapRef = useRef<MapViewRef | null>(null);
  const cameraRef = useRef<MapCamera>(initial);
  const markerUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMarkerQueryRef = useRef<{ lat: number; lon: number; zoomFloor: number } | null>(null);
  const markerUpdateTaskRef = useRef<{ cancel: () => void } | null>(null);

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

  const setCamera = useCallback((next: MapCamera) => {
    cameraRef.current = next;

    // Android's GoogleMaps.View.setCameraPosition accepts an optional `duration`
    // for animated camera moves; AppleMaps.View ignores duration on iOS, so we
    // branch the config rather than passing duration cross-platform.
    if (Platform.OS === 'android') {
      mapRef.current?.setCameraPosition?.({
        coordinates: { latitude: next.lat, longitude: next.lon },
        zoom: next.zoom,
        duration: 250,
      });
    } else {
      mapRef.current?.setCameraPosition?.({
        coordinates: { latitude: next.lat, longitude: next.lon },
        zoom: next.zoom,
      });
    }
  }, []);

  const getCamera = useCallback(() => cameraRef.current, []);

  const handleCameraChange = useCallback(
    (event: { coordinates: { latitude?: number; longitude?: number }; zoom: number }) => {
      const prev = cameraRef.current;
      const newLat = event.coordinates.latitude ?? prev.lat;
      const newLon = event.coordinates.longitude ?? prev.lon;
      const newZoom = event.zoom;

      cameraRef.current = { lat: newLat, lon: newLon, zoom: newZoom };

      // Debounce marker queries and skip tiny movements within the current zoom bucket
      const zoomFloor = Math.floor(newZoom);
      const last = lastMarkerQueryRef.current;
      const span = 360 / Math.pow(2, Math.max(newZoom, 0));
      const latThreshold = span * 0.12;
      const lonThreshold = span * aspectRatio * 0.12;
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
          onCameraSettle(newLat, newLon, newZoom);
        });
      }, 250);
    },
    [aspectRatio, onCameraSettle]
  );

  return { mapRef, getCamera, setCamera, handleCameraChange };
}
