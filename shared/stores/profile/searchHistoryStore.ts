import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { log, storeLog } from '@/shared/lib/logger';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

const profileStorage = createProfileScopedStorage();

/** Maximum number of recent searches to store */
const MAX_RECENT_SEARCHES = 10;

/** A single search history entry */
interface SearchHistoryEntry {
  /** The search query text */
  query: string;
  /** Timestamp when the search was performed */
  timestamp: number;
  /** Optional: the context/screen where search was performed */
  context?: string;
}

interface SearchHistoryState {
  /** Recent search queries grouped by context */
  recentSearches: Record<string, SearchHistoryEntry[]>;

  /**
   * Add a search query to history
   * @param query The search query to add
   * @param context Optional context to group searches (e.g., 'payments', 'mints')
   */
  addSearch: (query: string, context?: string) => void;

  /**
   * Get recent searches for a context
   * @param context The context to get searches for (defaults to 'default')
   */
  getRecentSearches: (context?: string) => SearchHistoryEntry[];

  /**
   * Remove a specific search from history
   * @param query The query to remove
   * @param context The context to remove from
   */
  removeSearch: (query: string, context?: string) => void;

  /**
   * Clear all searches for a context
   * @param context The context to clear (if not provided, clears all)
   */
  clearSearches: (context?: string) => void;

  /**
   * Clear all stored data
   */
  clearAllData: () => Promise<void>;
}

const PersistedSearchEntry = z.looseObject({
  query: z.string().max(2048),
  timestamp: z.number().int().nonnegative(),
  context: z.string().max(64).optional(),
});

const PersistedSearchHistoryStore = z.object({
  recentSearches: z
    .record(z.string().max(64), z.array(PersistedSearchEntry).max(MAX_RECENT_SEARCHES))
    .default({}),
});

export const useSearchHistoryStore = create<SearchHistoryState>()(
  persist(
    (set, get) => ({
      recentSearches: {},

      addSearch: (query: string, context: string = 'default') => {
        const trimmedQuery = query.trim();
        if (!trimmedQuery || trimmedQuery.length < 2) return;
        storeLog.debug('store.search_history.add', { context });

        set((state) => {
          const contextSearches = state.recentSearches[context] || [];

          // Remove existing entry with same query (to move it to top)
          const filteredSearches = contextSearches.filter(
            (entry) => entry.query.toLowerCase() !== trimmedQuery.toLowerCase()
          );

          // Add new entry at the beginning
          const newEntry: SearchHistoryEntry = {
            query: trimmedQuery,
            timestamp: Date.now(),
            context,
          };

          // Keep only the most recent searches
          const updatedSearches = [newEntry, ...filteredSearches].slice(0, MAX_RECENT_SEARCHES);

          return {
            recentSearches: {
              ...state.recentSearches,
              [context]: updatedSearches,
            },
          };
        });
      },

      getRecentSearches: (context: string = 'default') => {
        const state = get();
        return state.recentSearches[context] || [];
      },

      removeSearch: (query: string, context: string = 'default') => {
        storeLog.debug('store.search_history.remove', { context });
        set((state) => {
          const contextSearches = state.recentSearches[context] || [];
          const filteredSearches = contextSearches.filter(
            (entry) => entry.query.toLowerCase() !== query.toLowerCase()
          );

          return {
            recentSearches: {
              ...state.recentSearches,
              [context]: filteredSearches,
            },
          };
        });
      },

      clearSearches: (context?: string) => {
        storeLog.info('store.search_history.clear', { context: context ?? 'all' });
        if (context) {
          set((state) => ({
            recentSearches: {
              ...state.recentSearches,
              [context]: [],
            },
          }));
        } else {
          set({ recentSearches: {} });
        }
      },

      clearAllData: async () => {
        try {
          await profileStorage.removeItem('search-history-store');
          set({ recentSearches: {} });
        } catch (error) {
          log.error('store.search_history.clear_failed', { error });
        }
      },
    }),
    {
      name: 'search-history-store',
      storage: createJSONStorage(() => createProfileScopedStorage()),
      version: 1,
      partialize: (state) => ({ recentSearches: state.recentSearches }),
      migrate: (state, _version) => state,
      merge: createMergeWithSchema('search_history', PersistedSearchHistoryStore),
    }
  )
);
