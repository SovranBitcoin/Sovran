/**
 * @fileoverview Store for persisting location data associated with transactions
 *
 * This store maps transaction history entry IDs to their captured location data.
 * Location is only stored when the user has enabled the location stamping setting.
 * Works with all transaction types: send, receive, mint, melt.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TransactionLocation {
  latitude: number;
  longitude: number;
  createdAt: number;
}

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
        set((state) => {
          const { [entryId]: _, ...rest } = state.locations;
          return { locations: rest };
        });
      },

      clearAllLocations: () => {
        set({ locations: {} });
      },

      clearAllData: async () => {
        try {
          await AsyncStorage.removeItem('transaction-location-store');
          set({ locations: {} });
        } catch (error) {
          console.error('TransactionLocationStore: Error clearing data:', error);
          throw error;
        }
      },
    }),
    {
      name: 'transaction-location-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        locations: state.locations,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('TransactionLocationStore: Failed to rehydrate from storage:', error);
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
