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

import {
  profilePersistWritesBlocked,
  trackProfilePersistWrite,
} from '@/shared/lib/persist/profileWriteBarrier';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StateStorage } from 'zustand/middleware';
import { useProfileStore } from '@/shared/stores/global/profileStore';

/** The same barrier covers direct profile adapters and full persisted operations. */
export {
  blockProfilePersistWrites,
  unblockProfilePersistWrites,
  withSkippedPersistWrites,
} from '@/shared/lib/persist/profileWriteBarrier';

export function hasCapturedProfileStorage(): boolean {
  return persistRegistry.some((entry) => entry.capturedOwner !== undefined);
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
export function createProfileScopedStorage(
  ownerPubkey?: string,
  admittedWrite = false
): StateStorage & { profileStorageOwner?: string } {
  return {
    profileStorageOwner: ownerPubkey,
    getItem: async (name: string) => {
      await _migrationGate;
      await ensureProfileStoreHydrated();
      const pubkey = ownerPubkey ?? getActiveProfilePubkey();
      const key = pubkey ? `${name}:profile:${pubkey}` : name;
      return AsyncStorage.getItem(key);
    },
    setItem: (name: string, value: string) => {
      if (profilePersistWritesBlocked() && !admittedWrite) return Promise.resolve();
      // Capture ownership before yielding; a queued A write must never resolve B's key.
      const pubkey = ownerPubkey ?? getActiveProfilePubkey();
      const write = (async () => {
        await _migrationGate;
        await ensureProfileStoreHydrated();
        const owner = pubkey ?? ownerPubkey ?? getActiveProfilePubkey();
        const key = owner ? `${name}:profile:${owner}` : name;
        await AsyncStorage.setItem(key, value);
      })();
      return trackProfilePersistWrite(write);
    },
    removeItem: (name: string) => {
      if (profilePersistWritesBlocked() && !admittedWrite) return Promise.resolve();
      const pubkey = ownerPubkey ?? getActiveProfilePubkey();
      return trackProfilePersistWrite(
        (async () => {
          await _migrationGate;
          await ensureProfileStoreHydrated();
          const owner = pubkey ?? ownerPubkey ?? getActiveProfilePubkey();
          const key = owner ? `${name}:profile:${owner}` : name;
          await AsyncStorage.removeItem(key);
        })()
      );
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
