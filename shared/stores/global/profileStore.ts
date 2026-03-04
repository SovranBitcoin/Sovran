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
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  /** Per-account flag: true once the Redux-to-Coco migration has run (or been confirmed unnecessary). */
  cocoMigrationComplete: Record<number, boolean>;
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
  /** Remove a profile (cannot remove the last profile or the currently active one) */
  removeProfile: (accountIndex: number) => boolean;
  /** Get the next available account index (only considers derived profiles) */
  getNextAccountIndex: () => number;
  /** Update the cached balance for a profile (called by ProfileBalanceSync) */
  updateProfileBalance: (accountIndex: number, balanceSats: number) => void;
  /** Check whether the Redux-to-Coco migration has already been handled for an account. */
  isCocoMigrationComplete: (accountIndex: number) => boolean;
  /** Mark the Redux-to-Coco migration as done for an account. */
  markCocoMigrationComplete: (accountIndex: number) => void;
  /** Update cached Nostr kind-0 metadata for a profile */
  updateProfileMetadata: (accountIndex: number, displayName?: string, picture?: string) => void;
  /** Check if a pubkey is already used by any profile */
  hasPubkey: (pubkey: string) => boolean;
  /** Get the active profile entry */
  getActiveProfile: () => ProfileEntry | undefined;
}

type ProfileStore = ProfileState & ProfileActions;

export const useProfileStore = create<ProfileStore>()(
  persist(
    (set, get) => ({
      activeAccountIndex: 0,
      profiles: [],
      cocoMigrationComplete: {},

      addProfile: (
        accountIndex: number,
        pubkey: string,
        source?: 'derived' | 'imported',
        externalChain?: number
      ) => {
        set((state) => {
          if (state.profiles.some((p) => p.accountIndex === accountIndex)) {
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
          console.warn(`ProfileStore: Cannot switch to unknown profile ${accountIndex}`);
          return false;
        }
        set({ activeAccountIndex: accountIndex });
        return true;
      },

      removeProfile: (accountIndex: number) => {
        const { profiles, activeAccountIndex } = get();
        // Cannot remove the last profile
        if (profiles.length <= 1) {
          console.warn('ProfileStore: Cannot remove the last profile');
          return false;
        }
        // Cannot remove the currently active profile
        if (accountIndex === activeAccountIndex) {
          console.warn('ProfileStore: Cannot remove the currently active profile');
          return false;
        }
        set((state) => ({
          profiles: state.profiles.filter((p) => p.accountIndex !== accountIndex),
        }));
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
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.accountIndex === accountIndex ? { ...p, cachedBalanceSats: balanceSats } : p
          ),
        }));
      },

      isCocoMigrationComplete: (accountIndex: number) => {
        return !!get().cocoMigrationComplete[accountIndex];
      },

      markCocoMigrationComplete: (accountIndex: number) => {
        set((state) => ({
          cocoMigrationComplete: {
            ...state.cocoMigrationComplete,
            [accountIndex]: true,
          },
        }));
      },

      updateProfileMetadata: (accountIndex: number, displayName?: string, picture?: string) => {
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
    {
      name: 'profile-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        activeAccountIndex: state.activeAccountIndex,
        profiles: state.profiles,
        cocoMigrationComplete: state.cocoMigrationComplete,
      }),
    }
  )
);
