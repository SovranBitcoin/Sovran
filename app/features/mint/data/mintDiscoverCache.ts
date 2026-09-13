import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
import type { DiscoverMintsResponse } from '@/shared/lib/apiClient';

/**
 * The one nagg `/nostr/mint/discover` response (every mint, audit state,
 * units, review aggregates, operator reputation). Persisted and host-scoped —
 * it does not depend on the viewer — so Add Mints and the search Mints scope
 * paint from it at 0ms and revalidate in the background. Query, currency and
 * method filtering are client-side, so a tab change never refetches.
 *
 * The persisted payload is `unknown` on read (the envelope, not the vendor
 * shape, is what the store validates); `useMintSearch` re-parses it and
 * evicts + refetches on a shape mismatch.
 */
export const MINT_DISCOVER_CACHE_KEY = 'all';

export const mintDiscoverCache = createQueryCacheStore<DiscoverMintsResponse>({
  name: 'mint-discover-cache',
  logKey: 'mint_discover_cache',
  staleTtlMs: 20 * 60 * 1000,
  maxEntries: 1,
  hostScoped: true,
});
