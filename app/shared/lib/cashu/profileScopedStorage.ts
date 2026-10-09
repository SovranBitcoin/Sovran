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

import { persistRegistry } from '@/shared/lib/persist/persistConfig';

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

/** The profile whose key the scoped stores are reading and writing under now. */
export function getActiveProfilePubkey(): string | undefined {
  const state = useProfileStore.getState();
  return state.profiles.find((p) => p.accountIndex === state.activeAccountIndex)?.pubkey;
}

/** Capture after migrations/hydration, before starting an owner-bound service. */
export async function captureProfileStorageOwner(): Promise<string> {
  await _migrationGate;
  await ensureProfileStoreHydrated();
  const pubkey = getActiveProfilePubkey();
  if (!pubkey) throw new Error('Profile storage is not ready');
  return pubkey;
}

/**
 * Create a StateStorage adapter scoped to the active profile, or a captured
 * owner for async services that must survive active-profile changes.
 * Use this with `createJSONStorage(() => createProfileScopedStorage())` in Zustand persist.
 */
export function createProfileScopedStorage(ownerPubkey?: string): StateStorage {
  return {
    getItem: async (name: string) => {
      await _migrationGate;
      await ensureProfileStoreHydrated();
      const pubkey = ownerPubkey ?? getActiveProfilePubkey();
      const key = pubkey ? `${name}:profile:${pubkey}` : name;
      return AsyncStorage.getItem(key);
    },
    setItem: async (name: string, value: string) => {
      if (_skipPersistWrite) return;
      await _migrationGate;
      await ensureProfileStoreHydrated();
      const pubkey = ownerPubkey ?? getActiveProfilePubkey();
      const key = pubkey ? `${name}:profile:${pubkey}` : name;
      await AsyncStorage.setItem(key, value);
    },
    removeItem: async (name: string) => {
      await _migrationGate;
      await ensureProfileStoreHydrated();
      const pubkey = ownerPubkey ?? getActiveProfilePubkey();
      const key = pubkey ? `${name}:profile:${pubkey}` : name;
      await AsyncStorage.removeItem(key);
    },
  };
}

/** All profile-scoped store persistence keys. */
export const PROFILE_SCOPED_STORE_KEYS = [
  ...new Set(
    persistRegistry.definitions
      .filter((entry) => entry.profileStorage && (entry.persisted || entry.queryCache))
      .map((entry) => entry.name)
  ),
];
