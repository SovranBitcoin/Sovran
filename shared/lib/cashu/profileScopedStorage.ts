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
 * profile-scoped stores during a profile switch.
 *
 * Migration from old index-based keys lives in
 * `shared/lib/migrations/globalMigrations.ts`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { unstable_batchedUpdates } from 'react-native';
import { StateStorage } from 'zustand/middleware';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { log } from '../logger';

/**
 * Module-level flag to prevent persist middleware from writing to storage
 * while we reset store state during a profile switch. Without this, the
 * empty reset state is written to AsyncStorage before rehydrate() can read
 * the real data — permanently destroying the stored profile data.
 *
 * Also used by `withSkippedPersistWrites` to keep runtime-only mutations
 * (e.g. mock-mode demo data injection) out of the persisted blob.
 */
let _skipPersistWrite = false;

/**
 * Run `fn` with the persist-write gate raised. Synchronous: mutations queued
 * inside `fn` (`useStore.setState(...)`) bypass AsyncStorage; afterwards the
 * gate drops and normal persistence resumes. Use for runtime-only injections
 * into persisted profile-scoped stores.
 */
export function withSkippedPersistWrites<T>(fn: () => T): T {
  const prev = _skipPersistWrite;
  _skipPersistWrite = true;
  try {
    return fn();
  } finally {
    _skipPersistWrite = prev;
  }
}

/**
 * Promise gate that blocks all profile-scoped storage operations until
 * global migrations have completed. Without this, Zustand persist
 * middleware hydrates stores from AsyncStorage before migrations move
 * data into the correct pubkey-keyed locations, causing stores to load
 * empty defaults and then overwrite the migrated data on first write.
 *
 * Resolved by GlobalMigrationGate via signalMigrationsComplete().
 */
let _migrationGateResolve: (() => void) | null = null;
const _migrationGate = new Promise<void>((resolve) => {
  _migrationGateResolve = resolve;
});

/** Called by GlobalMigrationGate after all migrations complete. */
export function signalMigrationsComplete(): void {
  _migrationGateResolve?.();
  _migrationGateResolve = null;
}

/** Wait for profileStore hydration to complete before reading profiles. */
async function ensureProfileStoreHydrated(): Promise<void> {
  if (useProfileStore.persist.hasHydrated()) return;
  await new Promise<void>((resolve) => {
    const unsub = useProfileStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}

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
      await _migrationGate;
      await ensureProfileStoreHydrated();
      const pubkey = getActiveProfilePubkey();
      const key = pubkey ? `${name}:profile:${pubkey}` : name;
      return AsyncStorage.getItem(key);
    },
    setItem: async (name: string, value: string) => {
      if (_skipPersistWrite) return;
      await _migrationGate;
      await ensureProfileStoreHydrated();
      const pubkey = getActiveProfilePubkey();
      const key = pubkey ? `${name}:profile:${pubkey}` : name;
      await AsyncStorage.setItem(key, value);
    },
    removeItem: async (name: string) => {
      await _migrationGate;
      await ensureProfileStoreHydrated();
      const pubkey = getActiveProfilePubkey();
      const key = pubkey ? `${name}:profile:${pubkey}` : name;
      await AsyncStorage.removeItem(key);
    },
  };
}

/** All profile-scoped store persistence keys. */
export const PROFILE_SCOPED_STORE_KEYS = [
  'mint-store',
  'mint-distribution-store',
  'npc-mint-store',
  'routstr-store',
  'scan-history-store',
  'search-history-store',
  'recent-people-store',
  'swap-transactions-store',
  'transaction-location-store',
  'transaction-distribution-store',
  'nostr-social-store',
  'own-content-store',
  'nostr-relay-list-store',
  'nostr-media-server-store',
  'nostr-metadata-cache',
  'theme-store',
  'bitchat-dm-messages-store',
  'feed-ignore-store',
  'notification-policy-store',
  'nip46-connections-store',
  'nip46-activity-store',
  // Generic query caches (createQueryCacheStore). Profile-scoped because their
  // entries are keyed by the viewer pubkey.
  'feed-cache',
  'notifications-cache',
  'dm-conversations-cache',
  'dm-messages-cache',
  'own-profile-stats-cache',
];

/**
 * Reset all profile-scoped stores to their initial state and rehydrate
 * from the new profile's AsyncStorage keys.
 *
 * **Currently unused** — profile switches go through a full app reload
 * (see profileSessionOrchestrator.ts), which rehydrates everything from
 * scratch. Retained for a potential future non-reload switch path.
 *
 * If called, must run AFTER setting the new activeAccountIndex
 * in the profile store and BEFORE inner providers remount.
 */
async function rehydrateProfileStores(): Promise<void> {
  // Lazy imports to avoid circular dependencies
  const { useMintStore } = await import('@/shared/stores/profile/mintStore');
  const { useMintDistributionStore } =
    await import('@/shared/stores/profile/mintDistributionStore');
  const { useRoutstrStore } = await import('@/shared/stores/profile/routstrStore');
  const { useScanHistoryStore } = await import('@/shared/stores/profile/scanHistoryStore');
  const { useSearchHistoryStore } = await import('@/shared/stores/profile/searchHistoryStore');
  const { useRecentPeopleStore } = await import('@/shared/stores/profile/recentPeopleStore');
  const { useSwapTransactionsStore } =
    await import('@/shared/stores/profile/swapTransactionsStore');
  const { useTransactionLocationStore } =
    await import('@/shared/stores/profile/transactionLocationStore');
  const { useTransactionDistributionStore } =
    await import('@/shared/stores/profile/transactionDistributionStore');
  const { useNostrSocialStore } = await import('@/shared/stores/profile/nostrSocialStore');
  const { useOwnContentStore } = await import('@/shared/stores/profile/ownContentStore');
  const { useNpcMintStore } = await import('@/shared/stores/profile/npcMintStore');
  const { useThemeStore } = await import('@/shared/stores/profile/themeStore');
  const { useBitchatDmMessagesStore } = await import('@/features/bitchat/stores/bitchatDmMessages');
  const { useFeedIgnoreStore } = await import('@/features/feed/stores/ignoreStore');
  const { useNotificationPolicyStore } =
    await import('@/features/feed/stores/notificationPolicyStore');

  // Reset each store to its initial state. Batched to reduce re-render cascade.
  // Skip persist writes so the empty reset state doesn't overwrite
  // the target profile's stored data before rehydrate() can read it.
  _skipPersistWrite = true;
  try {
    unstable_batchedUpdates(() => {
      useMintStore.setState({ selectedMint: undefined });
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
      useRecentPeopleStore.setState({ entries: [] });
      useSwapTransactionsStore.setState({ groups: {}, quoteIdToGroup: {} });
      useTransactionLocationStore.setState({ locations: {} });
      useTransactionDistributionStore.setState({ distributions: {} });
      useNpcMintStore.setState({
        mintUrl: undefined,
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
      useOwnContentStore.setState({ byId: {} });
      useThemeStore.setState({
        _hasHydrated: false,
        activeAlbumSlug: null,
        unitWallpapers: {},
      });
      useBitchatDmMessagesStore.setState({ byPeer: {} });
      useFeedIgnoreStore.setState({ ignoredPubkeys: [], ignoredEventIds: [] });
      useNotificationPolicyStore.setState({ policy: 'STRICT' });
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
    useRecentPeopleStore.persist.rehydrate(),
    useSwapTransactionsStore.persist.rehydrate(),
    useTransactionLocationStore.persist.rehydrate(),
    useTransactionDistributionStore.persist.rehydrate(),
    useNpcMintStore.persist.rehydrate(),
    useNostrSocialStore.persist.rehydrate(),
    useOwnContentStore.persist.rehydrate(),
    useThemeStore.persist.rehydrate(),
    useBitchatDmMessagesStore.persist.rehydrate(),
    useFeedIgnoreStore.persist.rehydrate(),
    useNotificationPolicyStore.persist.rehydrate(),
  ]);

  log.info('cashu.storage.rehydrated');
}
