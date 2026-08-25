/**
 * @fileoverview Profile Store
 *
 * Manages multiple profiles (accounts) derived from the same master mnemonic.
 * Each profile is identified by an account index (0, 1, 2, ...) which produces
 * unique Nostr keys (NIP-06) and Cashu seeds (NUT-13).
 *
 * This store is global (not profile-scoped) — it tracks which profiles exist
 * and which one is currently active.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

export interface ProfileEntry {
  /**
   * For derived profiles: sequential BIP-44 account index (0, 1, 2, ...).
   * For imported profiles: deterministic 31-bit int from npub bytes.
   */
  accountIndex: number;
  /** Nostr public key (hex) — used for deterministic avatar rendering */
  pubkey: string;
  /** Timestamp when this profile was added */
  addedAt: number;
  /** Last-known balance in sats (updated while profile is active) */
  cachedBalanceSats?: number;
  /**
   * `'derived'` — keys derived from root mnemonic (default / backward compat).
   * `'imported'` — Nostr identity from an imported nsec; Cashu uses chain 1.
   */
  source?: 'derived' | 'imported';
  /**
   * BIP-32 external chain index for Cashu derivation.
   * Implicitly 0 when undefined (derived profiles). Must be 1+ for imported.
   */
  externalChain?: number;
  /** Cached Nostr kind-0 display name (display_name or name) */
  cachedDisplayName?: string;
  /** Cached Nostr kind-0 profile picture URL */
  cachedPicture?: string;
}

interface ProfileState {
  /** The currently active account index */
  activeAccountIndex: number;
  /** All known profiles */
  profiles: ProfileEntry[];
}

interface ProfileActions {
  /** Add a new profile entry (idempotent — skips if accountIndex already exists) */
  addProfile: (
    accountIndex: number,
    pubkey: string,
    source?: 'derived' | 'imported',
    externalChain?: number
  ) => void;
  /** Set the active account index (caller is responsible for cleanup/resetStages before this) */
  switchProfile: (accountIndex: number) => boolean;
  /** Get the next available account index (only considers derived profiles) */
  getNextAccountIndex: () => number;
  /** Update the cached balance for a profile (called by ProfileBalanceSync) */
  updateProfileBalance: (accountIndex: number, balanceSats: number) => void;
  /** Update cached Nostr kind-0 metadata for a profile */
  updateProfileMetadata: (accountIndex: number, displayName?: string, picture?: string) => void;
  /** Check if a pubkey is already used by any profile */
  hasPubkey: (pubkey: string) => boolean;
  /** Get the active profile entry */
  getActiveProfile: () => ProfileEntry | undefined;
}

type ProfileStore = ProfileState & ProfileActions;

const PersistedProfileEntry = z.looseObject({
  accountIndex: z.number().int(),
  pubkey: z.string().max(128),
  addedAt: z.number().int().nonnegative(),
  cachedBalanceSats: z.number().int().nonnegative().optional(),
  // `source` drives custody: 'imported' loads the nsec from SecureStore,
  // anything else silently derives keys from the seed (NostrKeysProvider).
  // A MISSING value historically means derived — `.optional()` preserves
  // that. A PRESENT-but-unknown value (newer build) must fail CLOSED:
  // `.catch('imported')` routes key loading through SecureStore, which
  // errors visibly if no nsec exists, instead of deriving a different
  // identity from the seed. Rejecting the entry would discard the entire
  // global profile store, including coco migration completion flags.
  source: z.enum(['derived', 'imported']).catch('imported').optional(),
  externalChain: z.number().int().nonnegative().optional(),
  cachedDisplayName: z.string().max(512).optional(),
  cachedPicture: z.string().max(2048).optional(),
});

const PersistedProfileStore = z.object({
  activeAccountIndex: z.number().int().default(0),
  profiles: z.array(PersistedProfileEntry).max(64).default([]),
});

/**
 * Persisted schema version. Exported so the profile-session orchestrator —
 * which hand-writes the blob during a profile switch — stamps the same
 * version the store declares, instead of forcing a needless migrate on every
 * restart.
 */
export const PROFILE_STORE_PERSIST_VERSION = 2;

type V2Persisted = {
  activeAccountIndex: number;
  profiles: ProfileEntry[];
};

/**
 * v1 → v2: drop `cocoMigrationComplete`, the per-account Redux→Coco flag that
 * left the app with the migration it gated. Every existing install still has
 * the key in its blob; strip it here so the v2 schema sees the current shape.
 *
 * Append-only chain — zustand only calls migrate on a version mismatch.
 */
function migrateProfileStore(state: unknown, version: number): V2Persisted {
  if (version < 2 && state && typeof state === 'object') {
    const { cocoMigrationComplete: _dropped, ...rest } = state as Record<string, unknown>;
    return rest as V2Persisted;
  }
  return state as V2Persisted;
}

export const useProfileStore = create<ProfileStore>()(
  persist(
    (set, get) => ({
      activeAccountIndex: 0,
      profiles: [],

      addProfile: (
        accountIndex: number,
        pubkey: string,
        source?: 'derived' | 'imported',
        externalChain?: number
      ) => {
        storeLog.info('store.profile.add', { accountIndex, source, externalChain });
        set((state) => {
          if (state.profiles.some((p) => p.accountIndex === accountIndex)) {
            storeLog.debug('store.profile.add.skip_duplicate', { accountIndex });
            return state;
          }
          const effectiveChain = externalChain ?? (source === 'imported' ? 1 : undefined);
          return {
            profiles: [
              ...state.profiles,
              {
                accountIndex,
                pubkey,
                addedAt: Date.now(),
                ...(source ? { source } : {}),
                ...(effectiveChain != null && effectiveChain >= 1
                  ? { externalChain: effectiveChain }
                  : {}),
              },
            ],
          };
        });
      },

      switchProfile: (accountIndex: number) => {
        const { profiles } = get();
        // Only switch if the profile exists
        if (!profiles.some((p) => p.accountIndex === accountIndex)) {
          storeLog.warn('store.profile.unknown_profile', { accountIndex });
          return false;
        }
        storeLog.info('store.profile.switch', { accountIndex });
        set({ activeAccountIndex: accountIndex });
        return true;
      },

      getNextAccountIndex: () => {
        const { profiles } = get();
        const derived = profiles.filter((p) => p.source !== 'imported');
        if (derived.length === 0) return 0;
        const maxIndex = Math.max(...derived.map((p) => p.accountIndex));
        return maxIndex + 1;
      },

      updateProfileBalance: (accountIndex: number, balanceSats: number) => {
        storeLog.debug('store.profile.update_balance', { accountIndex, balanceSats });
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.accountIndex === accountIndex ? { ...p, cachedBalanceSats: balanceSats } : p
          ),
        }));
      },

      updateProfileMetadata: (accountIndex: number, displayName?: string, picture?: string) => {
        storeLog.debug('store.profile.update_metadata', { accountIndex, displayName });
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.accountIndex === accountIndex
              ? { ...p, cachedDisplayName: displayName, cachedPicture: picture }
              : p
          ),
        }));
      },

      hasPubkey: (pubkey: string) => {
        return get().profiles.some((p) => p.pubkey === pubkey);
      },

      getActiveProfile: () => {
        const { profiles, activeAccountIndex } = get();
        return profiles.find((p) => p.accountIndex === activeAccountIndex);
      },
    }),
    persistConfig({
      name: 'profile-store',
      storage: AsyncStorage,
      schema: PersistedProfileStore,
      version: PROFILE_STORE_PERSIST_VERSION,
      migrate: migrateProfileStore,
      partialize: (state) => ({
        activeAccountIndex: state.activeAccountIndex,
        profiles: state.profiles,
      }),
    })
  )
);
