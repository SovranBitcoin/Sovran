import * as React from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

export type RestoreStatus =
  | 'unknown'
  | 'not-needed'
  | 'pending'
  | 'in-progress'
  | 'complete'
  | 'failed';

interface WalletLifecycleState {
  /**
   * UNIX-ms timestamp set the first time this app installation generates the
   * master mnemonic. Stays null forever if the seed pre-existed (reinstall,
   * iCloud restore, profile reset, manual import) — that's the signal that a
   * NUT-13 wallet restore must run before any minting can use the deterministic
   * counter.
   */
  seedCreatedAt: number | null;
  restoreStatus: RestoreStatus;
  /** Last successful restore completion (UNIX ms). */
  lastRestoreAt: number | null;
  /** Last failure message — surfaced in the /restore UI. */
  lastRestoreError: string | null;

  markSeedCreatedNow: () => void;
  setRestoreStatus: (status: RestoreStatus, error?: string | null) => void;
  markRestoreComplete: () => void;
}

const PersistedWalletLifecycleStore = z.object({
  seedCreatedAt: z.number().int().nonnegative().nullable().default(null),
  restoreStatus: z
    .enum(['unknown', 'not-needed', 'pending', 'in-progress', 'complete', 'failed'])
    .default('unknown'),
  lastRestoreAt: z.number().int().nonnegative().nullable().default(null),
});

export const useWalletLifecycleStore = create<WalletLifecycleState>()(
  persist(
    (set) => ({
      seedCreatedAt: null,
      restoreStatus: 'unknown',
      lastRestoreAt: null,
      lastRestoreError: null,

      markSeedCreatedNow: () =>
        set((s) => (s.seedCreatedAt == null ? { seedCreatedAt: Date.now() } : s)),

      setRestoreStatus: (status, error = null) =>
        set({ restoreStatus: status, lastRestoreError: error }),

      markRestoreComplete: () =>
        set({ restoreStatus: 'complete', lastRestoreAt: Date.now(), lastRestoreError: null }),
    }),
    persistConfig({
      name: 'wallet-lifecycle',
      storage: AsyncStorage,
      schema: PersistedWalletLifecycleStore,
      logKey: 'wallet_lifecycle',
      partialize: (s) => ({
        seedCreatedAt: s.seedCreatedAt,
        restoreStatus: s.restoreStatus,
        lastRestoreAt: s.lastRestoreAt,
      }),
    })
  )
);

/**
 * React hook returning true once the persisted lifecycle store has finished
 * rehydrating from AsyncStorage. Components that gate on `restoreStatus` /
 * `seedCreatedAt` MUST wait for this — reading those fields before hydration
 * returns the in-memory initial values (`'unknown'` / `null`) which would
 * trigger a false-positive restore redirect on every boot for existing users.
 */
export function useWalletLifecycleHydrated(): boolean {
  const [hydrated, setHydrated] = React.useState(() =>
    useWalletLifecycleStore.persist.hasHydrated()
  );
  React.useEffect(() => {
    if (hydrated) return;
    const unsub = useWalletLifecycleStore.persist.onFinishHydration(() => setHydrated(true));
    // Fallback: hasHydrated may have flipped between initial render and effect run.
    if (useWalletLifecycleStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, [hydrated]);
  return hydrated;
}
