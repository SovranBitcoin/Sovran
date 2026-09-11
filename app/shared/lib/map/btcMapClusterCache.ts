import type Supercluster from 'supercluster';

import { mapLog } from '@/shared/lib/logger';
import { ClusterManager, GeoPoint } from './mapClustering';

type CacheEntry = {
  manager: ClusterManager;
  createdAt: number;
  pointsCount: number;
};

const CACHE = new Map<string, CacheEntry>();
// Retain the current category indexes plus recently used data versions.
// The cap bounds index count; actual heap cost depends on the point set and
// needs measurement on devices, especially alongside cached media.
const MAX_ENTRIES = 8;

function evictIfNeeded() {
  if (CACHE.size <= MAX_ENTRIES) return;

  let oldestKey: string | null = null;
  let oldest = Infinity;
  for (const [key, entry] of CACHE.entries()) {
    if (entry.createdAt < oldest) {
      oldest = entry.createdAt;
      oldestKey = key;
    }
  }

  if (oldestKey) CACHE.delete(oldestKey);
}

export function getOrBuildBTCMapClusterManager(
  cacheKey: string,
  points: GeoPoint[],
  options?: Supercluster.Options<any, any>
): ClusterManager {
  const existing = getCachedBTCMapClusterManager(cacheKey, points.length);
  if (existing) return existing;

  const t0 = performance.now();
  const manager = new ClusterManager(options);
  manager.load(points);
  CACHE.set(cacheKey, { manager, createdAt: Date.now(), pointsCount: points.length });
  evictIfNeeded();
  const duration = Math.round((performance.now() - t0) * 100) / 100;
  if (duration > 50) {
    mapLog.warn('map.cluster.build_slow', {
      points: points.length,
      duration_ms: duration,
      cacheKey,
    });
  }
  return manager;
}

/** Read an already-built index without risking a synchronous cold build. */
export function getCachedBTCMapClusterManager(
  cacheKey: string,
  pointsCount: number
): ClusterManager | undefined {
  const existing = CACHE.get(cacheKey);
  if (!existing || existing.pointsCount !== pointsCount || !existing.manager.isLoaded()) return;
  existing.createdAt = Date.now();
  return existing.manager;
}
