/**
 * Cache for nagg's mint-info changelog (`/nostr/mint/changes`).
 *
 * Caches the FETCH, not the decoded rows: one ecosystem-wide response serves
 * every consumer (the Notifications → Mints tab and the per-mint detail
 * screen), and decoding is a pure `useMemo` at the read site. Host-scoped —
 * what a mint published about itself is the same for every profile — and
 * persisted, so the tab paints its last known state on cold launch instead of
 * flashing empty while the request is in flight.
 */
import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
import type { MintChangesResponse } from '@/shared/lib/apiClient';

/** One ecosystem-wide response — there is nothing to key on. */
export const MINT_CHANGES_CACHE_KEY = 'global';

export const mintChangesCache = createQueryCacheStore<MintChangesResponse>({
  name: 'mint-changes-cache',
  logKey: 'mint_changes_cache',
  // nagg re-polls each mint roughly daily; 30 minutes keeps a tab revisit warm
  // without letting the list go stale across a session.
  staleTtlMs: 30 * 60 * 1000,
  maxEntries: 2,
  hostScoped: true,
});
