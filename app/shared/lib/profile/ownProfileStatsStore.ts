/**
 * Cache of follower/following counts for the user's OWN accounts, keyed by
 * pubkey. Host-scoped (the data is about each own account, not viewer-relative)
 * and persisted so the account switcher / profile header can paint counts
 * before the launch sync completes. Refreshed by `ownProfileSync`.
 */
import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';

interface OwnProfileStats {
  followers: number;
  follows: number;
}

export const ownProfileStatsCache = createQueryCacheStore<OwnProfileStats>({
  name: 'own-profile-stats-cache',
  logKey: 'own_profile_stats',
  staleTtlMs: 6 * 60 * 60 * 1000, // 6h
  maxEntries: 20,
  hostScoped: true,
});
