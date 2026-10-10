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
import { log } from '@/shared/lib/logger';
import { StateStorage } from 'zustand/middleware';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { declaredStores } from '@/shared/lib/account/accountRegistry';

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
 * Which profile each store last loaded under, for stores that follow the
 * active profile. A store holds one profile's contents in memory; writing them
 * under another profile's key is the leak the whole account design exists to
 * prevent. The write barrier and the reset-then-reload order already stop it.
 * This is the second line: a write is dropped when the active profile is no
 * longer the one the store's contents came from.
 */
const loadedUnder = new Map<string, string>();

/**
 * Create a StateStorage adapter scoped to the active profile, or a captured
 * owner for async services that must survive active-profile changes.
 * Use this with `createJSONStorage(() => createProfileScopedStorage())` in Zustand persist.
 */
export function createProfileScopedStorage(
  ownerPubkey?: string,
  admittedWrite = false
): StateStorage & { profileStorageOwner?: string } {
  const keyFor = (name: string, pubkey: string | undefined) =>
    pubkey ? `${name}:profile:${pubkey}` : name;

  /**
   * The one path every save and removal takes. In order:
   *
   * 1. Dropped if the write barrier is up (an account switch is under way).
   * 2. The owner is decided NOW, before anything is awaited: a write queued
   *    for one profile must never resolve another profile's key later.
   * 3. Dropped if the store was loaded for a different profile than the one
   *    active now. A load before any profile existed recorded nothing, so the
   *    first save after onboarding still lands.
   * 4. Waits for migrations and for the profile list, then runs, counted by
   *    the barrier so a switch can wait for it to land.
   *
   * A dropped write resolves like a completed one; callers cannot tell.
   */
  const mutateOwnedKey = (name: string, mutate: (key: string) => Promise<void>): Promise<void> => {
    if (profilePersistWritesBlocked() && !admittedWrite) return Promise.resolve();
    const pubkey = ownerPubkey ?? getActiveProfilePubkey();
    const loaded = ownerPubkey ? undefined : loadedUnder.get(name);
    if (loaded && pubkey && loaded !== pubkey) {
      log.warn('profile.storage.cross_profile_write_refused', { store: name });
      return Promise.resolve();
    }
    return trackProfilePersistWrite(
      (async () => {
        await _migrationGate;
        await ensureProfileStoreHydrated();
        // No profile existed when this was called (first launch): use whichever
        // exists now, or the bare key if there is still none.
        await mutate(keyFor(name, pubkey ?? getActiveProfilePubkey()));
      })()
    );
  };

  return {
    profileStorageOwner: ownerPubkey,
    getItem: async (name: string) => {
      await _migrationGate;
      await ensureProfileStoreHydrated();
      const pubkey = ownerPubkey ?? getActiveProfilePubkey();
      const value = await AsyncStorage.getItem(keyFor(name, pubkey));
      // Recorded only once the read has succeeded, and only for a store that
      // follows the active profile; a captured owner cannot drift.
      if (!ownerPubkey && pubkey) loadedUnder.set(name, pubkey);
      return value;
    },
    setItem: (name: string, value: string) =>
      mutateOwnedKey(name, (key) => AsyncStorage.setItem(key, value)),
    removeItem: (name: string) => mutateOwnedKey(name, (key) => AsyncStorage.removeItem(key)),
  };
}

/** All profile-scoped store persistence keys. */
export const PROFILE_SCOPED_STORE_KEYS = [
  ...new Set(
    declaredStores
      .filter((entry) => entry.profileStorage && (entry.persisted || entry.queryCache))
      .map((entry) => entry.name)
  ),
];
