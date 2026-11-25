/**
 * nagg's mint-info changelog cache (`/nostr/mint/changes`), kept inert.
 *
 * nagg no longer serves the changelog; mint history is recorded on the phone
 * in `mint-history-store` (ADR 0036). This store stays declared under its
 * released name, scope and shape so an install that cached the feed still
 * loads, keeps and wipes that row like any other store
 * (`releasedPersistedSurface.test.ts`). Nothing reads or writes it.
 */
import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
import type { MintChangesResponse } from '@/shared/lib/apiClient';

/** One ecosystem-wide response — there is nothing to key on. */
export const MINT_CHANGES_CACHE_KEY = 'global';

export const mintChangesCache = createQueryCacheStore<MintChangesResponse>({
  scope: 'global',
  name: 'mint-changes-cache',
  logKey: 'mint_changes_cache',
  // nagg re-polls each mint roughly daily; 30 minutes keeps a tab revisit warm
  // without letting the list go stale across a session.
  staleTtlMs: 30 * 60 * 1000,
  maxEntries: 2,
  hostScoped: true,
});
