import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
import type { SearchUsersResponse } from '@sovranbitcoin/schemas';

/**
 * People-search results by normalized query. In-memory only: a search is
 * worth remembering for the session (retyping, backspacing, a recent-search
 * chip all hit it at 0ms) but not across launches. Host-scoped: the ranked
 * result does not depend on who is asking.
 */
export const profileSearchCache = createQueryCacheStore<SearchUsersResponse>({
  name: 'profile-search-cache',
  logKey: 'profile_search_cache',
  staleTtlMs: 5 * 60 * 1000,
  maxEntries: 30,
  hostScoped: true,
  persist: false,
});

export function profileSearchKey(normalizedQuery: string): string {
  return `search:people:${normalizedQuery}`;
}
