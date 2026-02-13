/**
 * @fileoverview Profile-Scoped Zustand Storage
 *
 * Provides a custom StateStorage adapter that prefixes AsyncStorage keys
 * with the active account index from profileStore. This ensures that
 * per-profile Zustand stores read/write to isolated AsyncStorage keys.
 *
 * Account 0 uses the original key (backward compatible).
 * Account N>0 uses `{name}:profile:{N}`.
 *
 * Also provides `rehydrateProfileStores()` to reset + reload all
 * profile-scoped stores during a profile switch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StateStorage } from 'zustand/middleware';
import { useProfileStore } from '@/stores/profileStore';

/**
 * Create a StateStorage adapter that scopes read/write to the active profile.
 * Use this with `createJSONStorage(() => createProfileScopedStorage())` in Zustand persist.
 */
export function createProfileScopedStorage(): StateStorage {
  return {
    getItem: async (name: string) => {
      const index = useProfileStore.getState().activeAccountIndex;
      const key = index === 0 ? name : `${name}:profile:${index}`;
      return AsyncStorage.getItem(key);
    },
    setItem: async (name: string, value: string) => {
      const index = useProfileStore.getState().activeAccountIndex;
      const key = index === 0 ? name : `${name}:profile:${index}`;
      await AsyncStorage.setItem(key, value);
    },
    removeItem: async (name: string) => {
      const index = useProfileStore.getState().activeAccountIndex;
      const key = index === 0 ? name : `${name}:profile:${index}`;
      await AsyncStorage.removeItem(key);
    },
  };
}

/**
 * Reset all profile-scoped stores to their initial state and rehydrate
 * from the new profile's AsyncStorage keys.
 *
 * Call this during profile switch, AFTER setting the new activeAccountIndex
 * in the profile store and BEFORE inner providers remount.
 */
export async function rehydrateProfileStores(): Promise<void> {
  // Lazy imports to avoid circular dependencies
  const { useMintStore } = await import('@/stores/mintStore');
  const { useMintDistributionStore } = await import('@/stores/mintDistributionStore');
  const { useRoutstrStore } = await import('@/stores/routstrStore');
  const { useScanHistoryStore } = await import('@/stores/scanHistoryStore');
  const { useSearchHistoryStore } = await import('@/stores/searchHistoryStore');
  const { useSwapTransactionsStore } = await import('@/stores/swapTransactionsStore');
  const { useTransactionLocationStore } = await import('@/stores/transactionLocationStore');

  // Reset each store to its initial state
  useMintStore.setState({ selectedMints: {} });
  useMintDistributionStore.setState({ distributions: {} });
  useRoutstrStore.setState({
    apiKey: null,
    balance: null,
    conversationHistory: [],
    selectedModel: null,
    modelsCache: null,
    sessions: [],
    currentSessionId: null,
    isAnonymousMode: false,
  });
  useScanHistoryStore.setState({ entries: [] });
  useSearchHistoryStore.setState({ recentSearches: {} });
  useSwapTransactionsStore.setState({ groups: {}, quoteIdToGroup: {} });
  useTransactionLocationStore.setState({ locations: {} });

  // Rehydrate from the new profile's AsyncStorage keys
  await Promise.all([
    useMintStore.persist.rehydrate(),
    useMintDistributionStore.persist.rehydrate(),
    useRoutstrStore.persist.rehydrate(),
    useScanHistoryStore.persist.rehydrate(),
    useSearchHistoryStore.persist.rehydrate(),
    useSwapTransactionsStore.persist.rehydrate(),
    useTransactionLocationStore.persist.rehydrate(),
  ]);

  console.log('[ProfileScopedStorage] All profile stores rehydrated');
}
