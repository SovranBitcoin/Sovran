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
 * Module-level flag to prevent persist middleware from writing to storage
 * while we reset store state during a profile switch. Without this, the
 * empty reset state is written to AsyncStorage before rehydrate() can read
 * the real data — permanently destroying the stored profile data.
 */
let _skipPersistWrite = false;

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
      if (_skipPersistWrite) return;
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

/** All profile-scoped store persistence keys. */
const PROFILE_SCOPED_STORE_KEYS = [
  'mint-store',
  'mint-distribution-store',
  'npc-mint-store',
  'routstr-store',
  'scan-history-store',
  'search-history-store',
  'swap-transactions-store',
  'transaction-location-store',
  'nostr-social-store',
];

/**
 * Remove AsyncStorage data for ALL profile-scoped stores across EVERY profile.
 *
 * Use this during a full app reset / delete account flow.
 * Each store's `clearAllData()` only removes the *active* profile's key;
 * this helper removes the base key (account 0) and every `:profile:N` suffix
 * so no orphaned data is left behind.
 */
export async function clearAllProfileScopedData(maxProfileIndex: number): Promise<void> {
  const keysToRemove: string[] = [];
  for (const base of PROFILE_SCOPED_STORE_KEYS) {
    keysToRemove.push(base); // account 0 uses the bare key
    for (let i = 1; i <= maxProfileIndex; i++) {
      keysToRemove.push(`${base}:profile:${i}`);
    }
  }

  if (keysToRemove.length > 0) {
    await AsyncStorage.multiRemove(keysToRemove);
  }

  console.log(
    `[ProfileScopedStorage] Cleared ${keysToRemove.length} keys across ${maxProfileIndex + 1} profiles`
  );
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
  const { useNostrSocialStore } = await import('@/stores/nostrSocialStore');
  const { useNpcMintStore } = await import('@/stores/npcMintStore');

  // Reset each store to its initial state.
  // Skip persist writes so the empty reset state doesn't overwrite
  // the target profile's stored data before rehydrate() can read it.
  _skipPersistWrite = true;
  try {
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
    useNpcMintStore.setState({
      mintUrls: {},
      lastSyncedAt: {},
      isSyncing: false,
      isUpdating: false,
    });
    useNostrSocialStore.setState({
      contactsTags: [],
      contactsContent: '',
      contactsUpdatedAt: 0,
      followingPubkeys: {},
      likesByEventId: {},
      repostsByEventId: {},
      deletedRepostOriginalIds: {},
      optimisticFollowsByPubkey: {},
      optimisticLikesByEventId: {},
      optimisticRepostsByEventId: {},
    });
  } finally {
    _skipPersistWrite = false;
  }

  // Rehydrate from the new profile's AsyncStorage keys
  await Promise.all([
    useMintStore.persist.rehydrate(),
    useMintDistributionStore.persist.rehydrate(),
    useRoutstrStore.persist.rehydrate(),
    useScanHistoryStore.persist.rehydrate(),
    useSearchHistoryStore.persist.rehydrate(),
    useSwapTransactionsStore.persist.rehydrate(),
    useTransactionLocationStore.persist.rehydrate(),
    useNpcMintStore.persist.rehydrate(),
    useNostrSocialStore.persist.rehydrate(),
  ]);

  console.log('[ProfileScopedStorage] All profile stores rehydrated');
}
