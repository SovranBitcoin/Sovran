/**
 * @fileoverview Map clustering using Mapbox's Supercluster
 *
 * Supercluster is a battle-tested, highly optimized library used by:
 * - Mapbox GL JS
 * - react-native-map-clustering
 * - Most major mapping applications
 *
 * It uses a hierarchical k-d tree for O(log n) queries and supports:
 * - Viewport-based clustering
 * - Zoom level adaptation
 * - Cluster expansion zoom calculation
 */

import Supercluster from 'supercluster';

import { mapLog } from '@/shared/lib/logger';
import { CLUSTER_MARKER_COLOR, getMarkerColor } from './categories';

// ============================================================================
// Types
// ============================================================================

export interface GeoPoint {
  id: number;
  lat: number;
  lon: number;
  icon: string;
}

export interface MapMarker {
  id: string;
  type: 'single' | 'cluster';
  latitude: number;
  longitude: number;
  tintColor: string;
  title: string;
  count: number;
  clusterId?: number;
  placeId?: number;
}

// ============================================================================
// Supercluster Manager
// ============================================================================

/**
 * Manages a Supercluster instance for efficient map clustering
 *
 * Usage:
 * 1. Create instance: const manager = new ClusterManager()
 * 2. Load points: manager.load(points)
 * 3. Get clusters for viewport: manager.getClusters(bbox, zoom)
 * 4. Get expansion zoom: manager.getClusterExpansionZoom(clusterId)
 */
export class ClusterManager {
  private cluster: Supercluster;
  private loaded: boolean = false;

  constructor(options?: Supercluster.Options) {
    this.cluster = new Supercluster({
      radius: 60, // Cluster radius in pixels
      maxZoom: 16, // Max zoom to cluster points
      minZoom: 0,
      minPoints: 2, // Minimum points to form a cluster
      ...options,
    });
  }

  /**
   * Load points into the cluster index
   * This builds the spatial index - do this once when data changes
   *
   * WARNING: Supercluster.load() is synchronous and blocks the JS thread.
   * With 30K+ points this can take several seconds. Callers must schedule
   * this off the critical path (setTimeout / InteractionManager).
   */
  load(points: GeoPoint[]): void {
    const t0 = performance.now();
    // Convert to GeoJSON features
    const features = points.map((p) => ({
      type: 'Feature' as const,
      properties: {
        pointId: p.id,
        icon: p.icon,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [p.lon, p.lat] as [number, number],
      },
    }));

    this.cluster.load(features);
    this.loaded = true;
    const duration = Math.round((performance.now() - t0) * 100) / 100;
    if (duration > 100) {
      mapLog.warn('map.cluster.load_slow', {
        points: points.length,
        duration_ms: duration,
      });
    }
  }

  /**
   * Get clusters for a bounding box at a zoom level
   *
   * @param bbox - [westLng, southLat, eastLng, northLat]
   * @param zoom - Current map zoom level
   */
  getClusters(bbox: [number, number, number, number], zoom: number): MapMarker[] {
    if (!this.loaded) return [];

    const clusters = this.cluster.getClusters(bbox, Math.floor(zoom));

    return clusters.map((feature): MapMarker => {
      const [lon, lat] = feature.geometry.coordinates;
      const props = feature.properties;

      if (props.cluster) {
        // Cluster marker
        return {
          id: `cluster-${props.cluster_id}`,
          type: 'cluster',
          latitude: lat,
          longitude: lon,
          tintColor: CLUSTER_MARKER_COLOR,
          title: `${props.point_count} merchants`,
          count: props.point_count || 0,
          clusterId: props.cluster_id,
        };
      } else {
        // Single point
        return {
          id: `point-${props.pointId}`,
          type: 'single',
          latitude: lat,
          longitude: lon,
          tintColor: getMarkerColor(props.icon as string),
          title: 'Merchant',
          count: 1,
          placeId: props.pointId,
        };
      }
    });
  }

  /**
   * Get the zoom level at which a cluster expands
   */
  getClusterExpansionZoom(clusterId: number): number {
    if (!this.loaded) return 10;
    try {
      return this.cluster.getClusterExpansionZoom(clusterId);
    } catch {
      return 10;
    }
  }

  /**
   * Check if data is loaded
   */
  isLoaded(): boolean {
    return this.loaded;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert camera position to bounding box for supercluster
 * Includes generous padding (100%) to show pins outside visible viewport
 */
export function cameraToBbox(
  lat: number,
  lon: number,
  zoom: number,
  aspectRatio: number = 1,
  padding: number = 1.0 // 100% padding by default
): [number, number, number, number] {
  // Approximate visible degrees at zoom level
  // At zoom 0, you see ~360 degrees. Each zoom level halves this.
  const baseSpan = 360 / Math.pow(2, zoom);

  // Apply aspect ratio and padding
  const latSpan = baseSpan * (1 + padding);
  const lonSpan = baseSpan * aspectRatio * (1 + padding);

  // Clamp to valid ranges
  const west = Math.max(-180, lon - lonSpan / 2);
  const east = Math.min(180, lon + lonSpan / 2);
  const south = Math.max(-85, lat - latSpan / 2); // Web Mercator limit
  const north = Math.min(85, lat + latSpan / 2);

  // [westLng, southLat, eastLng, northLat]
  return [west, south, east, north];
}
