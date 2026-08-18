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
 * Migration from old index-based keys lives in
 * `shared/lib/migrations/globalMigrations.ts`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StateStorage } from 'zustand/middleware';
import { useProfileStore } from '@/shared/stores/global/profileStore';

/**
 * Module-level flag that keeps the persist middleware from writing while a
 * store is mutated. Raised by `withSkippedPersistWrites` so runtime-only
 * mutations (e.g. mock-mode demo data injection) stay out of the persisted
 * blob rather than overwriting the profile's stored data.
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
  'transaction-annotation-store',
  'owned-media-store',
  'data-migration-store',
  // Generic query caches (createQueryCacheStore). Profile-scoped because their
  // entries are keyed by the viewer pubkey.
  'feed-cache',
  'notifications-cache',
  'dm-conversations-cache',
  'dm-messages-cache',
  'own-profile-stats-cache',
];
