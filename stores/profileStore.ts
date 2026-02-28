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
  /** BIP-44 account index used for key derivation */
  accountIndex: number;
  /** Nostr public key (hex) — used for deterministic avatar rendering */
  pubkey: string;
  /** Timestamp when this profile was added */
  addedAt: number;
  /** Last-known balance in sats (updated while profile is active) */
  cachedBalanceSats?: number;
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
  addProfile: (accountIndex: number, pubkey: string) => void;
  /** Set the active account index (caller is responsible for cleanup/resetStages before this) */
  switchProfile: (accountIndex: number) => void;
  /** Remove a profile (cannot remove the last profile or the currently active one) */
  removeProfile: (accountIndex: number) => boolean;
  /** Get the next available account index */
  getNextAccountIndex: () => number;
  /** Update the cached balance for a profile (called by ProfileBalanceSync) */
  updateProfileBalance: (accountIndex: number, balanceSats: number) => void;
  /** Check whether the Redux-to-Coco migration has already been handled for an account. */
  isCocoMigrationComplete: (accountIndex: number) => boolean;
  /** Mark the Redux-to-Coco migration as done for an account. */
  markCocoMigrationComplete: (accountIndex: number) => void;
}

type ProfileStore = ProfileState & ProfileActions;

export const useProfileStore = create<ProfileStore>()(
  persist(
    (set, get) => ({
      activeAccountIndex: 0,
      profiles: [],
      cocoMigrationComplete: {},

      addProfile: (accountIndex: number, pubkey: string) => {
        set((state) => {
          // Skip if this accountIndex already exists
          if (state.profiles.some((p) => p.accountIndex === accountIndex)) {
            return state;
          }
          return {
            profiles: [
              ...state.profiles,
              {
                accountIndex,
                pubkey,
                addedAt: Date.now(),
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
          return;
        }
        set({ activeAccountIndex: accountIndex });
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
        if (profiles.length === 0) return 0;
        const maxIndex = Math.max(...profiles.map((p) => p.accountIndex));
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
