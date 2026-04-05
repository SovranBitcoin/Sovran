import type Supercluster from 'supercluster';
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

export type ClusterBuildOptions = Supercluster.Options<any, any>;

export function getOrBuildBTCMapClusterManager(
  cacheKey: string,
  points: GeoPoint[],
  options?: ClusterBuildOptions
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
    console.warn(`[perf] cluster.build(${points.length} points) ${duration}ms — cache miss for "${cacheKey}"`);
  }
  return manager;
}
export function prewarmBTCMapClusterManager(
  cacheKey: string,
  points: GeoPoint[],
  options?: ClusterBuildOptions
): void {
  if (!points.length) return;
  // Build immediately; callers should schedule this off the critical path (InteractionManager / timeout)
  getOrBuildBTCMapClusterManager(cacheKey, points, options);
}

function clearBTCMapClusterCache(prefix?: string) {
  if (!prefix) {
    CACHE.clear();
    return;
  }
  for (const key of CACHE.keys()) {
    if (key.startsWith(prefix)) {
      CACHE.delete(key);
    }
  }
}
