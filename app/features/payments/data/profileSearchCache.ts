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

const KEY_PREFIX = 'search:people:';

export function profileSearchKey(normalizedQuery: string): string {
  return `${KEY_PREFIX}${normalizedQuery}`;
}

/**
 * True when the next query extends or unwinds the previous one — the same
 * search still being typed ("ali" → "alic", "alice" → "alic"). Only then may
 * the previous rows stay on screen while the new key loads; an unrelated
 * query must not open on somebody else's people.
 */
export function isProfileSearchRefinement(previousKey: string, nextKey: string): boolean {
  const previous = previousKey.slice(KEY_PREFIX.length);
  const next = nextKey.slice(KEY_PREFIX.length);
  return next.startsWith(previous) || previous.startsWith(next);
}
