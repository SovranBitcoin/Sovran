/**
 * @fileoverview Profile-Scoped Zustand Storage
 *
 * Provides a custom StateStorage adapter that prefixes AsyncStorage keys
 * with the active profile's hex pubkey. This ensures that per-profile
 * Zustand stores read/write to isolated AsyncStorage keys.
 *
 * Key format: `{name}:profile:{pubkey}` for all profiles.
 * Falls back to bare `{name}` only during first-launch bootstrap before
 * a profile entry exists.
 *
 * Also provides `rehydrateProfileStores()` to reset + reload all
 * profile-scoped stores during a profile switch, and
 * `migrateProfileScopedKeys()` to move data from old index-based keys
 * to new pubkey-based keys.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StateStorage } from 'zustand/middleware';
import { useProfileStore } from '@/shared/stores/global/profileStore';

/**
 * Module-level flag to prevent persist middleware from writing to storage
 * while we reset store state during a profile switch. Without this, the
 * empty reset state is written to AsyncStorage before rehydrate() can read
 * the real data — permanently destroying the stored profile data.
 */
let _skipPersistWrite = false;

function getActiveProfilePubkey(): string | undefined {
  const state = useProfileStore.getState();
  return state.profiles.find((p) => p.accountIndex === state.activeAccountIndex)?.pubkey;
}

/**
 * Create a StateStorage adapter that scopes read/write to the active profile.
 * Use this with `createJSONStorage(() => createProfileScopedStorage())` in Zustand persist.
 */
export function createProfileScopedStorage(): StateStorage {
  return {
    getItem: async (name: string) => {
      const pubkey = getActiveProfilePubkey();
      const key = pubkey ? `${name}:profile:${pubkey}` : name;
      return AsyncStorage.getItem(key);
    },
    setItem: async (name: string, value: string) => {
      if (_skipPersistWrite) return;
      const pubkey = getActiveProfilePubkey();
      const key = pubkey ? `${name}:profile:${pubkey}` : name;
      await AsyncStorage.setItem(key, value);
    },
    removeItem: async (name: string) => {
      const pubkey = getActiveProfilePubkey();
      const key = pubkey ? `${name}:profile:${pubkey}` : name;
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
 * this helper removes the bare key (legacy) and every `:profile:{pubkey}`
 * so no orphaned data is left behind.
 *
 * @param pubkeys Hex pubkeys of all known profiles.
 */
export async function clearAllProfileScopedData(pubkeys: string[]): Promise<void> {
  const keysToRemove: string[] = [];
  for (const base of PROFILE_SCOPED_STORE_KEYS) {
    keysToRemove.push(base); // legacy bare key cleanup
    for (const pubkey of pubkeys) {
      keysToRemove.push(`${base}:profile:${pubkey}`);
    }
  }

  if (keysToRemove.length > 0) {
    await AsyncStorage.multiRemove(keysToRemove);
  }

  console.log(
    `[ProfileScopedStorage] Cleared ${keysToRemove.length} keys across ${pubkeys.length} profiles`
  );
}

const MIGRATION_FLAG = 'profile-scoped-storage-v2';

/**
 * One-time migration from index-based AsyncStorage keys to pubkey-based keys.
 *
 * Old format: bare `{name}` for account 0, `{name}:profile:{accountIndex}` for N>0.
 * New format: `{name}:profile:{pubkey}` for all profiles.
 *
 * Reads raw profile-store JSON from AsyncStorage (no Zustand hydration dependency)
 * so it can run safely before any profile-scoped store is accessed.
 */
export async function migrateProfileScopedKeys(): Promise<void> {
  try {
    const flag = await AsyncStorage.getItem(MIGRATION_FLAG);
    if (flag) return;

    const raw = await AsyncStorage.getItem('profile-store');
    if (!raw) {
      await AsyncStorage.setItem(MIGRATION_FLAG, '1');
      return;
    }

    const parsed = JSON.parse(raw);
    const profiles: { accountIndex: number; pubkey: string }[] = parsed?.state?.profiles ?? [];

    if (profiles.length === 0) {
      await AsyncStorage.setItem(MIGRATION_FLAG, '1');
      return;
    }

    let migratedCount = 0;

    for (const profile of profiles) {
      for (const base of PROFILE_SCOPED_STORE_KEYS) {
        const oldKey =
          profile.accountIndex === 0 ? base : `${base}:profile:${profile.accountIndex}`;
        const newKey = `${base}:profile:${profile.pubkey}`;

        if (oldKey === newKey) continue;

        const oldData = await AsyncStorage.getItem(oldKey);
        if (!oldData) continue;

        const existing = await AsyncStorage.getItem(newKey);
        if (!existing) {
          await AsyncStorage.setItem(newKey, oldData);
          migratedCount++;
        }
        await AsyncStorage.removeItem(oldKey);
      }
    }

    await AsyncStorage.setItem(MIGRATION_FLAG, '1');
    console.log(
      `[ProfileScopedStorage] Migration complete: moved ${migratedCount} keys across ${profiles.length} profiles`
    );
  } catch (error) {
    console.error('[ProfileScopedStorage] Migration failed:', error);
    await AsyncStorage.setItem(MIGRATION_FLAG, '1');
  }
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
  const { useMintStore } = await import('@/shared/stores/profile/mintStore');
  const { useMintDistributionStore } =
    await import('@/shared/stores/profile/mintDistributionStore');
  const { useRoutstrStore } = await import('@/shared/stores/profile/routstrStore');
  const { useScanHistoryStore } = await import('@/shared/stores/profile/scanHistoryStore');
  const { useSearchHistoryStore } = await import('@/shared/stores/profile/searchHistoryStore');
  const { useSwapTransactionsStore } =
    await import('@/shared/stores/profile/swapTransactionsStore');
  const { useTransactionLocationStore } =
    await import('@/shared/stores/profile/transactionLocationStore');
  const { useNostrSocialStore } = await import('@/shared/stores/profile/nostrSocialStore');
  const { useNpcMintStore } = await import('@/shared/stores/profile/npcMintStore');

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
