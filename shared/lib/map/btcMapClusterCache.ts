import type Supercluster from 'supercluster';

import { mapLog } from '@/shared/lib/logger';
import { ClusterManager, GeoPoint } from './mapClustering';

type CacheEntry = {
  manager: ClusterManager;
  createdAt: number;
  pointsCount: number;
};

const CACHE = new Map<string, CacheEntry>();
const MAX_ENTRIES = 3; // keep small to avoid unbounded memory growth

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
  const existing = CACHE.get(cacheKey);
  if (existing && existing.pointsCount === points.length && existing.manager.isLoaded()) {
    return existing.manager;
  }

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
