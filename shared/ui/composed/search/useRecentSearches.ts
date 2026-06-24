/**
 * @fileoverview Single source for per-surface recent search QUERIES.
 *
 * Surfaces the previously write-only `searchHistoryStore` as UI: each search
 * surface keeps its own bucket ('contacts' | 'feed' | 'wallet') so histories
 * don't bleed across tabs, but they all share this one hook and the identical
 * chip UI. (Recent PEOPLE are handled separately by `RecentPeopleSearchStrip`,
 * which reads the already-shared `recentPeopleStore`.)
 */
import { useSearchHistoryStore } from '@/shared/stores/profile/searchHistoryStore';

const EMPTY: readonly { query: string }[] = [];

export type RecentSearchSurface = 'contacts' | 'feed' | 'wallet';

export function useRecentSearches(surface: RecentSearchSurface) {
  const queries = useSearchHistoryStore(
    (s) => s.recentSearches[surface] ?? (EMPTY as { query: string; timestamp: number }[])
  );
  const addSearch = useSearchHistoryStore((s) => s.addSearch);
  const clearSearchHistory = useSearchHistoryStore((s) => s.clearSearchHistory);

  const addQuery = (q: string) => addSearch(q, surface);
  const clearQueries = () => clearSearchHistory(surface);

  return { queries, addQuery, clearQueries };
}
