/**
 * @fileoverview Store for persisting location data associated with transactions
 *
 * This store maps transaction history entry IDs to their captured location data.
 * Location is only stored when the user has enabled the location stamping setting.
 * Works with all transaction types: send, receive, mint, melt.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { log, storeLog } from '@/shared/lib/logger';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

const profileStorage = createProfileScopedStorage();

export interface TransactionLocation {
  latitude: number;
  longitude: number;
  createdAt: number;
}

/** Coordinates without the store-managed timestamp — used at capture time. */
export type TransactionCoordinates = Omit<TransactionLocation, 'createdAt'>;

interface TransactionLocationState {
  /** Map of historyEntry.id -> location data */
  locations: Record<string, TransactionLocation>;
}

interface TransactionLocationActions {
  /** Store a location for a transaction */
  setTransactionLocation: (
    entryId: string,
    location: Omit<TransactionLocation, 'createdAt'>
  ) => void;
  /** Get the location for a transaction */
  getTransactionLocation: (entryId: string) => TransactionLocation | null;
  /** Remove location for a specific transaction */
  removeTransactionLocation: (entryId: string) => void;
  /** Clear all stored locations */
  clearAllLocations: () => void;
  /** Clear all data from both state and storage */
  clearAllData: () => Promise<void>;
}

type TransactionLocationStore = TransactionLocationState & TransactionLocationActions;

const PersistedTransactionLocationStore = z.object({
  locations: z
    .record(
      z.string().max(256),
      z.looseObject({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        createdAt: z.number().int().nonnegative(),
      })
    )
    .default({}),
});

export const useTransactionLocationStore = create<TransactionLocationStore>()(
  persist(
    (set, get) => ({
      // Initial state
      locations: {},

      // Actions
      setTransactionLocation: (
        entryId: string,
        location: Omit<TransactionLocation, 'createdAt'>
      ) => {
        storeLog.debug('store.tx_location.set', { entryId });
        set((state) => ({
          locations: {
            ...state.locations,
            [entryId]: {
              ...location,
              createdAt: Date.now(),
            },
          },
        }));
      },

      getTransactionLocation: (entryId: string) => {
        const state = get();
        return state.locations[entryId] ?? null;
      },

      removeTransactionLocation: (entryId: string) => {
        storeLog.debug('store.tx_location.remove', { entryId });
        set((state) => {
          const { [entryId]: _, ...rest } = state.locations;
          return { locations: rest };
        });
      },

      clearAllLocations: () => {
        storeLog.info('store.tx_location.clear_all');
        set({ locations: {} });
      },

      clearAllData: async () => {
        try {
          await profileStorage.removeItem('transaction-location-store');
          set({ locations: {} });
        } catch (error) {
          log.error('store.tx_location.clear_failed', { error });
          throw error;
        }
      },
    }),
    {
      name: 'transaction-location-store',
      storage: createJSONStorage(() => createProfileScopedStorage()),
      version: 1,
      partialize: (state) => ({
        locations: state.locations,
      }),
      migrate: (state, _version) => state,
      merge: createMergeWithSchema('tx_location', PersistedTransactionLocationStore),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          log.warn('store.tx_location.rehydrate_failed', { error });
        }
      },
    }
  )
);

/**
 * Hook to get the location for a specific transaction.
 * Returns null if no location was stored for this transaction.
 */
export const useTransactionLocation = (entryId: string | undefined): TransactionLocation | null => {
  return useTransactionLocationStore((state) =>
    entryId ? (state.locations[entryId] ?? null) : null
  );
};
